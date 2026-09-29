/**
 * The Screamer (D-043): the support behaviour, its telegraphed scream, the generic `alarm` event
 * and the manager's prototype response (nearby enemies alerted and hastened). Same test world as
 * the Walker's (see `testWorld.ts`).
 */

import { describe, expect, it } from 'vitest';
import { ENEMY_STATS } from '../../config/enemies';
import { DT, enemyTestWorld, TestTarget } from '../testWorld';

const S = ENEMY_STATS.screamer;
const W = ENEMY_STATS.walker;
const ability = S.ability!; // eslint-disable-line @typescript-eslint/no-non-null-assertion
const steps = (seconds: number) => Math.round(seconds / DT);

/** A Screamer at the origin and a target 12 m south: in sight and within its scream range. */
function screamerScene(targetZ = 12) {
  const t = enemyTestWorld({ targets: [new TestTarget(0, targetZ)] });
  const screamer = t.manager.spawn('screamer', [0, 0, 0], { patrol: false });
  if (!screamer) {
    throw new Error('no spawn');
  }
  return { t, screamer };
}

describe('Screamer: detection and the scream', () => {
  it('notices a target beyond a Walker’s range, then screams at it after its reaction time', () => {
    const { t, screamer } = screamerScene(13);
    expect(S.detectionRange).toBeGreaterThan(W.detectionRange);
    t.runUntil(() => screamer.state === 'DETECT', 1);
    expect(t.of('targetAcquired')).toEqual([
      { id: 'screamer-1', targetId: 'player', alerted: false },
    ]);
    const reaction = t.runUntil(() => screamer.state !== 'DETECT', 2);
    expect(reaction).toBe(steps(S.perception.reactionTime));
    expect(screamer.state).toBe('ATTACK');
    expect(t.of('attackStarted')).toEqual([
      { id: 'screamer-1', targetId: 'player', windup: S.attack.windup, kind: 'scream' },
    ]);
  });

  it('does not scream at a target it cannot see (behind the wall)', () => {
    const t = enemyTestWorld({ targets: [new TestTarget(8, -4)] });
    t.manager.spawn('screamer', [8, 0, -14], { patrol: false });
    t.seconds(5);
    expect(t.of('attackStarted')).toEqual([]);
    expect(t.of('alarm')).toEqual([]);
  });

  it('told where a target is, it still does not scream without a line of sight to it', () => {
    // North of the wall, the target 10 m south of it, away from the doorway.
    const t = enemyTestWorld({ targets: [new TestTarget(8, -4)] });
    const screamer = t.manager.spawn('screamer', [8, 0, -14], { patrol: false });
    t.manager.alert('screamer-1', t.target);
    t.seconds(2.5);
    expect(screamer?.target?.id).toBe('player');
    expect(screamer?.canSeeTarget).toBe(false);
    expect(t.of('attackStarted')).toEqual([]);
  });

  it('telegraphs: arms raised, facing the target, for its whole wind-up; then the alarm', () => {
    const { t, screamer } = screamerScene();
    t.runUntil(() => screamer.attackPhase === 'windup', 3);
    expect(screamer.rig.definition).toBe(S.attackPose);
    const windup = t.runUntil(() => t.of('alarm').length > 0, 3);
    expect(windup).toBe(steps(S.attack.windup));
    expect(screamer.attackPhase).toBe('recovery');
    t.seconds(S.attack.recovery + 0.05);
    expect(screamer.attackPhase).toBe('none');
    expect(screamer.rig.definition).toBe(S.rig);
  });

  it('the alarm carries what a listener needs, and nothing Screamer-specific', () => {
    const { t, screamer } = screamerScene();
    t.runUntil(() => t.of('alarm').length > 0, 5);
    const p = screamer.motor.position;
    expect(t.of('alarm')).toEqual([
      {
        sourceId: 'screamer-1',
        kind: 'scream',
        reinforcements: true,
        position: [p.x, p.y, p.z],
        radius: ability.radius,
        targetId: 'player',
        targetPosition: [0, 0, 12],
        alertDuration: ability.alertDuration,
        haste: { multiplier: ability.haste.multiplier, duration: ability.haste.duration },
        time: t.manager.now,
      },
    ]);
  });

  it('never deals damage itself, however close the target', () => {
    const { t } = screamerScene(1.5);
    t.seconds(25);
    expect(t.of('alarm').length).toBeGreaterThanOrEqual(2);
    expect(t.target.hits).toEqual([]);
    expect(t.of('attackHit')).toEqual([]);
  });
});

describe('Screamer: cooldown and interruption', () => {
  it('screams again exactly one cooldown after the last scream started', () => {
    const { t } = screamerScene();
    const started: number[] = [];
    let i = 0;
    t.manager.events.on('attackStarted', () => started.push(i));
    for (; i < steps(25); i++) {
      t.step();
    }
    expect(started.length).toBe(3);
    expect((started[1] ?? 0) - (started[0] ?? 0)).toBe(steps(S.attackCooldown));
    expect((started[2] ?? 0) - (started[1] ?? 0)).toBe(steps(S.attackCooldown));
    expect(t.of('alarm')).toHaveLength(3);
  });

  it('a solid hit during the wind-up staggers it: no alarm, and the cooldown is still spent', () => {
    const { t, screamer } = screamerScene();
    const started: number[] = [];
    let i = 0;
    t.manager.events.on('attackStarted', () => started.push(i));
    for (; screamer.attackPhase !== 'windup' && i < steps(5); i++) {
      t.step();
    }
    t.combat.applyDamage('screamer-1', { amount: S.staggerThreshold });
    expect(screamer.state).toBe('STAGGER');
    expect(t.of('attackCancelled')).toEqual([{ id: 'screamer-1', reason: 'stagger' }]);
    for (; i < steps(S.attackCooldown + 3); i++) {
      t.step();
      if (started.length === 1) {
        expect(t.of('alarm')).toEqual([]); // nothing went off until the next scream
      }
    }
    expect(started.length).toBe(2);
    expect((started[1] ?? 0) - (started[0] ?? 0)).toBe(steps(S.attackCooldown));
  });

  it('a hit below its stagger threshold does not interrupt', () => {
    const { t, screamer } = screamerScene();
    t.runUntil(() => screamer.attackPhase === 'windup', 3);
    t.combat.applyDamage('screamer-1', { amount: S.staggerThreshold - 5 });
    expect(screamer.attackPhase).toBe('windup');
    t.runUntil(() => t.of('alarm').length > 0, 3);
    expect(t.of('alarm')).toHaveLength(1);
  });

  it('killed during the wind-up: cancelled, and no alarm ever', () => {
    const { t, screamer } = screamerScene();
    t.runUntil(() => screamer.attackPhase === 'windup', 3);
    t.manager.kill('screamer-1');
    expect(t.of('attackCancelled')).toEqual([{ id: 'screamer-1', reason: 'death' }]);
    t.seconds(3);
    expect(t.of('alarm')).toEqual([]);
  });

  it('forceAttack screams now, ignoring the cooldown', () => {
    const { t, screamer } = screamerScene();
    t.runUntil(() => t.of('alarm').length === 1, 5);
    t.seconds(S.attack.recovery + 0.1);
    expect(screamer.attackCooldown).toBeGreaterThan(5);
    expect(t.manager.forceAttack('screamer-1')).toBe(true);
    expect(screamer.attackPhase).toBe('windup');
    expect(t.manager.forceAttack('screamer-1')).toBe(false); // already screaming
    t.seconds(S.attack.windup + 0.05);
    expect(t.of('alarm')).toHaveLength(2);
  });
});

describe('Screamer: keeping its distance', () => {
  it('backs away from a target that comes too close', () => {
    const { t, screamer } = screamerScene(2.5);
    // Let the first scream finish, then watch it back off.
    t.runUntil(() => t.of('alarm').length > 0, 5);
    t.seconds(S.attack.recovery + 3);
    const d = Math.hypot(screamer.motor.position.x, screamer.motor.position.z - 2.5);
    expect(d).toBeGreaterThan(4.5);
    expect(screamer.motor.position.z).toBeLessThan(0); // away from the target (north)
  });

  it('holds its ground inside its preferred band', () => {
    const at = (S.preferredRange!.min + S.preferredRange!.max) / 2; // eslint-disable-line @typescript-eslint/no-non-null-assertion
    const { t, screamer } = screamerScene(at);
    t.runUntil(() => t.of('alarm').length > 0, 5);
    const before = screamer.motor.position.clone();
    t.seconds(4);
    expect(screamer.motor.position.distanceTo(before)).toBeLessThan(0.2);
  });

  it('closes in on a target it knows about beyond its band', () => {
    const { t, screamer } = screamerScene(25);
    t.manager.alert('screamer-1', t.target);
    t.runUntil(() => t.of('alarm').length > 0, 20);
    const d = Math.hypot(screamer.motor.position.x, screamer.motor.position.z - 25);
    expect(d).toBeLessThanOrEqual(S.attackRange);
  });
});

describe('the alarm’s prototype response (EnemyManager)', () => {
  function withListeners() {
    const t = enemyTestWorld({ targets: [new TestTarget(0, 12)] });
    const screamer = t.manager.spawn('screamer', [0, 0, 0], { patrol: false });
    // Out of sight range of the target (17 m), well within the scream's radius.
    const near = t.manager.spawn('walker', [-6, 0, -4], { patrol: false });
    // Beyond the scream's radius.
    const far = t.manager.spawn('walker', [22, 0, -12], { patrol: false });
    if (!screamer || !near || !far) {
      throw new Error('no spawn');
    }
    return { t, screamer, near, far };
  }

  it('enemies within its radius are told where the target is and hastened; others are not', () => {
    const { t, near, far } = withListeners();
    t.runUntil(() => t.of('alarm').length > 0, 5);
    const now = t.manager.now;
    expect(near.target?.id).toBe('player');
    expect(near.state).toBe('DETECT');
    expect(near.hasteMultiplier).toBe(ability.haste.multiplier);
    expect(near.hasteUntil).toBeCloseTo(now + ability.haste.duration, 9);
    expect(t.of('hasted')).toEqual([
      { id: 'walker-2', multiplier: ability.haste.multiplier, until: near.hasteUntil },
    ]);
    expect(far.target).toBeNull();
    expect(far.haste(now)).toBe(1);
    expect(t.manager.get('screamer-1')?.haste(now)).toBe(1); // not itself
  });

  it('a hastened enemy really moves faster, until the haste runs out', () => {
    const { t, near } = withListeners();
    t.runUntil(() => t.of('alarm').length > 0, 5);
    const top = (seconds: number) => {
      let best = 0;
      for (let i = 0; i < steps(seconds); i++) {
        const before = near.motor.position.clone();
        t.step();
        best = Math.max(best, near.motor.position.distanceTo(before) / DT);
      }
      return best;
    };
    const hastened = top(ability.haste.duration - 0.5);
    expect(hastened).toBeGreaterThan(W.moveSpeed * 1.2);
    expect(hastened).toBeLessThanOrEqual(W.moveSpeed * ability.haste.multiplier + 0.02);
    t.seconds(0.6);
    expect(near.haste(t.manager.now)).toBe(1);
    const after = top(1);
    expect(after).toBeLessThanOrEqual(W.moveSpeed + 0.02);
  });

  it('the alert lasts its duration: then a listener far from the target lets it go', () => {
    const { t, near } = withListeners();
    t.runUntil(() => t.of('alarm').length > 0, 5);
    t.manager.kill('screamer-1'); // no more screams
    // Far out of range and sight: told where it is, the Walker keeps it for alertDuration…
    t.target.position.set(29, 0, 29);
    t.seconds(ability.alertDuration - 0.5);
    expect(near.target?.id).toBe('player');
    expect(Math.hypot(near.motor.position.x - 29, near.motor.position.z - 29)).toBeGreaterThan(
      W.perception.loseTargetRange,
    );
    // …then drops it (beyond its lose-target range).
    t.seconds(1);
    expect(near.target).toBeNull();
    expect(t.of('targetLost')).toEqual([{ id: 'walker-2', targetId: 'player', reason: 'range' }]);
  });

  it('repeated alarms refresh the haste; they do not stack it', () => {
    const { t, near } = withListeners();
    t.runUntil(() => t.of('alarm').length > 0, 5);
    t.seconds(2);
    t.manager.forceAttack('screamer-1');
    t.runUntil(() => t.of('alarm').length > 1, 5);
    expect(near.hasteMultiplier).toBe(ability.haste.multiplier);
    expect(near.hasteUntil).toBeCloseTo(t.manager.now + ability.haste.duration, 9);
  });

  it('any source can raise an alarm: the response does not depend on a Screamer', () => {
    const t = enemyTestWorld({ targets: [new TestTarget(0, 20)] });
    const walker = t.manager.spawn('walker', [0, 0, 0], { patrol: false });
    t.manager.events.emit('alarm', {
      sourceId: 'somewhere',
      kind: 'scream',
      reinforcements: true,
      position: [0, 0, 5],
      radius: 10,
      targetId: 'player',
      targetPosition: [0, 0, 20],
      alertDuration: 3,
      haste: null,
      time: 0,
    });
    expect(walker?.target?.id).toBe('player');
    expect(walker?.haste(0)).toBe(1);
    expect(t.of('hasted')).toEqual([]);
  });

  it('dead enemies do not respond', () => {
    const { t, near } = withListeners();
    t.manager.kill('walker-2');
    t.runUntil(() => t.of('alarm').length > 0, 5);
    expect(near.target).toBeNull();
    expect(t.of('hasted').map((h) => h.id)).not.toContain('walker-2');
  });
});
