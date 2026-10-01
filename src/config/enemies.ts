/**
 * Enemy configuration (plan §10–12, GAME_DESIGN §6–7, D-012: archetype + modifiers, D-042,
 * D-043). Holds the identity data, the plan's damage-zone multipliers, the full definition of each
 * implemented archetype (the Walker since Phase 4; the Runner, Tank and Screamer since Phase 5)
 * and the rules shared by every enemy. Traits (Armored, Helmeted, Elite) are in `traits.ts`.
 */

import {
  armsRaisedPose,
  HUMANOID_REACH_POSE,
  leanRig,
  HUMANOID_RIG,
  scaleRig,
  type HitboxRigDefinition,
  type RigScale,
} from './combat';
import type { DropTableId } from './drops';
import type { FrenzyParams } from './effects';

/** Plan §10 body-part damage zones. */
export const DAMAGE_ZONES = [
  'HEAD',
  'TORSO',
  'ARM_LEFT',
  'ARM_RIGHT',
  'LEG_LEFT',
  'LEG_RIGHT',
] as const;
export type DamageZone = (typeof DAMAGE_ZONES)[number];

/** Plan §10 example multipliers ("numbers must remain configurable"); archetypes may override. */
export const DEFAULT_ZONE_MULTIPLIERS: Readonly<Record<DamageZone, number>> = {
  HEAD: 2.5,
  TORSO: 1.0,
  ARM_LEFT: 0.65,
  ARM_RIGHT: 0.65,
  LEG_LEFT: 0.5,
  LEG_RIGHT: 0.5,
};

/** Plan §11 AI states. */
export const AI_STATES = [
  'IDLE',
  'PATROL',
  'DETECT',
  'CHASE',
  'ATTACK',
  'STAGGER',
  'DEAD',
] as const;
export type AiState = (typeof AI_STATES)[number];

export const ENEMY_ARCHETYPE_IDS = ['walker', 'runner', 'tank', 'screamer', 'climber'] as const;
export type EnemyArchetypeId = (typeof ENEMY_ARCHETYPE_IDS)[number];

export const ENEMY_MODIFIER_IDS = ['armored', 'helmeted', 'elite'] as const;
export type EnemyModifierId = (typeof ENEMY_MODIFIER_IDS)[number];

/**
 * Generic behaviours an archetype can use (enemies/ai, D-043): the melee chaser (Walker, Runner,
 * Tank) and the support caster that keeps its distance and uses an ability (Screamer).
 */
export const ENEMY_BEHAVIOR_IDS = ['melee', 'screamer'] as const;
export type EnemyBehaviorId = (typeof ENEMY_BEHAVIOR_IDS)[number];

/**
 * Everything the generic enemy framework needs to run an archetype (plan §11, D-012, D-042).
 * The first six fields are the plan's base enemy; the rest are the Phase 4 additions that make it
 * a playable body, perception and attack. No AI code reads an archetype id: changing
 * `ENEMY_STATS.walker.moveSpeed` changes the Walker and nothing else (plan §31).
 */
export interface EnemyArchetypeConfig {
  readonly id: EnemyArchetypeId;
  readonly name: string;
  /** The generic behaviour that drives it. */
  readonly behavior: EnemyBehaviorId;

  // ---- plan §11 base enemy ------------------------------------------------------------------
  readonly health: number;
  /** Top walking speed, m/s. */
  readonly moveSpeed: number;
  /** Damage of one melee hit. */
  readonly attackDamage: number;
  /** Metres (horizontal, centre to centre): starts an attack when the target is this close. */
  readonly attackRange: number;
  /** Metres: notices a target this close that it can see. */
  readonly detectionRange: number;
  /** Seconds from the start of one attack to the earliest start of the next. */
  readonly attackCooldown: number;

  // ---- body -----------------------------------------------------------------------------------
  /** Collision capsule (the same kinematic body as the player, D-042). Metres. */
  readonly body: { readonly radius: number; readonly height: number; readonly eyeHeight: number };
  /** Hit volumes (D-007) and the pose its arms take while attacking (D-041 §2 `setPose`). */
  readonly rig: HitboxRigDefinition;
  readonly attackPose: HitboxRigDefinition | null;
  /** Radians per second it can turn. */
  readonly turnSpeed: number;
  /** m/s²: how quickly it reaches its walking speed or stops. */
  readonly acceleration: number;

  // ---- combat ---------------------------------------------------------------------------------
  /** Overrides of the plan's zone multipliers (none: takes damage like the plan's table). */
  readonly zoneMultipliers?: Partial<Record<DamageZone, number>>;
  readonly armor: number;
  readonly resistance: number;
  /** Damage within the stagger window that staggers it; `Infinity` = stagger-immune. */
  readonly staggerThreshold: number;
  /** Seconds a stagger stops it. */
  readonly staggerDuration: number;
  /**
   * Only damage to these zones counts towards a stagger (a Tank staggers from headshots only).
   * Omitted: every zone counts.
   */
  readonly staggerZones?: readonly DamageZone[];

  // ---- perception -----------------------------------------------------------------------------
  readonly perception: {
    /** Metres: a target further than this is forgotten. */
    readonly loseTargetRange: number;
    /** Seconds it keeps chasing a target it can no longer see. */
    readonly targetMemory: number;
    /** Seconds of the readable "noticed you" tell (DETECT) before it chases. */
    readonly reactionTime: number;
  };

  // ---- melee attack (GAME_DESIGN §7: every attack has a wind-up tell) -------------------------
  readonly attack: {
    /** Seconds of telegraphed wind-up; the attack is committed (no moving, no turning). */
    readonly windup: number;
    /** Seconds after the strike before it can move again. */
    readonly recovery: number;
    /** Metres: the strike lands if the target is still this close. */
    readonly reach: number;
    /** Degrees: the strike lands only inside this arc in front of it. */
    readonly arcDeg: number;
    /** Metres: the most the target's feet may be above or below its own. */
    readonly verticalReach: number;
    /**
     * A committed leap between the wind-up and the strike (Runner): it covers `distance` along
     * its locked facing at `speed` m/s, then strikes from where it lands. Omitted: no leap.
     */
    readonly lunge?: { readonly distance: number; readonly speed: number };
  };

  // ---- behaviour options (read by the brains; all optional) -----------------------------------
  /**
   * Approach in a zig-zag (Runner): while chasing in the open between `minDistance` and
   * `maxDistance`, it heads `angleDeg` off the straight line, switching side every `period` s.
   */
  readonly weave?: {
    readonly angleDeg: number;
    readonly period: number;
    readonly minDistance: number;
    readonly maxDistance: number;
  };
  /** Keeps its distance (Screamer): backs away inside `min`, closes in beyond `max`. Metres. */
  readonly preferredRange?: { readonly min: number; readonly max: number };
  /**
   * What its attack does when it is not a melee hit. `scream`: at the end of the wind-up it raises
   * an alarm (a generic `alarm` event) heard within `radius`; the wind-up, cooldown and trigger
   * range are the attack's. Nearby enemies are told where the target is for `alertDuration` s and
   * move `haste.multiplier` × faster for `haste.duration` s.
   */
  readonly ability?: {
    readonly kind: 'scream';
    readonly radius: number;
    readonly alertDuration: number;
    readonly haste: { readonly multiplier: number; readonly duration: number };
    /** A combat frenzy for those who hear it (D-046; clamped by `EFFECT_CLAMPS.frenzy`). */
    readonly frenzy?: FrenzyParams;
  };

  // ---- idle behaviour -------------------------------------------------------------------------
  readonly patrol: {
    /** Metres around its spawn point it wanders; 0 = stands still. */
    readonly radius: number;
    /** Seconds it waits between patrol walks (random in this range, seeded). */
    readonly pauseMin: number;
    readonly pauseMax: number;
    /** Fraction of `moveSpeed` while patrolling. */
    readonly speedFactor: number;
  };

  // ---- death and waves ------------------------------------------------------------------------
  /** Seconds a body stays before it is removed. */
  readonly corpseTime: number;
  /** Cost against the wave's threat budget (Phase 6). */
  readonly threatCost: number;
  readonly drops: DropTableId | null;
}

/**
 * Archetypes with a full definition (D-043). The Climber is deferred: it will arrive as adaptive
 * content (a counter to camping on high ground), not in the default roster.
 */
export const IMPLEMENTED_ENEMY_IDS = ['walker', 'runner', 'tank', 'screamer'] as const;
export type ImplementedEnemyId = (typeof IMPLEMENTED_ENEMY_IDS)[number];

/** O-3, resolved by D-043: the archetypes normal waves are made of. */
export const DEFAULT_ROSTER: readonly ImplementedEnemyId[] = [
  'walker',
  'runner',
  'tank',
  'screamer',
];

const RUNNER_SCALE: RigScale = {
  width: 0.9,
  height: 0.94,
  depth: 0.9,
  head: 0.95,
  torso: 0.8,
  arm: 0.8,
  leg: 0.85,
  shoulders: 1,
};
const TANK_SCALE: RigScale = {
  width: 1.5,
  height: 1.25,
  depth: 1.35,
  head: 1.2,
  torso: 1.75,
  arm: 1.7,
  leg: 1.6,
  shoulders: 1.2,
};
const SCREAMER_SCALE: RigScale = {
  width: 0.85,
  height: 1.08,
  depth: 0.85,
  head: 1.35,
  torso: 0.8,
  arm: 0.8,
  leg: 0.8,
  shoulders: 1,
};
const SCREAMER_RIG = scaleRig(HUMANOID_RIG, 'screamer', SCREAMER_SCALE);
/** Radians the Runner leans forward from the hips (a sprinter's crouch), and the Tank hunches. */
const RUNNER_LEAN = 0.28;
const TANK_HUNCH = 0.14;

export const ENEMY_STATS: Readonly<Record<ImplementedEnemyId, EnemyArchetypeConfig>> = {
  // Pass-1 values; reasoning in BALANCING.md §2.6.
  walker: {
    id: 'walker',
    name: 'Walker',
    behavior: 'melee',
    health: 120,
    moveSpeed: 1.6,
    attackDamage: 15,
    attackRange: 1.5,
    detectionRange: 12,
    attackCooldown: 1.6,
    body: { radius: 0.35, height: 1.8, eyeHeight: 1.6 },
    rig: HUMANOID_RIG,
    attackPose: HUMANOID_REACH_POSE,
    turnSpeed: 3.5,
    acceleration: 6,
    armor: 0,
    resistance: 0,
    staggerThreshold: 35,
    staggerDuration: 0.7,
    perception: { loseTargetRange: 24, targetMemory: 5, reactionTime: 0.6 },
    attack: { windup: 0.7, recovery: 0.5, reach: 1.9, arcDeg: 120, verticalReach: 1.2 },
    patrol: { radius: 4, pauseMin: 2, pauseMax: 4, speedFactor: 0.45 },
    corpseTime: 5,
    threatCost: 1,
    drops: 'walker',
  },
  // Pass-1 values; reasoning in BALANCING.md §2.7–2.9.
  runner: {
    id: 'runner',
    name: 'Runner',
    behavior: 'melee',
    health: 60,
    moveSpeed: 5.2,
    attackDamage: 10,
    // It starts its leap from here; the leap closes the gap.
    attackRange: 3.2,
    detectionRange: 15,
    attackCooldown: 1.8,
    body: { radius: 0.3, height: 1.7, eyeHeight: 1.5 },
    rig: leanRig(scaleRig(HUMANOID_RIG, 'runner', RUNNER_SCALE), 'runner', RUNNER_LEAN),
    attackPose: leanRig(
      scaleRig(HUMANOID_REACH_POSE, 'runner-reach', RUNNER_SCALE),
      'runner-reach',
      RUNNER_LEAN,
    ),
    turnSpeed: 6,
    acceleration: 14,
    armor: 0,
    resistance: 0,
    staggerThreshold: 20,
    staggerDuration: 0.45,
    perception: { loseTargetRange: 28, targetMemory: 6, reactionTime: 0.3 },
    attack: {
      windup: 0.4,
      recovery: 0.8,
      reach: 1.4,
      arcDeg: 90,
      verticalReach: 1.2,
      lunge: { distance: 2.2, speed: 9 },
    },
    weave: { angleDeg: 35, period: 1.2, minDistance: 4, maxDistance: 12 },
    patrol: { radius: 5, pauseMin: 1.5, pauseMax: 3, speedFactor: 0.35 },
    corpseTime: 5,
    threatCost: 1.5,
    drops: 'runner',
  },
  tank: {
    id: 'tank',
    name: 'Tank',
    behavior: 'melee',
    health: 360,
    moveSpeed: 1.1,
    attackDamage: 35,
    attackRange: 1.9,
    detectionRange: 10,
    attackCooldown: 2.6,
    body: { radius: 0.5, height: 2.25, eyeHeight: 2.0 },
    rig: leanRig(scaleRig(HUMANOID_RIG, 'tank', TANK_SCALE), 'tank', TANK_HUNCH),
    attackPose: leanRig(
      scaleRig(HUMANOID_REACH_POSE, 'tank-reach', TANK_SCALE),
      'tank-reach',
      TANK_HUNCH,
    ),
    turnSpeed: 1.8,
    acceleration: 3,
    // Body shots barely hurt it; its head is the weak point (plan §12, GAME_DESIGN §7).
    zoneMultipliers: {
      TORSO: 0.5,
      ARM_LEFT: 0.35,
      ARM_RIGHT: 0.35,
      LEG_LEFT: 0.35,
      LEG_RIGHT: 0.35,
    },
    armor: 0,
    resistance: 0,
    staggerThreshold: 60,
    staggerZones: ['HEAD'],
    staggerDuration: 0.6,
    perception: { loseTargetRange: 20, targetMemory: 8, reactionTime: 0.8 },
    attack: { windup: 1.1, recovery: 0.9, reach: 2.4, arcDeg: 150, verticalReach: 1.4 },
    patrol: { radius: 2, pauseMin: 3, pauseMax: 6, speedFactor: 0.5 },
    corpseTime: 6,
    threatCost: 4,
    drops: 'tank',
  },
  screamer: {
    id: 'screamer',
    name: 'Screamer',
    behavior: 'screamer',
    health: 80,
    moveSpeed: 2.6,
    // No melee: its "attack" is the scream, triggered within `attackRange` once the cooldown allows.
    attackDamage: 0,
    attackRange: 14,
    detectionRange: 16,
    attackCooldown: 10,
    body: { radius: 0.3, height: 1.95, eyeHeight: 1.8 },
    rig: SCREAMER_RIG,
    attackPose: armsRaisedPose(SCREAMER_RIG, 'screamer-scream'),
    turnSpeed: 4,
    acceleration: 8,
    armor: 0,
    resistance: 0,
    // Any body shot interrupts a scream.
    staggerThreshold: 25,
    staggerDuration: 0.8,
    perception: { loseTargetRange: 26, targetMemory: 6, reactionTime: 0.4 },
    attack: { windup: 1.2, recovery: 1.0, reach: 14, arcDeg: 360, verticalReach: 4 },
    preferredRange: { min: 6, max: 11 },
    ability: {
      kind: 'scream',
      radius: 18,
      alertDuration: 8,
      haste: { multiplier: 1.35, duration: 6 },
      // A completed scream whips the horde into a frenzy (D-046): kill the Screamer first.
      frenzy: {
        duration: 6,
        cooldownScale: 0.6,
        windupScale: 0.85,
        turnScale: 1.6,
        staggerScale: 1.4,
      },
    },
    patrol: { radius: 3, pauseMin: 2, pauseMax: 5, speedFactor: 0.4 },
    corpseTime: 5,
    threatCost: 2,
    drops: 'screamer',
  },
};

/** The full definition of an implemented archetype (throws for one that has none yet). */
export function enemyConfig(id: EnemyArchetypeId): EnemyArchetypeConfig {
  const config = (ENEMY_STATS as Readonly<Partial<Record<EnemyArchetypeId, EnemyArchetypeConfig>>>)[
    id
  ];
  if (!config) {
    throw new Error(
      `Enemy "${id}" has no definition yet (implemented: ${IMPLEMENTED_ENEMY_IDS.join(', ')})`,
    );
  }
  return config;
}

/**
 * Rules shared by every enemy (ARCHITECTURE §7.4, D-042). Engine-like tuning of the AI rather
 * than balance, but kept in config so it can be measured and changed without touching AI code.
 */
export interface EnemyRules {
  /**
   * Seconds between two decisions (`think`: perception, targeting, route planning) of one enemy.
   * Enemies are spread evenly over the steps of an interval. Movement, attack timing and stagger
   * run every fixed step regardless.
   */
  readonly thinkInterval: number;
  /** Hard cap on living enemies (waves set their own, lower, cap). */
  readonly maxAlive: number;
  /** Enemies closer than this (centre to centre, metres) push apart. */
  readonly separationDistance: number;
  /** m/s of push at full overlap. */
  readonly separationStrength: number;
  /**
   * Two bodies closing on each other push apart earlier and harder: the room grows by their
   * closing speed × `separationAnticipation` (seconds), and the push at full overlap by the
   * closing speed × `separationSpeedFactor`. So a fast enemy (a sprinting Runner) steers round
   * the others instead of running through them; a slow crowd is barely affected.
   */
  readonly separationSpeedFactor: number;
  readonly separationAnticipation: number;
  /** Metres: a route node counts as reached this close. */
  readonly arrivalRadius: number;
  /** Seconds between route re-plans while chasing along the route graph. */
  readonly replanInterval: number;
  /** Seconds without `stuckDistance` of progress before it gives up on walking straight. */
  readonly stuckTime: number;
  readonly stuckDistance: number;
  /** Walkable straight line (D-042): the most the ends may differ in height, metres. */
  readonly maxRise: number;
  /** Heights of the rays that test a walkable straight line (knee and chest), metres. */
  readonly kneeHeight: number;
  readonly chestHeight: number;
  /**
   * Body radius (metres) for the check that a route's last node has a straight walk to the target.
   * One goal node per target is shared by every enemy chasing it, so it is not any one body.
   */
  readonly goalClearance: number;
}

export const ENEMY_RULES: EnemyRules = {
  thinkInterval: 0.1,
  maxAlive: 64,
  separationDistance: 0.8,
  separationStrength: 2.5,
  separationSpeedFactor: 1.5,
  separationAnticipation: 0.5,
  arrivalRadius: 0.6,
  replanInterval: 1,
  stuckTime: 0.8,
  stuckDistance: 0.2,
  maxRise: 0.5,
  kneeHeight: 0.4,
  chestHeight: 1.3,
  goalClearance: 0.35,
};

/**
 * Design identity (GAME_DESIGN §7). `inV1`: in the default roster (O-3, resolved by D-043). The
 * Climber stays out of normal waves; the adaptive system may introduce it later.
 */
export const ENEMY_ARCHETYPES: Readonly<
  Record<
    EnemyArchetypeId,
    { readonly name: string; readonly purpose: string; readonly inV1: boolean }
  >
> = {
  walker: { name: 'Walker', purpose: 'Baseline; teaches headshots', inV1: true },
  runner: { name: 'Runner', purpose: 'Punishes standing still; dangerous in groups', inV1: true },
  tank: { name: 'Tank', purpose: 'Forces focus fire; blocks chokepoints', inV1: true },
  screamer: { name: 'Screamer', purpose: 'Forces target prioritisation', inV1: true },
  climber: {
    name: 'Climber',
    purpose: 'Counters camping on high ground (deferred: adaptive content)',
    inV1: false,
  },
};
