/**
 * Enemy configuration schema (plan §10–12, GAME_DESIGN §6–7, D-012: archetype + modifiers).
 * Holds the identity data and the plan's damage-zone multipliers; per-archetype numbers arrive
 * with the zombie foundation (Phase 4) and archetypes (Phase 5).
 */

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

/** Plan §11 base enemy properties, plus the threat cost the wave budget needs (§13). */
export interface EnemyArchetypeConfig {
  readonly health: number;
  /** m/s. */
  readonly moveSpeed: number;
  readonly attackDamage: number;
  /** Metres. */
  readonly attackRange: number;
  /** Metres. */
  readonly detectionRange: number;
  /** Seconds. */
  readonly attackCooldown: number;
  /** Cost against the wave's threat budget. */
  readonly threatCost: number;
  readonly zoneMultipliers?: Partial<Record<DamageZone, number>>;
  /** Damage in a short window that triggers STAGGER; `Infinity` = stagger-immune. */
  readonly staggerThreshold: number;
}

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
