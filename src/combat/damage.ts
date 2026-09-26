/**
 * Damage calculation (ARCHITECTURE §7.3 step 5, GAME_DESIGN §6, D-041): one pure function, with
 * no randomness, no state and no knowledge of what is being hit. The same inputs always give the
 * same number, which is what makes combat testable and reproducible.
 *
 * Order:
 *   base damage × distance falloff × zone multiplier × attacker multiplier
 *   → armor: a flat reduction per hit, never below the minimum-damage floor
 *   → resistance: a fraction removed last
 *
 * Zone multiplier: body zones use the target's table (the plan's defaults, archetype overrides).
 * HEAD uses the attacking weapon's own headshot multiplier (the Pistol's 2.5 is the plan's HEAD
 * value; Bare Hands 1.5), scaled by the target's HEAD entry relative to the plan's, so a target
 * with a tougher or weaker head changes every weapon's headshot in proportion.
 * A critical hit is a headshot. There are no random crits (GAME_DESIGN §6).
 */

import { COMBAT_RULES, type CombatRules } from '../config/combat';
import { DEFAULT_ZONE_MULTIPLIERS, type DamageZone } from '../config/enemies';

export type ZoneMultipliers = Partial<Record<DamageZone, number>>;

export interface DamageInput {
  /** The weapon's damage for this pellet or swing, before any multiplier. */
  readonly baseDamage: number;
  /** Distance falloff factor from the weapon's hit result (1 = none; melee has none). */
  readonly falloff: number;
  readonly zone: DamageZone;
  /** The attacking weapon's headshot multiplier. */
  readonly headshotMultiplier: number;
  /** The target's overrides of the plan's zone multipliers. */
  readonly zoneMultipliers?: ZoneMultipliers;
  /** Attacker modifiers (upgrades such as damage or headshot bonuses, later). Default 1. */
  readonly attackerMultiplier?: number;
  /** Flat reduction per hit (armored enemies, later). Default 0. */
  readonly armor?: number;
  /** Fraction of damage removed, 0–1 (resistances, later). Default 0. */
  readonly resistance?: number;
}

export interface DamageResult {
  /** Final damage to apply. Never negative, never NaN. */
  readonly amount: number;
  readonly zone: DamageZone;
  readonly zoneMultiplier: number;
  /** A headshot. */
  readonly critical: boolean;
  /** Damage before armor and resistance. */
  readonly raw: number;
  /** How much armor removed. */
  readonly armorReduction: number;
}

/** Clamps anything unusable (negative, NaN, infinite) to `fallback`. */
function sane(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value >= 0 ? value : fallback;
}

/** The multiplier a zone applies for a weapon, given the target's overrides. */
export function zoneMultiplier(
  zone: DamageZone,
  headshotMultiplier: number,
  overrides?: ZoneMultipliers,
): number {
  const table = overrides?.[zone] ?? DEFAULT_ZONE_MULTIPLIERS[zone];
  if (zone !== 'HEAD') {
    return sane(table, 0);
  }
  return sane(headshotMultiplier, 0) * (sane(table, 0) / DEFAULT_ZONE_MULTIPLIERS.HEAD);
}

export function computeDamage(input: DamageInput, rules: CombatRules = COMBAT_RULES): DamageResult {
  const multiplier = zoneMultiplier(input.zone, input.headshotMultiplier, input.zoneMultipliers);
  const raw =
    sane(input.baseDamage, 0) *
    Math.min(1, sane(input.falloff, 1)) *
    multiplier *
    sane(input.attackerMultiplier, 1);

  let amount = raw;
  let armorReduction = 0;
  const armor = sane(input.armor, 0);
  if (armor > 0 && raw > 0) {
    // Flat reduction with a floor, but armor never raises a hit weaker than the floor.
    amount = Math.min(raw, Math.max(sane(rules.minimumDamage, 0), raw - armor));
    armorReduction = raw - amount;
  }
  amount *= 1 - Math.min(1, sane(input.resistance, 0));

  return {
    amount,
    zone: input.zone,
    zoneMultiplier: multiplier,
    critical: input.zone === 'HEAD',
    raw,
    armorReduction,
  };
}
