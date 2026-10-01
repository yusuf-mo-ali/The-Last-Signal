/**
 * Hitbox rigs (D-007, D-041): analytic spheres and capsules per damage zone, placed in the
 * simulation. Combat never raycasts render meshes. A rig is positioned by its owner (feet position
 * and yaw) and answers one question: where does a ray first enter it, and in which zone?
 *
 * Rays are moved into the rig's local space (one translation and one rotation about y), so the
 * shapes stay as plain config data and are never transformed. Nothing here allocates per ray.
 */

import { Vector3 } from 'three';
import type { HitboxRigDefinition, HitboxShape, Point3 } from '../config/combat';
import type { DamageZone } from '../config/enemies';

export interface RigHit {
  /** Distance along the ray, in metres. 0 when the ray starts inside a volume. */
  readonly distance: number;
  readonly zone: DamageZone;
  /** Index of the shape in the rig definition (debug views, tests). */
  readonly shape: number;
}

/**
 * Distance along a unit ray to where it enters a sphere, or −1 if it misses it within
 * `maxDistance`. A ray starting inside the sphere hits it at distance 0.
 */
export function raySphere(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  center: Point3,
  radius: number,
  maxDistance: number,
): number {
  const mx = ox - center[0];
  const my = oy - center[1];
  const mz = oz - center[2];
  const c = mx * mx + my * my + mz * mz - radius * radius;
  if (c <= 0) {
    return 0;
  }
  const b = mx * dx + my * dy + mz * dz;
  if (b > 0) {
    return -1; // outside and pointing away
  }
  const disc = b * b - c;
  if (disc < 0) {
    return -1;
  }
  const t = -b - Math.sqrt(disc);
  return t <= maxDistance ? t : -1;
}

/**
 * Distance along a unit ray to where it enters a capsule (segment a–b, radius r), or −1. The
 * capsule is the union of a finite cylinder and two end spheres; from outside, the ray's entry
 * into the union is the nearest entry into any of them. A ray starting inside hits at 0.
 */
export function rayCapsule(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  a: Point3,
  b: Point3,
  radius: number,
  maxDistance: number,
): number {
  const bax = b[0] - a[0];
  const bay = b[1] - a[1];
  const baz = b[2] - a[2];
  const oax = ox - a[0];
  const oay = oy - a[1];
  const oaz = oz - a[2];
  const baba = bax * bax + bay * bay + baz * baz;
  const baoa = bax * oax + bay * oay + baz * oaz;
  const r2 = radius * radius;

  // Inside: the closest point of the axis segment is within the radius.
  const s = baba > 0 ? Math.min(1, Math.max(0, baoa / baba)) : 0;
  const px = oax - bax * s;
  const py = oay - bay * s;
  const pz = oaz - baz * s;
  if (px * px + py * py + pz * pz <= r2) {
    return 0;
  }

  let best = Number.POSITIVE_INFINITY;
  // Cylinder body.
  const bard = bax * dx + bay * dy + baz * dz;
  const A = baba - bard * bard;
  if (A > 1e-12) {
    const rdoa = dx * oax + dy * oay + dz * oaz;
    const oaoa = oax * oax + oay * oay + oaz * oaz;
    const B = baba * rdoa - baoa * bard;
    const C = baba * oaoa - baoa * baoa - r2 * baba;
    const h = B * B - A * C;
    if (h >= 0) {
      const t = (-B - Math.sqrt(h)) / A;
      const y = baoa + t * bard;
      if (t >= 0 && y >= 0 && y <= baba) {
        best = t;
      }
    }
  }
  // End caps.
  const ta = raySphere(ox, oy, oz, dx, dy, dz, a, radius, maxDistance);
  if (ta >= 0 && ta < best) {
    best = ta;
  }
  const tb = raySphere(ox, oy, oz, dx, dy, dz, b, radius, maxDistance);
  if (tb >= 0 && tb < best) {
    best = tb;
  }
  return best <= maxDistance ? best : -1;
}

/** Bounding sphere of a rig in its local space (broad phase). */
export function rigBounds(definition: HitboxRigDefinition): {
  readonly center: Point3;
  readonly radius: number;
} {
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const shape of definition.shapes) {
    for (const [, y] of shapePoints(shape)) {
      minY = Math.min(minY, y - shape.radius);
      maxY = Math.max(maxY, y + shape.radius);
    }
  }
  const center: Point3 = [0, (minY + maxY) / 2, 0];
  let radius = 0;
  for (const shape of definition.shapes) {
    for (const [x, y, z] of shapePoints(shape)) {
      const d = Math.hypot(x - center[0], y - center[1], z - center[2]) + shape.radius;
      radius = Math.max(radius, d);
    }
  }
  return { center, radius };
}

function shapePoints(shape: HitboxShape): readonly Point3[] {
  return shape.kind === 'sphere' ? [shape.center] : [shape.a, shape.b];
}

/**
 * A rig placed in the world. The owner (a training dummy now, an enemy later) moves it by writing
 * `position` (feet) and `yaw`, and swaps poses with `setPose`.
 */
export class HitboxRig {
  readonly position = new Vector3();
  /** Facing, radians (yaw 0 faces −z, like the player). */
  yaw = 0;
  private definitionValue: HitboxRigDefinition;
  private bounds: { readonly center: Point3; readonly radius: number };

  constructor(definition: HitboxRigDefinition) {
    if (definition.shapes.length === 0) {
      throw new RangeError(`Hitbox rig "${definition.id}" has no shapes`);
    }
    this.definitionValue = definition;
    this.bounds = rigBounds(definition);
  }

  get definition(): HitboxRigDefinition {
    return this.definitionValue;
  }

  get boundingRadius(): number {
    return this.bounds.radius;
  }

  /** Switches to another pose (another set of shapes), e.g. crawling. */
  setPose(definition: HitboxRigDefinition): void {
    this.definitionValue = definition;
    this.bounds = rigBounds(definition);
  }

  /**
   * The first volume a unit ray enters within `maxDistance`, or null. On an exact tie the shape
   * listed first wins, so results never depend on floating-point order.
   */
  raycast(origin: Vector3, direction: Vector3, maxDistance: number): RigHit | null {
    // World → local: translate to the feet, rotate by −yaw about y.
    const cos = Math.cos(this.yaw);
    const sin = Math.sin(this.yaw);
    const wx = origin.x - this.position.x;
    const wz = origin.z - this.position.z;
    const ox = wx * cos - wz * sin;
    const oy = origin.y - this.position.y;
    const oz = wx * sin + wz * cos;
    const dx = direction.x * cos - direction.z * sin;
    const dy = direction.y;
    const dz = direction.x * sin + direction.z * cos;

    const b = this.bounds;
    if (raySphere(ox, oy, oz, dx, dy, dz, b.center, b.radius, maxDistance) < 0) {
      return null;
    }
    let bestDistance = maxDistance;
    let best = -1;
    const shapes = this.definitionValue.shapes;
    for (let i = 0; i < shapes.length; i++) {
      const shape = shapes[i];
      if (!shape) {
        continue;
      }
      const t =
        shape.kind === 'sphere'
          ? raySphere(ox, oy, oz, dx, dy, dz, shape.center, shape.radius, bestDistance)
          : rayCapsule(ox, oy, oz, dx, dy, dz, shape.a, shape.b, shape.radius, bestDistance);
      if (t >= 0 && (best < 0 || t < bestDistance)) {
        bestDistance = t;
        best = i;
      }
    }
    const shape = shapes[best];
    return shape ? { distance: bestDistance, zone: shape.zone, shape: best } : null;
  }

  /** A shape's point (local space) in world space (debug views, tests). Writes into `out`. */
  toWorld(local: Point3, out = new Vector3()): Vector3 {
    const cos = Math.cos(this.yaw);
    const sin = Math.sin(this.yaw);
    return out.set(
      this.position.x + local[0] * cos + local[2] * sin,
      this.position.y + local[1],
      this.position.z - local[0] * sin + local[2] * cos,
    );
  }
}
