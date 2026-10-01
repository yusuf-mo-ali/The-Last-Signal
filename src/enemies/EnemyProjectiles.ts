/**
 * Enemy projectiles (D-046): the Spitter's acid. A fixed-step system that flies every projectile a
 * ranged attacker lets fly (the `spat` enemy event) and applies its hit. Simulation only; the
 * presentation (`ProjectileView`) draws `slots`.
 *
 * - A fixed pool (`capacity`, created up front): no allocation while flying. A shot when the pool
 *   is full is dropped (never seen in play: a few Spitters, one shot every few seconds).
 * - Each step: gravity, then a swept test of the step's segment against the level (a ray) and
 *   against each target's body (a capsule from its feet to just above its eyes). Whichever comes
 *   first along the segment wins.
 * - A direct hit deals the archetype's `projectile.damage`; hitting the level, it splashes
 *   `splashDamage` on targets within `splashRadius` that the impact can see (never through walls).
 *   Every hit goes through `EnemyTarget.receiveHit`, so the player's own rules decide whether it
 *   hurts (D-029: only while a wave is being fought). It never hits enemies.
 * - It expires harmlessly after `lifetime` seconds or below the kill plane.
 * - Deterministic: no randomness, fixed steps. Holds still while `active()` is false (paused);
 *   `clear()` removes everything (the wave's end, death, a new run).
 */

import { Vector3 } from 'three';
import { enemyConfig, type EnemyArchetypeConfig } from '../config/enemies';
import { EventBus } from '../core/EventBus';
import type { FixedUpdateSystem } from '../core/Game';
import type { CollisionWorld } from '../physics/CollisionWorld';
import type { Vec3Tuple } from '../weapons/types';
import type { EnemyEvents } from './events';
import type { EnemyTarget } from './types';

export type ProjectileParams = NonNullable<EnemyArchetypeConfig['projectile']>;

export type ImpactKind = 'direct' | 'splash' | 'expired';

export interface ProjectileEvents {
  projectileFired: {
    readonly id: number;
    readonly ownerId: string;
    readonly position: Vec3Tuple;
    readonly velocity: Vec3Tuple;
  };
  projectileImpact: {
    readonly id: number;
    readonly ownerId: string;
    readonly position: Vec3Tuple;
    /** `direct`: it struck a target; `splash`: it burst on the level; `expired`: it fizzled. */
    readonly kind: ImpactKind;
    /** The target it struck or splashed (the first, if several), or null. */
    readonly targetId: string | null;
    /** Damage dealt, and health actually removed (0 when the target could not be hurt now). */
    readonly damage: number;
    readonly amount: number;
  };
}

/** One projectile slot. Read by the view; written only here. */
export interface ProjectileSlot {
  active: boolean;
  /** Unique per shot within the run. */
  id: number;
  ownerId: string;
  /** The archetype that threw it (reported with its hits). */
  archetype: string;
  readonly position: Vector3;
  readonly previous: Vector3;
  readonly velocity: Vector3;
  age: number;
  params: ProjectileParams;
}

export interface EnemyProjectilesOptions {
  readonly world: CollisionWorld;
  /** Everything a projectile can hit (the player). Read every step. */
  readonly targets: () => readonly EnemyTarget[];
  /** Whether projectiles fly this step (false: paused, menus). */
  readonly active: () => boolean;
  /** Below this height a projectile is gone. */
  readonly killPlaneY: number;
  /** Where shots come from: `spat` events. */
  readonly enemyEvents?: EventBus<EnemyEvents>;
  readonly capacity?: number;
}

/** How far above its eyes a target's body reaches (the top of its head). */
const HEAD_ABOVE_EYES = 0.15;
/** An impact is moved this far back along the flight before splash sight tests (off the wall). */
const IMPACT_BACKOFF = 0.05;

const NONE: ProjectileParams = {
  speed: 0,
  gravity: 0,
  radius: 0,
  damage: 0,
  splashDamage: 0,
  splashRadius: 0,
  lifetime: 0,
};

const _dir = new Vector3();
const _a0 = new Vector3();
const _a1 = new Vector3();
const _onAxis = new Vector3();
const _impact = new Vector3();
const _toTarget = new Vector3();
const _closest = { s: 0, distance: 0 };

export class EnemyProjectiles implements FixedUpdateSystem {
  readonly events = new EventBus<ProjectileEvents>();
  readonly slots: readonly ProjectileSlot[];
  /** Counters for tests and debug tools. */
  readonly stats = { fired: 0, dropped: 0, direct: 0, splash: 0, expired: 0 };

  private readonly world: CollisionWorld;
  private readonly targets: () => readonly EnemyTarget[];
  private readonly active: () => boolean;
  private readonly killPlaneY: number;
  private readonly unsubscribe: (() => void)[] = [];
  private nextId = 1;

  constructor(options: EnemyProjectilesOptions) {
    this.world = options.world;
    this.targets = options.targets;
    this.active = options.active;
    this.killPlaneY = options.killPlaneY;
    this.slots = Array.from({ length: options.capacity ?? 32 }, () => ({
      active: false,
      id: 0,
      ownerId: '',
      archetype: '',
      position: new Vector3(),
      previous: new Vector3(),
      velocity: new Vector3(),
      age: 0,
      params: NONE,
    }));
    if (options.enemyEvents) {
      this.unsubscribe.push(
        options.enemyEvents.on('spat', (e) => {
          const params = enemyConfig(e.archetype).projectile;
          if (params) {
            this.fire(e.id, e.archetype, e.position, e.velocity, params);
          }
        }),
      );
    }
  }

  /** Projectiles in flight. */
  get count(): number {
    let n = 0;
    for (const p of this.slots) {
      if (p.active) {
        n++;
      }
    }
    return n;
  }

  /** Launches a projectile. Returns its id, or 0 when the pool is full (the shot is dropped). */
  fire(
    ownerId: string,
    archetype: string,
    position: Vec3Tuple,
    velocity: Vec3Tuple,
    params: ProjectileParams,
  ): number {
    const slot = this.slots.find((p) => !p.active);
    if (!slot) {
      this.stats.dropped++;
      return 0;
    }
    slot.active = true;
    slot.id = this.nextId++;
    slot.ownerId = ownerId;
    slot.archetype = archetype;
    slot.position.set(...position);
    slot.previous.copy(slot.position);
    slot.velocity.set(...velocity);
    slot.age = 0;
    slot.params = params;
    this.stats.fired++;
    this.events.emit('projectileFired', { id: slot.id, ownerId, position, velocity });
    return slot.id;
  }

  /** Removes every projectile at once (no impacts). */
  clear(): void {
    for (const p of this.slots) {
      p.active = false;
    }
  }

  dispose(): void {
    for (const off of this.unsubscribe) {
      off();
    }
    this.unsubscribe.length = 0;
    this.clear();
  }

  fixedUpdate(dt: number): void {
    if (!this.active()) {
      for (const p of this.slots) {
        p.previous.copy(p.position);
      }
      return;
    }
    const targets = this.targets();
    for (const p of this.slots) {
      if (p.active) {
        this.step(p, dt, targets);
      }
    }
  }

  private step(p: ProjectileSlot, dt: number, targets: readonly EnemyTarget[]): void {
    const { params } = p;
    p.previous.copy(p.position);
    // Semi-implicit Euler: the same arc at any frame rate (fixed steps).
    p.velocity.y -= params.gravity * dt;
    p.position.addScaledVector(p.velocity, dt);
    p.age += dt;
    const length = p.previous.distanceTo(p.position);
    let levelAt = Number.POSITIVE_INFINITY;
    if (length > 1e-9) {
      _dir.copy(p.position).sub(p.previous).divideScalar(length);
      const hit = this.world.raycast(p.previous, _dir, length);
      if (hit) {
        levelAt = hit.distance / length;
      }
    }
    // The first target body the segment touches, if before the level.
    let struck: EnemyTarget | null = null;
    let struckAt = levelAt;
    for (const target of targets) {
      if (!target.isAlive()) {
        continue;
      }
      capsuleOf(target, _a0, _a1);
      closestOnSegments(p.previous, p.position, _a0, _a1, _closest);
      if (_closest.distance <= params.radius + target.radius && _closest.s <= struckAt) {
        struck = target;
        struckAt = _closest.s;
      }
    }
    if (struck) {
      _impact.copy(p.previous).lerp(p.position, struckAt);
      const damage = params.damage;
      const amount = struck.receiveHit({
        amount: damage,
        attackerId: p.ownerId,
        archetype: p.archetype,
        direction: horizontalDirection(p.velocity),
      });
      this.stats.direct++;
      this.end(p, 'direct', struck.id, damage, amount);
      return;
    }
    if (levelAt <= 1) {
      _impact.copy(p.previous).lerp(p.position, levelAt).addScaledVector(_dir, -IMPACT_BACKOFF);
      this.splash(p, targets);
      return;
    }
    if (p.age >= params.lifetime || p.position.y < this.killPlaneY) {
      _impact.copy(p.position);
      this.stats.expired++;
      this.end(p, 'expired', null, 0, 0);
    }
  }

  /** Burst on the level at `_impact`: targets within reach that it can see take splash damage. */
  private splash(p: ProjectileSlot, targets: readonly EnemyTarget[]): void {
    const { params } = p;
    let firstId: string | null = null;
    let damage = 0;
    let amount = 0;
    for (const target of targets) {
      if (!target.isAlive() || params.splashDamage <= 0) {
        continue;
      }
      capsuleOf(target, _a0, _a1);
      closestOnSegment(_impact, _a0, _a1, _onAxis);
      const reach = _impact.distanceTo(_onAxis) - target.radius;
      if (reach > params.splashRadius || !this.unobstructed(_impact, _onAxis)) {
        continue;
      }
      _toTarget.copy(_onAxis).sub(_impact);
      const removed = target.receiveHit({
        amount: params.splashDamage,
        attackerId: p.ownerId,
        archetype: p.archetype,
        direction: horizontalDirection(_toTarget),
      });
      if (firstId === null) {
        firstId = target.id;
        damage = params.splashDamage;
        amount = removed;
      }
    }
    this.stats.splash++;
    this.end(p, 'splash', firstId, damage, amount);
  }

  /** Nothing solid between two points. */
  private unobstructed(from: Vector3, to: Vector3): boolean {
    const d = from.distanceTo(to);
    if (d < 1e-6) {
      return true;
    }
    _dir.copy(to).sub(from).divideScalar(d);
    return this.world.raycast(from, _dir, d) === null;
  }

  private end(
    p: ProjectileSlot,
    kind: ImpactKind,
    targetId: string | null,
    damage: number,
    amount: number,
  ): void {
    p.active = false;
    this.events.emit('projectileImpact', {
      id: p.id,
      ownerId: p.ownerId,
      position: [_impact.x, _impact.y, _impact.z],
      kind,
      targetId,
      damage,
      amount,
    });
  }
}

/** A target's body as a capsule axis (the ends are `radius` in from its feet and head). */
function capsuleOf(target: EnemyTarget, a0: Vector3, a1: Vector3): void {
  const top = target.eyeHeight + HEAD_ABOVE_EYES;
  const r = Math.min(target.radius, top / 2);
  a0.copy(target.position).setY(target.position.y + r);
  a1.copy(target.position).setY(target.position.y + top - r);
}

function horizontalDirection(v: Vector3): Vec3Tuple {
  const length = Math.hypot(v.x, v.z);
  return length < 1e-9 ? [0, 0, -1] : [v.x / length, 0, v.z / length];
}

/** The point of segment `a`–`b` closest to `p`. */
function closestOnSegment(p: Vector3, a: Vector3, b: Vector3, out: Vector3): Vector3 {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const abz = b.z - a.z;
  const len2 = abx * abx + aby * aby + abz * abz;
  const t =
    len2 < 1e-12
      ? 0
      : Math.min(
          1,
          Math.max(0, ((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / len2),
        );
  return out.set(a.x + abx * t, a.y + aby * t, a.z + abz * t);
}

/**
 * Closest approach of segments `p0`–`p1` and `q0`–`q1`: the distance, and where along the first
 * (`s`, 0–1) it happens.
 */
export function closestOnSegments(
  p0: Vector3,
  p1: Vector3,
  q0: Vector3,
  q1: Vector3,
  out: { s: number; distance: number },
): { s: number; distance: number } {
  const d1x = p1.x - p0.x;
  const d1y = p1.y - p0.y;
  const d1z = p1.z - p0.z;
  const d2x = q1.x - q0.x;
  const d2y = q1.y - q0.y;
  const d2z = q1.z - q0.z;
  const rx = p0.x - q0.x;
  const ry = p0.y - q0.y;
  const rz = p0.z - q0.z;
  const a = d1x * d1x + d1y * d1y + d1z * d1z;
  const e = d2x * d2x + d2y * d2y + d2z * d2z;
  const f = d2x * rx + d2y * ry + d2z * rz;
  let s: number;
  let t: number;
  if (a <= 1e-12 && e <= 1e-12) {
    s = 0;
    t = 0;
  } else if (a <= 1e-12) {
    s = 0;
    t = Math.min(1, Math.max(0, f / e));
  } else {
    const c = d1x * rx + d1y * ry + d1z * rz;
    if (e <= 1e-12) {
      t = 0;
      s = Math.min(1, Math.max(0, -c / a));
    } else {
      const b = d1x * d2x + d1y * d2y + d1z * d2z;
      const denom = a * e - b * b;
      s = denom > 1e-12 ? Math.min(1, Math.max(0, (b * f - c * e) / denom)) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = Math.min(1, Math.max(0, -c / a));
      } else if (t > 1) {
        t = 1;
        s = Math.min(1, Math.max(0, (b - c) / a));
      }
    }
  }
  const dx = rx + d1x * s - d2x * t;
  const dy = ry + d1y * s - d2y * t;
  const dz = rz + d1z * s - d2z * t;
  out.s = s;
  out.distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
  return out;
}
