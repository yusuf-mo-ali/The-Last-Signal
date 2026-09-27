/**
 * Combat configuration (plan §10, GAME_DESIGN §6, ARCHITECTURE §7.3, D-007, D-041): combat rules,
 * hitbox rigs and presentation timings for hit feedback. The zone multipliers themselves live
 * with the enemy data (`DEFAULT_ZONE_MULTIPLIERS` in `enemies.ts`), because archetypes override
 * them.
 *
 * Nothing here is zombie-specific: training dummies (Phase 3), zombies (Phase 4+) and bosses use
 * the same rigs, rules and events.
 */

import type { DamageZone } from './enemies';

export type Point3 = readonly [number, number, number];

/**
 * One analytic hit volume of a rig, in the rig's local space: metres, origin at the feet, +y up,
 * facing −z (the same convention as the player's yaw 0), so its own right side is +x.
 */
export type HitboxShape =
  | {
      readonly kind: 'sphere';
      readonly zone: DamageZone;
      readonly center: Point3;
      readonly radius: number;
    }
  | {
      readonly kind: 'capsule';
      readonly zone: DamageZone;
      /** The two end points of the capsule's axis. */
      readonly a: Point3;
      readonly b: Point3;
      readonly radius: number;
    };

/**
 * A set of hit volumes for one body pose (D-007): simulation data, independent of any render mesh.
 * AI states that change the silhouette (lunging, crawling) will be further definitions of the same
 * kind, swapped with `HitboxRig.setPose`.
 */
export interface HitboxRigDefinition {
  readonly id: string;
  readonly shapes: readonly HitboxShape[];
}

/**
 * An upright humanoid of about 1.8 m (the player's height). The head is slightly generous (D-007
 * mitigation: rigs and animation can drift apart). Limbs and torso do not overlap, so the zone a
 * ray reports is the surface it meets first.
 */
export const HUMANOID_RIG: HitboxRigDefinition = {
  id: 'humanoid',
  shapes: [
    { kind: 'sphere', zone: 'HEAD', center: [0, 1.63, 0], radius: 0.13 },
    { kind: 'capsule', zone: 'TORSO', a: [0, 0.98, 0], b: [0, 1.3, 0], radius: 0.2 },
    { kind: 'capsule', zone: 'ARM_LEFT', a: [-0.29, 1.42, 0], b: [-0.33, 0.86, 0], radius: 0.07 },
    { kind: 'capsule', zone: 'ARM_RIGHT', a: [0.29, 1.42, 0], b: [0.33, 0.86, 0], radius: 0.07 },
    { kind: 'capsule', zone: 'LEG_LEFT', a: [-0.11, 0.84, 0], b: [-0.11, 0.1, 0], radius: 0.095 },
    { kind: 'capsule', zone: 'LEG_RIGHT', a: [0.11, 0.84, 0], b: [0.11, 0.1, 0], radius: 0.095 },
  ],
};

/**
 * The humanoid with both arms reaching forward at shoulder height: the pose a melee enemy takes
 * while it winds up and strikes (D-007 pose presets; D-042). Same head, torso and legs as
 * `HUMANOID_RIG`, so only the arms move.
 */
export const HUMANOID_REACH_POSE: HitboxRigDefinition = {
  id: 'humanoid-reach',
  shapes: HUMANOID_RIG.shapes.map((shape) => {
    if (shape.kind !== 'capsule' || (shape.zone !== 'ARM_LEFT' && shape.zone !== 'ARM_RIGHT')) {
      return shape;
    }
    const side = shape.zone === 'ARM_LEFT' ? -1 : 1;
    return { ...shape, b: [side * 0.31, 1.36, -0.55] as const };
  }),
};

/** Per-part scale factors for `scaleRig` (1 = the humanoid's own proportions). */
export interface RigScale {
  /** Sideways (x) positions. */
  readonly width: number;
  /** Heights (y). */
  readonly height: number;
  /** Front-to-back (z) positions. */
  readonly depth: number;
  readonly head: number;
  readonly torso: number;
  readonly arm: number;
  readonly leg: number;
  /** Extra sideways spread of the arms, so thicker arms stay clear of a wider torso. */
  readonly shoulders: number;
}

/**
 * A differently built humanoid from an existing rig (Phase 5 archetypes, D-043): positions scale
 * per axis, radii per body part. Zones stay the same, so damage rules apply unchanged.
 */
export function scaleRig(rig: HitboxRigDefinition, id: string, s: RigScale): HitboxRigDefinition {
  const radiusFactor = (zone: DamageZone): number =>
    zone === 'HEAD'
      ? s.head
      : zone === 'TORSO'
        ? s.torso
        : zone === 'ARM_LEFT' || zone === 'ARM_RIGHT'
          ? s.arm
          : s.leg;
  const point = (p: Point3, zone: DamageZone): Point3 => {
    const spread = zone === 'ARM_LEFT' || zone === 'ARM_RIGHT' ? s.shoulders : 1;
    return [p[0] * s.width * spread, p[1] * s.height, p[2] * s.depth];
  };
  return {
    id,
    shapes: rig.shapes.map((shape): HitboxShape => {
      const radius = shape.radius * radiusFactor(shape.zone);
      return shape.kind === 'sphere'
        ? { ...shape, center: point(shape.center, shape.zone), radius }
        : { ...shape, a: point(shape.a, shape.zone), b: point(shape.b, shape.zone), radius };
    }),
  };
}

/**
 * The same rig with both arms swung up and forward over the head, `angleDeg` from hanging (135°:
 * a Screamer's scream, D-043). The arms turn about the shoulders exactly as the drawn arms do, so
 * they stay hittable where they are drawn.
 */
export function armsRaisedPose(
  rig: HitboxRigDefinition,
  id: string,
  angleDeg = 135,
): HitboxRigDefinition {
  const angle = (angleDeg * Math.PI) / 180;
  return {
    id,
    shapes: rig.shapes.map((shape) => {
      if (shape.kind !== 'capsule' || (shape.zone !== 'ARM_LEFT' && shape.zone !== 'ARM_RIGHT')) {
        return shape;
      }
      const length = Math.hypot(
        shape.b[0] - shape.a[0],
        shape.b[1] - shape.a[1],
        shape.b[2] - shape.a[2],
      );
      // A hanging arm (0, −L, 0) turned about the shoulder's x axis.
      const b: Point3 = [
        shape.b[0],
        shape.a[1] - length * Math.cos(angle),
        shape.a[2] - length * Math.sin(angle),
      ];
      return { ...shape, b };
    }),
  };
}

/**
 * The same rig leaning forward from the hips by `angle` radians (negative leans back): head, torso
 * and arms turn about the top of the legs, the legs stay put (a Runner's sprinter's crouch, a
 * Tank's hunch; D-043). It is part of the rig, not just the drawing, so the drawn body (built from
 * the rig) and the hit volumes stay together.
 */
export function leanRig(rig: HitboxRigDefinition, id: string, angle: number): HitboxRigDefinition {
  let hip = 0;
  for (const shape of rig.shapes) {
    if (shape.zone === 'LEG_LEFT' || shape.zone === 'LEG_RIGHT') {
      hip = Math.max(
        hip,
        ...(shape.kind === 'capsule' ? [shape.a[1], shape.b[1]] : [shape.center[1]]),
      );
    }
  }
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  // Forward is −z: a point above the hips moves toward −z as it leans.
  const turn = (p: Point3): Point3 => {
    const y = p[1] - hip;
    return [p[0], hip + y * cos + p[2] * sin, p[2] * cos - y * sin];
  };
  return {
    id,
    shapes: rig.shapes.map((shape): HitboxShape => {
      if (shape.zone === 'LEG_LEFT' || shape.zone === 'LEG_RIGHT') {
        return shape;
      }
      return shape.kind === 'sphere'
        ? { ...shape, center: turn(shape.center) }
        : { ...shape, a: turn(shape.a), b: turn(shape.b) };
    }),
  };
}

export interface CombatRules {
  /**
   * The least damage a hit can do once armor has reduced it (GAME_DESIGN §6: flat armor with a
   * floor). Only applies when armor reduced the hit.
   */
  readonly minimumDamage: number;
  /**
   * Hit reactions: damage dealt to a target within this many seconds of its previous hit adds up
   * towards its stagger threshold (GAME_DESIGN §6).
   */
  readonly staggerWindow: number;
}

export const COMBAT_RULES: CombatRules = {
  minimumDamage: 1,
  staggerWindow: 1,
};

/** Presentation timings for hit feedback (GAME_DESIGN §6). Never read by the simulation. */
export const COMBAT_FEEDBACK = {
  /** Seconds a hit marker stays on the crosshair (body hit, headshot, kill). */
  hitMarkerTime: 0.18,
  headshotMarkerTime: 0.25,
  killMarkerTime: 0.4,
  /** Optional damage numbers (a settings toggle later; on by default). */
  damageNumbers: true,
  damageNumberTime: 0.8,
  /** Pooled damage-number elements; the oldest is reused when all are showing. */
  maxDamageNumbers: 24,
} as const;
