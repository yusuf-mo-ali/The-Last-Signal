/**
 * The Spitter (D-046): the ranged behaviour, its telegraphed spit and the acid it throws. Same test
 * world as the other archetypes (an open floor with a wall and a doorway, see `testWorld.ts`), with
 * `EnemyProjectiles` flying the acid as in the game.
 */

import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { HitInput } from '../../combat/CombatSystem';
import { ENEMY_STATS } from '../../config/enemies';
import { PLAYER_MOVEMENT } from '../../config/player';
import { DT, enemyTestWorld, TestTarget } from '../testWorld';
import { lobVelocity } from './rangedBrain';

const P = ENEMY_STATS.spitter;
const acid = P.projectile!; // eslint-disable-line @typescript-eslint/no-non-null-assertion
const steps = (seconds: number) => Math.round(seconds / DT);

type World = ReturnType<typeof enemyTestWorld>;

/** A Spitter at the origin, the target `distance` m south (in the open, in sight). */
function spitterScene(distance = 14) {
  const t = enemyTestWorld({ targets: [new TestTarget(0, distance)] });
  t.target.health = 1e6;
  const spitter = t.manager.spawn('spitter', [0, 0, 0], { patrol: false });
  if (!spitter) {
    throw new Error('no spawn');
  }
  return { t, spitter };
}

function pistolBodyShot(t: World, id: string) {
  const hit: HitInput = {
    targetId: id,
    zone: 'TORSO',
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

function impacts(t: World) {
  const out: { kind: string; amount: number; damage: number; targetId: string | null }[] = [];
  t.projectiles.events.on('projectileImpact', (e) =>
    out.push({ kind: e.kind, amount: e.amount, damage: e.damage, targetId: e.targetId }),
  );
  return out;
}

describe('Spitter: the telegraphed spit', () => {
  it('notices, then winds up for exactly its wind-up; the acid leaves at its end', () => {
    const { t, spitter } = spitterScene();
    t.runUntil(() => spitter.attackPhase === 'windup', 3);
    expect(t.of('attackStarted')).toEqual([
      { id: 'spitter-1', targetId: 'player', windup: P.attack.windup, kind: 'spit' },
    ]);
    expect(t.of('spat')).toEqual([]);
    const windup = t.runUntil(() => t.of('spat').length > 0, 3);
    expect(windup).toBe(steps(P.attack.windup));
    expect(t.projectiles.count).toBe(1);
    expect(spitter.attackPhase).toBe('recovery');
  });

  it('spits again exactly one cooldown after the last spit started', () => {
    const { t } = spitterScene();
    const started: number[] = [];
    let i = 0;
    t.manager.events.on('attackStarted', () => started.push(i));
    for (; i < steps(9); i++) {
      t.step();
    }
    expect(started.length).toBe(3);
    expect((started[1] ?? 0) - (started[0] ?? 0)).toBe(steps(P.attackCooldown));
    expect((started[2] ?? 0) - (started[1] ?? 0)).toBe(steps(P.attackCooldown));
  });

  it('standing still costs the direct damage; it never strikes in melee', () => {
    const { t } = spitterScene();
    const hits = impacts(t);
    t.runUntil(() => hits.length > 0, 5);
    expect(hits[0]).toEqual({
      kind: 'direct',
      damage: acid.damage,
      amount: acid.damage,
      targetId: 'player',
    });
    expect(t.target.hits).toEqual([
      expect.objectContaining({
        amount: acid.damage,
        attackerId: 'spitter-1',
        archetype: 'spitter',
      }),
    ]);
    expect(t.of('attackHit')).toEqual([]);
  });

  it('the flight takes about a second at 14 m: strafing at walking speed dodges it', () => {
    const { t } = spitterScene();
    const hits = impacts(t);
    t.runUntil(() => t.of('spat').length > 0, 5);
    const fired = t.manager.now;
    // Strafe east at walking speed as soon as the acid leaves.
    t.runUntil(() => {
      t.target.position.x += PLAYER_MOVEMENT.walkSpeed * DT;
      return hits.length > 0;
    }, 4);
    const flight = t.manager.now - fired;
    expect(flight).toBeGreaterThan(0.9);
    expect(flight).toBeLessThan(1.4);
    expect(hits[0]?.kind).not.toBe('direct');
    expect(hits[0]?.amount).toBe(0);
    expect(t.target.hits).toEqual([]);
  });

  it('a stagger during the wind-up spoils the spit: nothing thrown, the cooldown still spent', () => {
    const { t, spitter } = spitterScene();
    t.runUntil(() => spitter.attackPhase === 'windup', 3);
    pistolBodyShot(t, 'spitter-1');
    expect(spitter.state).toBe('STAGGER');
    expect(t.of('attackCancelled')).toEqual([{ id: 'spitter-1', reason: 'stagger' }]);
    t.seconds(P.attack.windup + 0.5);
    expect(t.of('spat')).toEqual([]);
    expect(t.projectiles.count).toBe(0);
    expect(spitter.attackCooldown).toBeGreaterThan(0);
  });

  it('dies to two Pistol headshots or three body shots', () => {
    const headshot = 26 * 2.5;
    expect(headshot).toBeLessThan(P.health);
    expect(headshot * 2).toBeGreaterThanOrEqual(P.health);
    expect(26 * 2).toBeLessThan(P.health);
    expect(26 * 3).toBeGreaterThanOrEqual(P.health);
  });
});

describe('Spitter: keeping its distance, never firing blind', () => {
  it('closes in from beyond its band, and only spits within its fire range', () => {
    const { t, spitter } = spitterScene(21);
    const at: number[] = [];
    t.manager.events.on('attackStarted', () =>
      at.push(Math.hypot(spitter.motor.position.x, spitter.motor.position.z - 21)),
    );
    t.seconds(6);
    expect(at.length).toBeGreaterThan(0);
    for (const d of at) {
      expect(d).toBeLessThanOrEqual(P.attackRange + 0.01);
    }
    expect(Math.hypot(spitter.motor.position.x, spitter.motor.position.z - 21)).toBeLessThan(
      P.preferredRange?.max ?? 0,
    );
  });

  it('holds its ground inside its band', () => {
    const { t, spitter } = spitterScene(13);
    t.seconds(1);
    const before = spitter.motor.position.clone();
    t.seconds(3);
    expect(spitter.motor.position.distanceTo(before)).toBeLessThan(0.3);
  });

  it('backs away from a target that comes too close, and spits only once it is clear', () => {
    const { t, spitter } = spitterScene(5);
    const retreat = P.preferredRange?.retreat ?? 0;
    const distance = () => Math.hypot(spitter.motor.position.x, spitter.motor.position.z - 5);
    const at: number[] = [];
    t.manager.events.on('attackStarted', () => at.push(distance()));
    t.seconds(6);
    expect(distance()).toBeGreaterThanOrEqual(retreat - 0.5);
    expect(at.length).toBeGreaterThan(0);
    for (const d of at) {
      expect(d).toBeGreaterThanOrEqual(retreat - 0.5);
    }
  });

  it('cornered (nowhere to back away to), it spits where it stands', () => {
    // Against the wall's south face, the target right in front of it.
    const t = enemyTestWorld({ targets: [new TestTarget(8, -6)] });
    t.target.health = 1e6;
    t.manager.spawn('spitter', [8, 0, -9.6], { patrol: false, yaw: Math.PI });
    t.manager.alert('spitter-1', t.target);
    t.seconds(4);
    expect(t.of('attackStarted').length).toBeGreaterThan(0);
  });

  it('never spits at a target it cannot see (behind the wall), even when told where it is', () => {
    const t = enemyTestWorld({ targets: [new TestTarget(8, -4)] });
    t.manager.spawn('spitter', [8, 0, -16], { patrol: false });
    t.manager.alert('spitter-1', t.target);
    t.seconds(1.5);
    expect(t.of('attackStarted')).toEqual([]);
    expect(t.of('spat')).toEqual([]);
  });
});

describe('the acid (EnemyProjectiles)', () => {
  const at = (x: number, y: number, z: number) => new Vector3(x, y, z);

  it('the arc is the flatter of the two and leaves at the projectile speed', () => {
    const v = new Vector3();
    expect(lobVelocity(at(0, 1.4, 0), at(0, 1.2, 14), acid.speed, acid.gravity, v)).toBe(true);
    expect(v.length()).toBeCloseTo(acid.speed, 6);
    expect(Math.atan2(v.y, Math.hypot(v.x, v.z))).toBeLessThan(Math.PI / 4);
    // Out of reach: thrown at 45°, the farthest it can go.
    expect(lobVelocity(at(0, 1.4, 0), at(0, 0, 60), acid.speed, acid.gravity, v)).toBe(false);
    expect(Math.atan2(v.y, Math.hypot(v.x, v.z))).toBeCloseTo(Math.PI / 4, 6);
  });

  it('bursts on the floor next to a target: splash damage within its radius only', () => {
    const t = enemyTestWorld({ targets: [new TestTarget(0, 0)] });
    const hits = impacts(t);
    // Straight down onto the floor 1 m from the target's body (within the splash radius).
    t.projectiles.fire('spitter-x', 'spitter', [1 + 0.35, 1, 0], [0, -5, 0], acid);
    t.seconds(0.5);
    expect(hits).toEqual([
      { kind: 'splash', damage: acid.splashDamage, amount: acid.splashDamage, targetId: 'player' },
    ]);
    // 3 m away: out of reach.
    t.projectiles.fire('spitter-x', 'spitter', [3 + 0.35, 1, 0], [0, -5, 0], acid);
    t.seconds(0.5);
    expect(hits[1]).toEqual({ kind: 'splash', damage: 0, amount: 0, targetId: null });
    expect(t.target.hits).toHaveLength(1);
  });

  it('never splashes through a wall', () => {
    // The target just north of the wall (z −10.4…−10), the burst just south of it.
    const t = enemyTestWorld({ targets: [new TestTarget(8, -10.9)] });
    const hits = impacts(t);
    t.projectiles.fire('spitter-x', 'spitter', [8, 1, -9.6], [0, -5, 0], acid);
    t.seconds(0.5);
    expect(hits[0]?.kind).toBe('splash');
    expect(hits[0]?.amount).toBe(0);
    expect(t.target.hits).toEqual([]);
  });

  it('a wall stops it: the target behind it is not hit', () => {
    const t = enemyTestWorld({ targets: [new TestTarget(8, -14)] });
    const hits = impacts(t);
    // Thrown north at the wall from the south side, aimed at the target behind it.
    t.projectiles.fire('spitter-x', 'spitter', [8, 1.4, -4], [0, 0, -13], { ...acid, gravity: 0 });
    t.seconds(1.5);
    expect(hits[0]?.kind).toBe('splash');
    expect(t.target.hits).toEqual([]);
  });

  it('D-029: a target that cannot be hurt now takes nothing (the hit is still reported)', () => {
    const { t } = spitterScene();
    t.target.vulnerable = false;
    const hits = impacts(t);
    t.runUntil(() => hits.length > 0, 5);
    expect(hits[0]).toMatchObject({ kind: 'direct', damage: acid.damage, amount: 0 });
  });

  it('expires harmlessly after its lifetime; the pool holds 32 and clear() empties it', () => {
    const t = enemyTestWorld({ targets: [new TestTarget(0, 0)] });
    const hits = impacts(t);
    t.projectiles.fire('spitter-x', 'spitter', [20, 2, 20], [0, 0, 0], { ...acid, gravity: 0 });
    t.seconds(acid.lifetime + 0.1);
    expect(hits).toEqual([{ kind: 'expired', damage: 0, amount: 0, targetId: null }]);
    for (let i = 0; i < 40; i++) {
      t.projectiles.fire('spitter-x', 'spitter', [20, 2, 20], [0, 0, 0], { ...acid, gravity: 0 });
    }
    expect(t.projectiles.count).toBe(32);
    expect(t.projectiles.stats.dropped).toBe(8);
    t.projectiles.clear();
    expect(t.projectiles.count).toBe(0);
  });

  it('holds still while inactive (paused)', () => {
    const t = enemyTestWorld({ targets: [new TestTarget(0, 0)] });
    t.projectiles.fire('spitter-x', 'spitter', [20, 2, 20], [1, 0, 0], { ...acid, gravity: 0 });
    t.setActive(false);
    t.seconds(1);
    expect(t.projectiles.slots[0]?.position.toArray()).toEqual([20, 2, 20]);
    t.setActive(true);
    t.seconds(1);
    expect(t.projectiles.slots[0]?.position.x).toBeCloseTo(21, 6);
  });

  it('the same spit flies the same way every time (deterministic)', () => {
    const run = () => {
      const { t } = spitterScene();
      const path: string[] = [];
      t.projectiles.events.on('projectileImpact', (e) =>
        path.push(e.position.map((v) => v.toFixed(6)).join(',')),
      );
      t.seconds(5);
      return path;
    };
    const a = run();
    expect(a.length).toBeGreaterThan(0);
    expect(run()).toEqual(a);
  });
});
