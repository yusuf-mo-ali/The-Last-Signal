/**
 * The melee chaser (the Walker's behaviour) in a small test world: an open floor with a wall and
 * a doorway (see `testWorld.ts`), and a target that stands in for the player.
 */

import { describe, expect, it } from 'vitest';
import { ENEMY_RULES, ENEMY_STATS } from '../../config/enemies';
import { CollisionWorld } from '../../physics/CollisionWorld';
import { boxTriangles } from '../../world/levels/geometry';
import { DT, enemyTestWorld, TEST_WORLD_BRUSHES, TestTarget } from '../testWorld';

const W = ENEMY_STATS.walker;
const steps = (seconds: number) => Math.round(seconds / DT);

describe('melee brain: detection', () => {
  it('notices a visible target within detection range at its next decision', () => {
    const t = enemyTestWorld({ targets: [new TestTarget(0, 10)] });
    const walker = t.manager.spawn('walker', [0, 0, 0], { patrol: false });
    const taken = t.runUntil(() => walker?.state === 'DETECT', 1);
    expect(taken).toBeGreaterThanOrEqual(0);
    expect(taken).toBeLessThanOrEqual(Math.round(ENEMY_RULES.thinkInterval / DT));
    expect(t.of('targetAcquired')).toEqual([
      { id: 'walker-1', targetId: 'player', alerted: false },
    ]);
  });

  it('ignores a target beyond detection range', () => {
    const t = enemyTestWorld({ targets: [new TestTarget(0, W.detectionRange + 1)] });
    t.manager.spawn('walker', [0, 0, 0], { patrol: false });
    t.seconds(3);
    expect(t.of('targetAcquired')).toEqual([]);
    expect(t.manager.get('walker-1')?.state).toBe('IDLE');
  });

  it('cannot see through a wall', () => {
    // Walker north of the wall, target 10 m south, the wall between (away from the doorway).
    const t = enemyTestWorld({ targets: [new TestTarget(8, -4)] });
    t.manager.spawn('walker', [8, 0, -14], { patrol: false });
    t.seconds(3);
    expect(t.of('targetAcquired')).toEqual([]);
  });

  it('shows the "noticed you" tell for exactly its reaction time, then chases', () => {
    const t = enemyTestWorld({ targets: [new TestTarget(0, 10)] });
    const walker = t.manager.spawn('walker', [0, 0, 0], { patrol: false });
    t.runUntil(() => walker?.state === 'DETECT');
    const reaction = t.runUntil(() => walker?.state !== 'DETECT');
    expect(reaction).toBe(steps(W.perception.reactionTime));
    expect(walker?.state).toBe('CHASE');
  });

  it('a hit alerts it from beyond its detection range', () => {
    const t = enemyTestWorld({ targets: [new TestTarget(0, 20)] });
    const walker = t.manager.spawn('walker', [0, 0, 0], { patrol: false });
    t.step(12);
    expect(walker?.state).toBe('IDLE');
    t.combat.applyDamage('walker-1', { amount: 10 });
    expect(walker?.state).toBe('DETECT');
    expect(t.of('targetAcquired')).toEqual([{ id: 'walker-1', targetId: 'player', alerted: true }]);
    t.runUntil(() => walker?.state === 'CHASE', 2);
    expect(walker?.state).toBe('CHASE');
  });
});

describe('melee brain: chase and attack', () => {
  it('walks up to its target and stops just short of it', () => {
    const t = enemyTestWorld({ targets: [new TestTarget(0, 10)] });
    const walker = t.manager.spawn('walker', [0, 0, 0], { patrol: false });
    t.runUntil(() => walker?.state === 'ATTACK', 20);
    const distance = () => Math.hypot(walker!.motor.position.x - 0, walker!.motor.position.z - 10); // eslint-disable-line @typescript-eslint/no-non-null-assertion
    expect(distance()).toBeLessThanOrEqual(W.attackRange);
    expect(distance()).toBeGreaterThan(W.body.radius + 0.35);
  });

  it('strikes once per attack, exactly its wind-up after the tell, every cooldown', () => {
    const tough = new TestTarget(0, 10);
    tough.health = 1000;
    const t = enemyTestWorld({ targets: [tough] });
    t.manager.spawn('walker', [0, 0, 0], { patrol: false });
    const started: number[] = [];
    const struck: number[] = [];
    let stepIndex = 0;
    t.manager.events.on('attackStarted', () => started.push(stepIndex));
    t.manager.events.on('attackHit', () => struck.push(stepIndex));
    for (; stepIndex < steps(20); stepIndex++) {
      t.step();
    }
    expect(started.length).toBeGreaterThanOrEqual(5);
    // Exactly one strike per attack, `windup` after it started.
    expect(struck.length).toBe(started.length - (struck.length < started.length ? 1 : 0));
    for (let i = 0; i < struck.length; i++) {
      expect((struck[i] ?? 0) - (started[i] ?? 0)).toBe(steps(W.attack.windup));
    }
    // Attacks start one cooldown apart.
    for (let i = 1; i < started.length; i++) {
      expect((started[i] ?? 0) - (started[i - 1] ?? 0)).toBe(steps(W.attackCooldown));
    }
    // Each hit dealt the Walker's damage to the target, once.
    expect(t.target.hits).toHaveLength(struck.length);
    expect(t.target.hits.every((h) => h.amount === W.attackDamage)).toBe(true);
    expect(t.target.health).toBe(1000 - W.attackDamage * struck.length);
  });

  it('the telegraph can be dodged: stepping out of reach during the wind-up makes it miss', () => {
    const t = enemyTestWorld({ targets: [new TestTarget(0, 10)] });
    t.manager.spawn('walker', [0, 0, 0], { patrol: false });
    t.manager.events.on('attackStarted', () => {
      t.target.position.set(0, 0, 13); // back off ~3 m
    });
    t.runUntil(() => t.of('attackMissed').length > 0, 20);
    expect(t.of('attackMissed')[0]).toEqual({
      id: 'walker-1',
      targetId: 'player',
      reason: 'range',
    });
    expect(t.target.hits).toEqual([]);
  });

  it('the attack is committed: a target that slips behind it is missed', () => {
    const t = enemyTestWorld({ targets: [new TestTarget(0, 10)] });
    const walker = t.manager.spawn('walker', [0, 0, 0], { patrol: false });
    let moved = false;
    t.manager.events.on('attackStarted', () => {
      if (!moved) {
        moved = true;
        const p = walker!.motor.position; // eslint-disable-line @typescript-eslint/no-non-null-assertion
        t.target.position.set(p.x, 0, p.z - 1.2); // right behind it
      }
    });
    t.runUntil(() => t.of('attackMissed').length > 0, 20);
    expect(t.of('attackMissed')[0]?.reason).toBe('arc');
    expect(t.target.hits).toEqual([]);
  });

  it('a wall that comes between during the wind-up blocks the strike', () => {
    // Walker and target 1.4 m apart in the open. During the wind-up the target steps behind a
    // pillar: still within reach (1.66 m) and inside the arc (33°), but out of sight.
    const world = new CollisionWorld([
      ...TEST_WORLD_BRUSHES,
      ...boxTriangles([0.35, 0, 9.2], [0.55, 3, 9.4]),
    ]);
    const t = enemyTestWorld({ targets: [new TestTarget(0, 10)], world });
    t.manager.spawn('walker', [0, 0, 8.6], { patrol: false, yaw: Math.PI });
    t.manager.events.on('attackStarted', () => {
      t.target.position.set(0.9, 0, 10);
    });
    t.runUntil(() => t.of('attackMissed').length > 0, 10);
    expect(t.of('attackMissed')[0]?.reason).toBe('blocked');
    expect(t.target.hits).toEqual([]);
  });

  it('the hit volumes take the reach pose for the attack and return to rest after it', () => {
    const tough = new TestTarget(0, 10);
    tough.health = 1000;
    const t = enemyTestWorld({ targets: [tough] });
    const walker = t.manager.spawn('walker', [0, 0, 8.6], { patrol: false, yaw: Math.PI });
    expect(walker?.rig.definition).toBe(W.rig);
    t.runUntil(() => walker?.attackPhase === 'windup', 10);
    expect(walker?.rig.definition).toBe(W.attackPose);
    t.runUntil(() => walker?.attackPhase === 'recovery', 10);
    expect(walker?.rig.definition).toBe(W.attackPose); // arms still out through the recovery
    t.runUntil(() => walker?.attackPhase === 'none', 10);
    expect(walker?.rig.definition).toBe(W.rig);
  });

  it('never attacks through a wall; it walks round through the doorway instead', () => {
    // Target just south of the wall, walker just north of it: 1.2 m apart, wall between.
    const t = enemyTestWorld({ targets: [new TestTarget(6, -9.5)] });
    const walker = t.manager.spawn('walker', [6, 0, -10.9], { patrol: false });
    t.manager.alert('walker-1', t.target);
    t.manager.events.on('attackStarted', () => {
      // Whenever it attacks, it must be on the target's side of the wall.
      expect(walker!.motor.position.z).toBeGreaterThan(-10); // eslint-disable-line @typescript-eslint/no-non-null-assertion
    });
    t.runUntil(() => t.target.hits.length > 0, 30);
    expect(t.target.hits.length).toBeGreaterThan(0);
  });

  it('only one damage per attack even with the target standing still in reach for long', () => {
    const t = enemyTestWorld({ targets: [new TestTarget(0, 10)] });
    t.manager.spawn('walker', [0, 0, 0], { patrol: false });
    t.seconds(15);
    expect(t.of('attackHit').length + t.of('attackMissed').length).toBeLessThanOrEqual(
      t.of('attackStarted').length,
    );
    expect(t.target.hits).toHaveLength(t.of('attackHit').length);
  });

  it('does not attack a target it cannot hurt more than it can reach (height)', () => {
    // Target 2 m up on a platform right next to it.
    const world = new CollisionWorld([
      ...TEST_WORLD_BRUSHES,
      ...boxTriangles([2, 0, 8], [6, 2, 12]),
    ]);
    const target = new TestTarget(3, 10);
    target.position.y = 2;
    const t = enemyTestWorld({ targets: [target], world });
    t.manager.spawn('walker', [0.9, 0, 10], { patrol: false, yaw: -Math.PI / 2 });
    t.manager.alert('walker-1', target);
    t.seconds(6);
    expect(t.of('attackStarted')).toEqual([]);
    expect(target.hits).toEqual([]);
  });
});

describe('melee brain: stagger and death', () => {
  it('a stagger cancels the wind-up (no damage), stops it, then it recovers', () => {
    const t = enemyTestWorld({ targets: [new TestTarget(0, 10)] });
    const walker = t.manager.spawn('walker', [0, 0, 0], { patrol: false });
    let staggeredAt = -1;
    let stepIndex = 0;
    t.manager.events.on('attackStarted', () => {
      if (staggeredAt < 0) {
        staggeredAt = stepIndex;
        // Enough damage in one hit to stagger (threshold 35).
        t.combat.applyDamage('walker-1', { amount: W.staggerThreshold });
      }
    });
    for (; stepIndex < steps(10) && staggeredAt < 0; stepIndex++) {
      t.step();
    }
    expect(t.of('attackCancelled')).toEqual([{ id: 'walker-1', reason: 'stagger' }]);
    expect(walker?.state).toBe('STAGGER');
    // Still no hit when the cancelled strike would have landed, and no new attack while staggered.
    const recovered = t.runUntil(() => walker?.state !== 'STAGGER', 5);
    expect(recovered).toBe(steps(W.staggerDuration));
    expect(t.target.hits).toEqual([]);
    expect(['ATTACK', 'CHASE']).toContain(walker?.state);
  });

  it('a stagger while staggered restarts the stagger instead of stacking states', () => {
    const t = enemyTestWorld({ targets: [new TestTarget(0, 20)] });
    const walker = t.manager.spawn('walker', [0, 0, 0], { patrol: false });
    t.manager.forceState('walker-1', 'STAGGER');
    t.step(20);
    t.manager.forceState('walker-1', 'STAGGER');
    const left = t.runUntil(() => walker?.state !== 'STAGGER', 5);
    expect(left).toBe(steps(W.staggerDuration));
  });

  it('killed during the wind-up: the attack is cancelled and never lands', () => {
    const t = enemyTestWorld({ targets: [new TestTarget(0, 10)] });
    t.manager.spawn('walker', [0, 0, 0], { patrol: false });
    t.manager.events.on('attackStarted', () => {
      t.manager.kill('walker-1');
    });
    t.runUntil(() => t.of('died').length > 0, 20);
    t.seconds(3);
    expect(t.of('attackCancelled')).toEqual([{ id: 'walker-1', reason: 'death' }]);
    expect(t.target.hits).toEqual([]);
    expect(t.of('attackStarted')).toHaveLength(1);
  });
});

describe('melee brain: losing the target', () => {
  it('forgets a target that dies', () => {
    const t = enemyTestWorld({ targets: [new TestTarget(0, 10)] });
    const walker = t.manager.spawn('walker', [0, 0, 0], { patrol: false });
    t.runUntil(() => walker?.state === 'CHASE');
    t.target.health = 0;
    t.runUntil(() => walker?.state === 'IDLE', 1);
    expect(t.of('targetLost')).toEqual([{ id: 'walker-1', targetId: 'player', reason: 'dead' }]);
  });

  it('forgets a target that gets too far away', () => {
    const t = enemyTestWorld({ targets: [new TestTarget(0, 10)] });
    const walker = t.manager.spawn('walker', [0, 0, 0], { patrol: false });
    t.runUntil(() => walker?.state === 'CHASE');
    t.target.position.set(0, 0, W.perception.loseTargetRange + 5);
    t.runUntil(() => walker?.state === 'IDLE', 1);
    expect(t.of('targetLost')[0]?.reason).toBe('range');
  });

  it('forgets a target it has not seen for longer than its memory', () => {
    // The target stands inside a sealed box: unreachable and out of sight.
    const world = new CollisionWorld([
      ...TEST_WORLD_BRUSHES,
      ...boxTriangles([4, 0, 4], [8, 3, 8]),
    ]);
    const target = new TestTarget(0, 6);
    const t = enemyTestWorld({ targets: [target], world, level: { ...enemyTestWorldLevel() } });
    const walker = t.manager.spawn('walker', [0, 0, 0], { patrol: false });
    t.runUntil(() => walker?.state === 'CHASE');
    target.position.set(6, 0, 6); // inside the box
    const lostAfter = t.runUntil(() => walker?.state === 'IDLE', 10);
    expect(t.of('targetLost')[0]?.reason).toBe('memory');
    expect(lostAfter * DT).toBeGreaterThanOrEqual(W.perception.targetMemory - 0.2);
    expect(lostAfter * DT).toBeLessThanOrEqual(W.perception.targetMemory + 0.3);
  });
});

describe('melee brain: idle and patrol', () => {
  it('patrols around its spawn point, staying near it, and pauses between walks', () => {
    const t = enemyTestWorld({ targets: [new TestTarget(25, 25)] });
    const walker = t.manager.spawn('walker', [0, 0, 0]);
    const states = new Set<string>();
    let farthest = 0;
    for (let i = 0; i < steps(30); i++) {
      t.step();
      states.add(walker?.state ?? '');
      farthest = Math.max(farthest, walker?.motor.position.length() ?? 0);
    }
    expect([...states].sort()).toEqual(['IDLE', 'PATROL']);
    expect(farthest).toBeGreaterThan(0.3);
    expect(farthest).toBeLessThanOrEqual(W.patrol.radius + ENEMY_RULES.arrivalRadius);
  });

  it('a spawn without patrol stands still', () => {
    const t = enemyTestWorld({ targets: [new TestTarget(25, 25)] });
    const walker = t.manager.spawn('walker', [0, 0, 0], { patrol: false });
    t.seconds(10);
    expect(walker?.state).toBe('IDLE');
    expect(walker?.motor.position.length()).toBeLessThan(0.01);
  });

  it('patrols are reproducible from the seed', () => {
    const run = () => {
      const t = enemyTestWorld({ targets: [new TestTarget(25, 25)], seed: 'patrol' });
      const walker = t.manager.spawn('walker', [0, 0, 0]);
      t.seconds(20);
      return walker?.motor.position.toArray();
    };
    expect(run()).toEqual(run());
  });
});

describe('think rate (limited-rate decisions)', () => {
  it('each enemy thinks once per think interval, spread over the steps', () => {
    const t = enemyTestWorld({ targets: [new TestTarget(25, 25)] });
    for (let i = 0; i < 10; i++) {
      t.manager.spawn('walker', [i * 2 - 9, 0, 0], { patrol: false });
    }
    const interval = Math.round(ENEMY_RULES.thinkInterval / DT);
    let maxPerStep = 0;
    for (let i = 0; i < 60; i++) {
      const before = t.manager.stats.thinks;
      t.step();
      maxPerStep = Math.max(maxPerStep, t.manager.stats.thinks - before);
    }
    expect(t.manager.stats.thinks).toBe((10 * 60) / interval);
    expect(maxPerStep).toBe(Math.ceil(10 / interval)); // never all on one step
    expect(t.manager.stats.updates).toBe(10 * 60); // exact timing still runs every step
  });

  it('the interval is configurable', () => {
    const t = enemyTestWorld({
      targets: [new TestTarget(25, 25)],
      rules: { thinkInterval: 0.2 },
    });
    t.manager.spawn('walker', [0, 0, 0], { patrol: false });
    t.seconds(2);
    expect(t.manager.stats.thinks).toBe(10);
  });
});

function enemyTestWorldLevel() {
  return {
    name: 'no routes',
    spawn: { position: [0, 0, 0] as const, yaw: 0 },
    killPlaneY: -20,
    brushes: [],
  };
}
