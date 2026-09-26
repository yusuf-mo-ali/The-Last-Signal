/**
 * Hitscan: instant rays against the level and, later, against enemy hitboxes (ARCHITECTURE §7.3,
 * D-007, D-040). Browser-independent.
 *
 * Phase 2 hits only the level. Enemies (Phase 4) register as `HitscanTarget`s: the nearest of the
 * level and every target wins, so walls block shots without the combat code knowing about walls.
 */

import { Vector3 } from 'three';
import type { CollisionWorld } from '../physics/CollisionWorld';
import type { Rng } from '../utils/Rng';
import type { Vec3Tuple } from './types';

export interface WorldHit {
  readonly kind: 'world';
  readonly distance: number;
  readonly point: Vec3Tuple;
  /** Unit normal of the surface that was hit. */
  readonly normal: Vec3Tuple;
}

export interface TargetHit {
  readonly kind: 'target';
  readonly distance: number;
  readonly point: Vec3Tuple;
  /** Which target (e.g. an enemy id) and which of its damage zones. */
  readonly targetId: string;
  readonly zone: string;
}

export type HitResult = WorldHit | TargetHit;

/** Anything a shot can hit besides the level (enemy hitbox rigs from Phase 4). */
export interface HitscanTarget {
  raycast(origin: Vector3, direction: Vector3, maxDistance: number): TargetHit | null;
}

export class Hitscan {
  private readonly world: CollisionWorld;
  private targets: readonly HitscanTarget[] = [];

  constructor(world: CollisionWorld) {
    this.world = world;
  }

  /** Registers something shootable; returns a function that removes it. */
  addTarget(target: HitscanTarget): () => void {
    this.targets = [...this.targets, target];
    return () => {
      this.targets = this.targets.filter((t) => t !== target);
    };
  }

  /** The nearest hit along a ray within `maxDistance`, or null. `direction` must be unit length. */
  cast(origin: Vector3, direction: Vector3, maxDistance: number): HitResult | null {
    let best: HitResult | null = null;
    const wall = this.world.raycast(origin, direction, maxDistance);
    if (wall) {
      best = {
        kind: 'world',
        distance: wall.distance,
        point: [wall.point.x, wall.point.y, wall.point.z],
        normal: [wall.normal.x, wall.normal.y, wall.normal.z],
      };
    }
    for (const target of this.targets) {
      const hit = target.raycast(origin, direction, best ? best.distance : maxDistance);
      if (hit && (!best || hit.distance < best.distance)) {
        best = hit;
      }
    }
    return best;
  }
}

const _right = new Vector3();
const _up = new Vector3();
const _worldUp = new Vector3(0, 1, 0);

/**
 * A direction inside a cone of half-angle `coneRadians` around `aim`, uniformly distributed over
 * the cone's cross-section, drawn from `rng` (reproducible). Writes into and returns `out`.
 */
export function spreadDirection(
  aim: Vector3,
  coneRadians: number,
  rng: Rng,
  out = new Vector3(),
): Vector3 {
  if (coneRadians <= 0) {
    return out.copy(aim);
  }
  // A basis perpendicular to the aim (fall back to x when aiming straight up or down).
  _right.crossVectors(aim, _worldUp);
  if (_right.lengthSq() < 1e-8) {
    _right.set(1, 0, 0);
  }
  _right.normalize();
  _up.crossVectors(_right, aim).normalize();
  const radius = Math.tan(coneRadians) * Math.sqrt(rng.next()); // sqrt: uniform over the disc
  const angle = rng.next() * Math.PI * 2;
  return out
    .copy(aim)
    .addScaledVector(_right, Math.cos(angle) * radius)
    .addScaledVector(_up, Math.sin(angle) * radius)
    .normalize();
}

/** Unit aim direction for a view yaw and pitch (radians; yaw 0 faces −z, pitch up is +). */
export function aimDirection(yaw: number, pitch: number, out = new Vector3()): Vector3 {
  const cos = Math.cos(pitch);
  return out.set(-Math.sin(yaw) * cos, Math.sin(pitch), -Math.cos(yaw) * cos);
}

export function toTuple(v: Vector3): Vec3Tuple {
  return [v.x, v.y, v.z];
}
