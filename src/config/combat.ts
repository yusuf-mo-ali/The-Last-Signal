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
