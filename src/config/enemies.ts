/**
 * Enemy configuration (plan §10–12, GAME_DESIGN §6–7, D-012: archetype + modifiers, D-042).
 * Holds the identity data, the plan's damage-zone multipliers, the full definition of each
 * implemented archetype (the Walker since Phase 4; the others arrive in Phase 5) and the rules
 * shared by every enemy.
 */

import { HUMANOID_REACH_POSE, HUMANOID_RIG, type HitboxRigDefinition } from './combat';
import type { DropTableId } from './drops';

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

/** Generic behaviours an archetype can use (enemies/ai). Phase 4 has the melee chaser only. */
export const ENEMY_BEHAVIOR_IDS = ['melee'] as const;
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
 * Archetypes with a full definition. Only the Walker in Phase 4; the Runner, Tank and Screamer
 * are config entries in Phase 5 (and the Climber after O-3), with no new AI code unless their
 * behaviour needs it.
 */
export const IMPLEMENTED_ENEMY_IDS = ['walker'] as const;
export type ImplementedEnemyId = (typeof IMPLEMENTED_ENEMY_IDS)[number];

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
  arrivalRadius: 0.6,
  replanInterval: 1,
  stuckTime: 0.8,
  stuckDistance: 0.2,
  maxRise: 0.5,
  kneeHeight: 0.4,
  chestHeight: 1.3,
  goalClearance: 0.35,
};

/** Design identity (GAME_DESIGN §7). `inV1`: the 4-archetype initial roster [Open O-3 default]. */
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
  climber: { name: 'Climber', purpose: 'Counters camping on high ground', inV1: false },
};
