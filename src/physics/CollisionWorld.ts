/**
 * Static level collision (ARCHITECTURE §7.6, D-006): an `Octree` of the level's triangles, queried
 * with capsules and rays. Browser-independent: three.js math classes only.
 *
 * The capsule query reports every touching triangle separately (`capsuleContacts`), not the single
 * combined push that `Octree.capsuleIntersect` returns. The player needs the individual normals to
 * tell floor from wall from ceiling when it touches several at once, e.g. walking into a wall.
 */

import { Ray, type Triangle, Vector3 } from 'three';
import type { Capsule } from 'three/addons/math/Capsule.js';
import { Octree } from 'three/addons/math/Octree.js';

export interface CapsuleContact {
  /** Unit vector pointing out of the surface, toward the capsule. */
  readonly normal: Vector3;
  /** How far the capsule overlaps the surface along `normal`. */
  readonly depth: number;
}

export interface RayHit {
  readonly distance: number;
  readonly point: Vector3;
  readonly normal: Vector3;
}

export class CollisionWorld {
  readonly triangleCount: number;
  private readonly octree = new Octree();
  private readonly candidates: Triangle[] = [];
  private readonly ray = new Ray();

  constructor(triangles: Iterable<Triangle>) {
    let count = 0;
    for (const triangle of triangles) {
      this.octree.addTriangle(triangle);
      count++;
    }
    this.triangleCount = count;
    this.octree.build();
  }

  /**
   * The level surfaces overlapping `capsule`, each with its own push-out normal and depth,
   * deepest first. Surfaces the capsule is entirely behind are ignored (faces are one-sided).
   */
  capsuleContacts(capsule: Capsule): CapsuleContact[] {
    const candidates = this.candidates;
    candidates.length = 0;
    this.octree.getCapsuleTriangles(capsule, candidates);
    const contacts: CapsuleContact[] = [];
    for (const triangle of candidates) {
      const hit = this.octree.triangleCapsuleIntersect(capsule, triangle);
      if (hit && hit.depth > 1e-7) {
        contacts.push({ normal: hit.normal, depth: hit.depth });
      }
    }
    candidates.length = 0;
    return contacts.sort((a, b) => b.depth - a.depth);
  }

  /** The nearest surface along a ray within `maxDistance`, or null. */
  raycast(origin: Vector3, direction: Vector3, maxDistance: number): RayHit | null {
    this.ray.set(origin, direction);
    const hit = this.octree.rayIntersect(this.ray);
    if (!hit || hit.distance > maxDistance) {
      return null;
    }
    return {
      distance: hit.distance,
      point: hit.position.clone(),
      normal: hit.triangle.getNormal(new Vector3()),
    };
  }
}
