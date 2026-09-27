/**
 * The Runner and the Tank (D-043): the melee behaviour with their own data. Same test world as the
 * Walker's (an open floor with a wall and a doorway, see `testWorld.ts`), same combat pipeline.
 */

import { describe, expect, it } from 'vitest';
import type { HitInput } from '../combat/CombatSystem';
import type { DamageZone } from '../config/enemies';
import { ENEMY_STATS } from '../config/enemies';
import type { Enemy } from './Enemy';
import { DT, enemyTestWorld, TestTarget } from './testWorld';

const W = ENEMY_STATS.walker;
const R = ENEMY_STATS.runner;
const T = ENEMY_STATS.tank;
const steps = (seconds: number) => Math.round(seconds / DT);

type World = ReturnType<typeof enemyTestWorld>;

/** A Pistol hit (26; headshots ×2.5) on `zone` of `id`, through the combat pipeline. */
function pistolHit(t: World, id: string, zone: DamageZone) {
  const hit: HitInput = {
    targetId: id,
    zone,
    weaponId: 'pistol',
    source: 'shot',
    quick: false,
    baseDamage: 26,
    falloff: 1,
    headshotMultiplier: 2.5,
    point: [0, 1, 0],
    direction: [0, 0, -1],
    distance: 8,
  };
  return t.combat.applyHit(hit);
}

/** Highest horizontal speed reached (m/s) over `seconds`. */
function topSpeed(t: World, enemy: Enemy, seconds: number): number {
  let best = 0;
  for (let i = 0; i < steps(seconds); i++) {
    const before = enemy.motor.position.clone();
    t.step();
    const p = enemy.motor.position;
    best = Math.max(best, Math.hypot(p.x - before.x, p.z - before.z) / DT);
  }
  return best;
}

/** Seconds for a fresh enemy to close from 20 m to its first attack. */
function timeToFirstAttack(archetype: 'walker' | 'runner' | 'tank'): number {
  const t = enemyTestWorld({ targets: [new TestTarget(0, 20)] });
  const enemy = t.manager.spawn(archetype, [0, 0, 0], { patrol: false });
  if (!enemy) {
    throw new Error('no spawn');
  }
  t.manager.alert(enemy.id, t.target);
  return t.runUntil(() => enemy.state === 'ATTACK', 60) * DT;
}

describe('Runner: movement and pressure', () => {
  it('runs about three times as fast as a Walker', () => {
    const t = enemyTestWorld({ targets: [new TestTarget(0, 30)] });
    const runner = t.manager.spawn('runner', [0, 0, 0], { patrol: false });
    const walker = t.manager.spawn('walker', [8, 0, 0], { patrol: false });
    t.manager.alert('runner-1', t.target);
    t.manager.alert('walker-2', t.target);
    const speeds = { runner: 0, walker: 0 };
    for (let i = 0; i < steps(3); i++) {
      const r = runner!.motor.position.clone(); // eslint-disable-line @typescript-eslint/no-non-null-assertion
      const w = walker!.motor.position.clone(); // eslint-disable-line @typescript-eslint/no-non-null-assertion
      t.step();
      speeds.runner = Math.max(speeds.runner, runner!.motor.position.distanceTo(r) / DT); // eslint-disable-line @typescript-eslint/no-non-null-assertion
      speeds.walker = Math.max(speeds.walker, walker!.motor.position.distanceTo(w) / DT); // eslint-disable-line @typescript-eslint/no-non-null-assertion
    }
    expect(speeds.runner).toBeGreaterThan(R.moveSpeed * 0.9);
    expect(speeds.runner).toBeLessThanOrEqual(R.moveSpeed + 0.05);
    expect(speeds.runner / speeds.walker).toBeGreaterThan(2.8);
  });

  it('closes 20 m far sooner than a Walker or a Tank', () => {
    const runner = timeToFirstAttack('runner');
    const walker = timeToFirstAttack('walker');
    const tank = timeToFirstAttack('tank');
    expect(runner).toBeGreaterThan(0);
    expect(runner).toBeLessThan(walker / 2.5);
    expect(walker).toBeLessThan(tank);
  });

  it('notices targets further away than a Walker', () => {
    const at = (W.detectionRange + R.detectionRange) / 2;
    const t = enemyTestWorld({ targets: [new TestTarget(0, at)] });
    const runner = t.manager.spawn('runner', [0, 0, 0], { patrol: false });
    const walker = t.manager.spawn('walker', [3, 0, 0], { patrol: false });
    t.seconds(1);
    expect(runner?.target?.id).toBe('player');
    expect(walker?.target).toBeNull();
  });

  it('weaves in the open at mid range: it strays well off the straight line; a Walker does not', () => {
    const lateral = (archetype: 'runner' | 'walker') => {
      const t = enemyTestWorld({ targets: [new TestTarget(0, 14)] });
      const enemy = t.manager.spawn(archetype, [0, 0, 0], { patrol: false });
      t.manager.alert(enemy!.id, t.target); // eslint-disable-line @typescript-eslint/no-non-null-assertion
      let most = 0;
      const sides = new Set<number>();
      t.runUntil(() => {
        most = Math.max(most, Math.abs(enemy!.motor.position.x)); // eslint-disable-line @typescript-eslint/no-non-null-assertion
        if (enemy!.weaveSide !== 0) sides.add(enemy!.weaveSide); // eslint-disable-line @typescript-eslint/no-non-null-assertion
        return enemy!.state === 'ATTACK'; // eslint-disable-line @typescript-eslint/no-non-null-assertion
      }, 20);
      return { most, sides: [...sides].sort() };
    };
    const runner = lateral('runner');
    expect(runner.most).toBeGreaterThan(0.6);
    expect(runner.sides).toEqual([-1, 1]); // it switches sides on the way in
    const walker = lateral('walker');
    expect(walker.sides).toEqual([]);
    expect(walker.most).toBeLessThan(0.25);
  });

  it('does not weave when a wall is in the way of the zig-zag, and still arrives', () => {
    // Along the wall's south face: a weave toward it would be blocked.
    const t = enemyTestWorld({ targets: [new TestTarget(12, -9.3)] });
    const runner = t.manager.spawn('runner', [0, 0, -9.3], { patrol: false });
    t.manager.alert('runner-1', t.target);
    let closest = 0;
    expect(
      t.runUntil(() => {
        closest = Math.min(closest, runner!.motor.position.z + 9.3); // eslint-disable-line @typescript-eslint/no-non-null-assertion
        return runner?.state === 'ATTACK';
      }, 10),
    ).toBeGreaterThan(0);
    // It never heads toward the wall (north, −z): only straight on, or away from it.
    expect(closest).toBeGreaterThan(-0.1);
  });
});

describe('Runner: the lunge', () => {
  it('winds up, leaps and lands a strike from beyond its standing reach', () => {
    const tough = new TestTarget(0, 10);
    tough.health = 1000;
    const t = enemyTestWorld({ targets: [tough] });
    const runner = t.manager.spawn('runner', [0, 0, 0], { patrol: false });
    t.manager.alert('runner-1', t.target);
    t.runUntil(() => runner?.attackPhase === 'windup', 10);
    const startDistance = runner!.motor.position.distanceTo(tough.position); // eslint-disable-line @typescript-eslint/no-non-null-assertion
    expect(startDistance).toBeGreaterThan(R.attack.reach);
    expect(startDistance).toBeLessThanOrEqual(R.attackRange + 0.01);
    // It stops for the wind-up (the telegraph): braking from a sprint, no further than its
    // stopping distance, then standing still for the second half.
    const held = runner!.motor.position.clone(); // eslint-disable-line @typescript-eslint/no-non-null-assertion
    const braking = R.moveSpeed ** 2 / (2 * R.acceleration * 1.5);
    let windup = t.runUntil(() => (runner?.attackTimer ?? 0) <= R.attack.windup / 2, 2);
    expect(runner?.motor.position.distanceTo(held)).toBeLessThan(braking + 0.05);
    const planted = runner!.motor.position.clone(); // eslint-disable-line @typescript-eslint/no-non-null-assertion
    windup += t.runUntil(() => (runner?.attackTimer ?? 0) <= DT * 1.01, 2);
    expect(runner?.motor.position.distanceTo(planted)).toBeLessThan(0.02);
    windup += t.runUntil(() => runner?.attackPhase !== 'windup', 2);
    expect(windup).toBe(steps(R.attack.windup));
    // …then leaps, much faster than it runs.
    expect(runner?.attackPhase).toBe('lunge');
    let leapSpeed = 0;
    t.runUntil(() => {
      const v = runner!.motor.velocity; // eslint-disable-line @typescript-eslint/no-non-null-assertion
      leapSpeed = Math.max(leapSpeed, Math.hypot(v.x, v.z));
      return runner?.attackPhase !== 'lunge';
    }, 2);
    expect(leapSpeed).toBeGreaterThan(R.moveSpeed * 1.3);
    expect(runner?.motor.position.distanceTo(planted)).toBeGreaterThan(1.2);
    expect(t.of('attackHit')).toEqual([
      expect.objectContaining({ id: 'runner-1', targetId: 'player', amount: R.attackDamage }),
    ]);
    expect(tough.health).toBe(1000 - R.attackDamage);
    expect(runner?.attackPhase).toBe('recovery');
  });

  it('the leap is committed: side-stepping during the wind-up makes it miss', () => {
    const t = enemyTestWorld({ targets: [new TestTarget(0, 10)] });
    const runner = t.manager.spawn('runner', [0, 0, 0], { patrol: false });
    t.manager.alert('runner-1', t.target);
    const runner1 = runner!; // eslint-disable-line @typescript-eslint/no-non-null-assertion
    let started: [number, number, number] = [0, 0, 0];
    t.manager.events.on('attackStarted', () => {
      started = [runner1.motor.position.x, runner1.motor.position.z, runner1.attackYaw];
      t.target.position.x += 1.5; // a side-step: a leap that followed it would still land
    });
    t.runUntil(() => t.of('attackMissed').length > 0, 10);
    expect(t.of('attackMissed')[0]).toMatchObject({ id: 'runner-1' });
    expect(t.target.hits).toEqual([]);
    expect(runner?.attacks).toBe(1);
    // It leapt along its locked line (toward where the target was when the wind-up began).
    const [x0, z0, yaw] = started;
    const dx = runner1.motor.position.x - x0;
    const dz = runner1.motor.position.z - z0;
    const offLine = Math.abs(dx * Math.cos(yaw) - dz * Math.sin(yaw));
    expect(Math.hypot(dx, dz)).toBeGreaterThan(1);
    expect(offLine).toBeLessThan(0.15);
  });

  it('attacks every cooldown against a target that stands still', () => {
    const tough = new TestTarget(0, 8);
    tough.health = 1000;
    const t = enemyTestWorld({ targets: [tough] });
    t.manager.spawn('runner', [0, 0, 0], { patrol: false });
    t.manager.alert('runner-1', t.target);
    t.seconds(12);
    const hits = t.of('attackHit').length;
    expect(hits).toBeGreaterThanOrEqual(Math.floor(10 / R.attackCooldown));
    expect(t.of('attackStarted').every((a) => a.kind === 'strike')).toBe(true);
  });

  it('a hit during the leap staggers it: the attack is cancelled and nothing lands', () => {
    const t = enemyTestWorld({ targets: [new TestTarget(0, 10)] });
    const runner = t.manager.spawn('runner', [0, 0, 0], { patrol: false });
    t.manager.alert('runner-1', t.target);
    t.runUntil(() => runner?.attackPhase === 'lunge', 10);
    expect(pistolHit(t, 'runner-1', 'TORSO')?.amount).toBe(26); // ≥ its threshold (20)
    expect(runner?.state).toBe('STAGGER');
    expect(t.of('attackCancelled')).toEqual([{ id: 'runner-1', reason: 'stagger' }]);
    t.seconds(R.staggerDuration + 0.1);
    expect(t.of('attackHit')).toEqual([]);
    expect(runner?.state).not.toBe('STAGGER');
  });

  it('staggers from one body shot, and recovers after its (short) stagger', () => {
    const t = enemyTestWorld({ targets: [new TestTarget(0, 30)] });
    const runner = t.manager.spawn('runner', [0, 0, 0], { patrol: false });
    pistolHit(t, 'runner-1', 'LEG_LEFT'); // 13: below its threshold
    expect(runner?.state).not.toBe('STAGGER');
    pistolHit(t, 'runner-1', 'LEG_LEFT'); // 26 within the window
    expect(runner?.state).toBe('STAGGER');
    const staggered = t.runUntil(() => runner?.state !== 'STAGGER', 2);
    expect(staggered).toBe(steps(R.staggerDuration));
  });

  it('dies to two body shots and is cleared after its corpse time', () => {
    const t = enemyTestWorld({ targets: [new TestTarget(0, 30)] });
    const runner = t.manager.spawn('runner', [0, 0, 0], { patrol: false });
    pistolHit(t, 'runner-1', 'TORSO');
    expect(runner?.alive).toBe(true);
    expect(pistolHit(t, 'runner-1', 'TORSO')?.killed).toBe(false); // 52 of 60
    expect(pistolHit(t, 'runner-1', 'ARM_LEFT')?.killed).toBe(true);
    expect(runner?.state).toBe('DEAD');
    expect(t.of('died')).toEqual([
      expect.objectContaining({ id: 'runner-1', archetype: 'runner' }),
    ]);
    t.seconds(R.corpseTime + 0.1);
    expect(t.manager.get('runner-1')).toBeUndefined();
  });
});

describe('Tank', () => {
  it('has its high health and moves slowly', () => {
    const t = enemyTestWorld({ targets: [new TestTarget(0, 20)] });
    const tank = t.manager.spawn('tank', [0, 0, 0], { patrol: false });
    expect(tank?.health.max).toBe(T.health);
    expect(t.combat.get('tank-1')?.health.max).toBe(T.health);
    t.manager.alert('tank-1', t.target);
    const speed = topSpeed(t, tank!, 4); // eslint-disable-line @typescript-eslint/no-non-null-assertion
    expect(speed).toBeGreaterThan(T.moveSpeed * 0.8);
    expect(speed).toBeLessThanOrEqual(T.moveSpeed + 0.02);
    expect(speed).toBeLessThan(W.moveSpeed);
  });

  it('body shots are soaked: a torso hit does half, a limb a third, and never staggers it', () => {
    const t = enemyTestWorld({ targets: [new TestTarget(0, 30)] });
    const tank = t.manager.spawn('tank', [0, 0, 0], { patrol: false });
    expect(pistolHit(t, 'tank-1', 'TORSO')?.amount).toBe(13);
    expect(pistolHit(t, 'tank-1', 'ARM_RIGHT')?.amount).toBeCloseTo(26 * 0.35, 9);
    expect(pistolHit(t, 'tank-1', 'LEG_LEFT')?.amount).toBeCloseTo(26 * 0.35, 9);
    for (let i = 0; i < 10; i++) {
      pistolHit(t, 'tank-1', 'TORSO');
    }
    expect(t.of('staggered')).toEqual([]);
    expect(tank?.state).not.toBe('STAGGER');
  });

  it('a headshot does full headshot damage and staggers it; the head is the weak point', () => {
    const t = enemyTestWorld({ targets: [new TestTarget(0, 30)] });
    const tank = t.manager.spawn('tank', [0, 0, 0], { patrol: false });
    expect(pistolHit(t, 'tank-1', 'HEAD')).toMatchObject({ amount: 65, critical: true });
    expect(tank?.state).toBe('STAGGER');
    const staggered = t.runUntil(() => tank?.state !== 'STAGGER', 2);
    expect(staggered).toBe(steps(T.staggerDuration));
  });

  it('dies to six headshots or about 28 body shots', () => {
    const heads = enemyTestWorld({ targets: [new TestTarget(0, 30)] });
    heads.manager.spawn('tank', [0, 0, 0], { patrol: false });
    const headKills: boolean[] = [];
    for (let i = 0; i < 6; i++) {
      headKills.push(pistolHit(heads, 'tank-1', 'HEAD')?.killed ?? false);
    }
    expect(headKills).toEqual([false, false, false, false, false, true]);

    const body = enemyTestWorld({ targets: [new TestTarget(0, 30)] });
    const tank = body.manager.spawn('tank', [0, 0, 0], { patrol: false });
    let shots = 0;
    while (tank?.alive && shots < 100) {
      pistolHit(body, 'tank-1', 'TORSO');
      shots++;
    }
    expect(shots).toBe(Math.ceil(T.health / 13));
    expect(body.of('died')).toEqual([expect.objectContaining({ id: 'tank-1', archetype: 'tank' })]);
  });

  it('hits hard, with a long telegraph, once per (long) cooldown', () => {
    const tough = new TestTarget(0, 4);
    tough.health = 1000;
    const t = enemyTestWorld({ targets: [tough] });
    t.manager.spawn('tank', [0, 0, 0], { patrol: false });
    const started: number[] = [];
    const struck: number[] = [];
    let i = 0;
    t.manager.events.on('attackStarted', () => started.push(i));
    t.manager.events.on('attackHit', () => struck.push(i));
    for (; i < steps(16); i++) {
      t.step();
    }
    expect(struck.length).toBeGreaterThanOrEqual(3);
    for (let k = 0; k < struck.length; k++) {
      expect((struck[k] ?? 0) - (started[k] ?? 0)).toBe(steps(T.attack.windup));
    }
    for (let k = 1; k < started.length; k++) {
      expect((started[k] ?? 0) - (started[k - 1] ?? 0)).toBe(steps(T.attackCooldown));
    }
    expect(tough.hits.every((h) => h.amount === T.attackDamage)).toBe(true);
    expect(T.attackDamage).toBeGreaterThan(W.attackDamage * 2);
  });

  it('has no ranged attack: a target out of reach is never hit', () => {
    const t = enemyTestWorld({ targets: [new TestTarget(0, 5)] });
    const tank = t.manager.spawn('tank', [0, 0, 0], { patrol: false });
    t.manager.alert('tank-1', t.target);
    // Keep the target just beyond its reach, backing off as it comes.
    for (let i = 0; i < steps(10); i++) {
      const p = tank!.motor.position; // eslint-disable-line @typescript-eslint/no-non-null-assertion
      if (t.target.position.z - p.z < T.attackRange + 1) {
        t.target.position.z = p.z + T.attackRange + 1.5;
      }
      t.step();
    }
    expect(t.of('attackStarted')).toEqual([]);
    expect(t.target.hits).toEqual([]);
  });

  it('a big body: it still fits through the test doorway to reach a target behind the wall', () => {
    const t = enemyTestWorld({ targets: [new TestTarget(0, -16)] });
    const tank = t.manager.spawn('tank', [0, 0, -4], { patrol: false });
    t.manager.alert('tank-1', t.target);
    expect(t.runUntil(() => tank?.state === 'ATTACK', 30)).toBeGreaterThan(0);
    expect(tank?.motor.position.z).toBeLessThan(-12);
  });
});
