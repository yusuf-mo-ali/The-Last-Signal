/**
 * What enemies can target and hit (D-042). Generic: the player is one target today (through
 * `player/PlayerTarget.ts`); decoys, allies or objectives could be others. The enemy framework
 * never imports the player.
 */

import type { Vector3 } from 'three';
import type { Vec3Tuple } from '../weapons/types';

/** A melee hit from an enemy. */
export interface EnemyHit {
  readonly amount: number;
  readonly attackerId: string;
  readonly archetype: string;
  /** Unit direction from the attacker to the target (for knock-back and damage indicators). */
  readonly direction: Vec3Tuple;
}

export interface EnemyTarget {
  readonly id: string;
  /** Feet position, read live every step. */
  readonly position: Vector3;
  /** Eye height above the feet: line of sight aims here. */
  readonly eyeHeight: number;
  /** Body radius (metres). */
  readonly radius: number;
  isAlive(): boolean;
  /** Applies an enemy's hit. Returns the health it removed (0 when ignored). */
  receiveHit(hit: EnemyHit): number;
}
