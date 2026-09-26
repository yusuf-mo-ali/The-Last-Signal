/**
 * Level-as-data types (D-013, ARCHITECTURE §7.7). One definition generates collision and render
 * geometry, so the two can never disagree. Plain data: no three.js objects, no browser APIs.
 *
 * Axes: x east, y up, z south (yaw 0 faces north, −z). Units: metres.
 */

export type Vec3 = readonly [number, number, number];

/** Visual/material class of a brush; gameplay code never depends on it. */
export type SurfaceKind = 'ground' | 'wall' | 'structure' | 'crate' | 'metal' | 'accent';

/** The side a ramp or staircase rises toward (its high edge). */
export type RiseDirection = '+x' | '-x' | '+z' | '-z';

export interface BoxBrush {
  readonly kind: 'box';
  readonly min: Vec3;
  readonly max: Vec3;
  readonly surface: SurfaceKind;
}

/** A solid wedge: height `min.y` at the low edge, `max.y` along the high edge. */
export interface RampBrush {
  readonly kind: 'ramp';
  readonly min: Vec3;
  readonly max: Vec3;
  readonly rise: RiseDirection;
  readonly surface: SurfaceKind;
}

/** Rendered as `steps` boxes; collides as the enclosing ramp (smooth for the capsule). */
export interface StairsBrush {
  readonly kind: 'stairs';
  readonly min: Vec3;
  readonly max: Vec3;
  readonly rise: RiseDirection;
  readonly steps: number;
  readonly surface: SurfaceKind;
}

export type Brush = BoxBrush | RampBrush | StairsBrush;

/** A point enemies can route through (D-042), on walkable ground, at feet height. */
export interface NavNode {
  readonly id: string;
  readonly position: Vec3;
}

/** Two nodes an enemy body can walk between in a straight line (both ways unless `oneWay`). */
export interface NavLink {
  readonly from: string;
  readonly to: string;
  readonly oneWay?: boolean;
}

/**
 * Authored route data (D-013 "routes", D-042): enemies walk straight at their target when they
 * can, and along this graph when walls, levels or obstacles are in the way.
 */
export interface NavGraphDefinition {
  readonly nodes: readonly NavNode[];
  readonly links: readonly NavLink[];
}

export interface LevelDefinition {
  readonly name: string;
  /** Where the player starts, standing on the ground, and the direction they face. */
  readonly spawn: { readonly position: Vec3; readonly yaw: number };
  /** Anything below this is outside the level: the player is returned to the spawn. */
  readonly killPlaneY: number;
  readonly brushes: readonly Brush[];
  /** Route graph for enemies; without one they can only walk straight at their target. */
  readonly navigation?: NavGraphDefinition;
}
