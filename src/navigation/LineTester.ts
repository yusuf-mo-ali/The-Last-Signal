/**
 * Straight-line queries against the level (D-042), shared by every enemy:
 * - `lineOfSight`: can one point see another (a single ray)?
 * - `walkable`: can a body of a given radius walk straight from one spot to another? The ends
 *   must be on about the same level (`maxRise`), and three rays at knee height (the centre line
 *   and both sides of the body) and one at chest height must be clear, so low crates, walls,
 *   doorway jambs and ducts too low to stand in all count as blocked.
 * - `hasGround`: is there ground within a step of a point (spawn validation)?
 *
 * Uses the same octree as the player's collision and the bullets (ARCHITECTURE §7.6). Allocates
 * nothing per query. `rays` counts the rays cast (performance tests).
 */

import { Vector3 } from 'three';
import { ENEMY_RULES, type EnemyRules } from '../config/enemies';
import type { CollisionWorld } from '../physics/CollisionWorld';

const _from = new Vector3();
const _dir = new Vector3();
const _side = new Vector3();
const _origin = new Vector3();
const DOWN = new Vector3(0, -1, 0);

export class LineTester {
  /** Rays cast so far (performance tests). */
  rays = 0;
  private readonly world: CollisionWorld;
  private readonly rules: Pick<EnemyRules, 'maxRise' | 'kneeHeight' | 'chestHeight'>;

  constructor(
    world: CollisionWorld,
    rules: Pick<EnemyRules, 'maxRise' | 'kneeHeight' | 'chestHeight'> = ENEMY_RULES,
  ) {
    this.world = world;
    this.rules = rules;
  }

  /** True if nothing in the level blocks the straight line from `from` to `to`. */
  lineOfSight(from: Vector3, to: Vector3): boolean {
    const length = _dir.subVectors(to, from).length();
    if (length < 1e-6) {
      return true;
    }
    _dir.divideScalar(length);
    return this.clear(from, _dir, length);
  }

  /**
   * True if a body of `radius` standing at `from` (feet) can walk straight to `to` (feet): about
   * the same level, and nothing in the way at knee or chest height.
   */
  walkable(from: Vector3, to: Vector3, radius: number): boolean {
    const { maxRise, kneeHeight, chestHeight } = this.rules;
    if (Math.abs(to.y - from.y) > maxRise) {
      return false;
    }
    const length = _dir.subVectors(to, from).length();
    if (length < 1e-6) {
      return true;
    }
    _dir.divideScalar(length);
    // Horizontal perpendicular (the body's sides).
    _side.set(-_dir.z, 0, _dir.x);
    const sideLength = _side.length();
    if (sideLength > 1e-6) {
      _side.multiplyScalar(radius / sideLength);
    }
    _from.copy(from);
    _from.y += kneeHeight;
    if (!this.clear(_from, _dir, length)) {
      return false;
    }
    if (!this.clear(_origin.copy(_from).add(_side), _dir, length)) {
      return false;
    }
    if (!this.clear(_origin.copy(_from).sub(_side), _dir, length)) {
      return false;
    }
    _from.y += chestHeight - kneeHeight;
    return this.clear(_from, _dir, length);
  }

  /** True if there is ground within `maxRise` above or below `feet` (one ray, straight down). */
  hasGround(feet: Vector3): boolean {
    const { maxRise } = this.rules;
    _origin.copy(feet);
    _origin.y += maxRise;
    return !this.clear(_origin, DOWN, maxRise * 2);
  }

  private clear(origin: Vector3, direction: Vector3, length: number): boolean {
    this.rays++;
    return this.world.raycast(origin, direction, length) === null;
  }
}
