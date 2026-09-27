/**
 * Enemy traits (plan §15 "armored", "protected-head", "elite"; GAME_DESIGN §7 modifiers; D-012,
 * D-043): data overlays on any archetype. A trait never names an archetype and never adds a class:
 * `applyTraits` folds a set of traits into an archetype's definition, and every system reads the
 * result (stats, combat's per-zone armor and breakable plates, drops, the view's attachments).
 *
 * Composition is deterministic: traits apply in `ENEMY_MODIFIER_IDS` order whatever order they are
 * given in, duplicates count once, multipliers multiply, per-zone armor adds up, plates and bonus
 * drops are collected.
 */

import type { DropTableId } from './drops';
import {
  ENEMY_MODIFIER_IDS,
  type DamageZone,
  type EnemyArchetypeConfig,
  type EnemyModifierId,
} from './enemies';

/**
 * Breakable armor over some zones (a helmet): it absorbs the damage those zones would take until
 * its `durability` is used up, then it breaks and stops protecting.
 */
export interface ArmorPlateDefinition {
  readonly id: string;
  readonly zones: readonly DamageZone[];
  readonly durability: number;
  /** Breaking it staggers the wearer (knocking a helmet off rocks the zombie back). */
  readonly staggerOnBreak: boolean;
}

export interface EnemyTraitDefinition {
  readonly id: EnemyModifierId;
  readonly name: string;
  /** What it asks of the player. */
  readonly purpose: string;
  readonly healthMultiplier?: number;
  readonly moveSpeedMultiplier?: number;
  readonly attackDamageMultiplier?: number;
  readonly staggerThresholdMultiplier?: number;
  readonly threatCostMultiplier?: number;
  /** Flat armor per hit on these zones (added to the archetype's own armor). */
  readonly zoneArmor?: Partial<Record<DamageZone, number>>;
  readonly plates?: readonly ArmorPlateDefinition[];
  /** Rolled on death in addition to the archetype's own drop table. */
  readonly bonusDrops?: DropTableId;
}

// Pass-1 values; reasoning in BALANCING.md §2.10.
export const ENEMY_TRAITS: Readonly<Record<EnemyModifierId, EnemyTraitDefinition>> = {
  armored: {
    id: 'armored',
    name: 'Armored',
    purpose: 'Punishes spraying the body; rewards headshots and heavy single hits',
    zoneArmor: { TORSO: 10, ARM_LEFT: 6, ARM_RIGHT: 6, LEG_LEFT: 6, LEG_RIGHT: 6 },
    moveSpeedMultiplier: 0.9,
    threatCostMultiplier: 1.5,
  },
  helmeted: {
    id: 'helmeted',
    name: 'Helmeted',
    purpose: 'Slows down headshot play without shutting it out: knock the helmet off first',
    plates: [{ id: 'helmet', zones: ['HEAD'], durability: 50, staggerOnBreak: true }],
    threatCostMultiplier: 1.3,
  },
  elite: {
    id: 'elite',
    name: 'Elite',
    purpose: 'A tougher, faster, harder-hitting version worth focusing, with a bonus reward',
    healthMultiplier: 1.6,
    moveSpeedMultiplier: 1.1,
    attackDamageMultiplier: 1.3,
    staggerThresholdMultiplier: 1.5,
    threatCostMultiplier: 2.5,
    bonusDrops: 'elite',
  },
};

/** An archetype with its traits folded in: what an enemy actually is. */
export interface EnemyConfig extends EnemyArchetypeConfig {
  /** The archetype before traits. */
  readonly base: EnemyArchetypeConfig;
  /** Canonical order, no duplicates. */
  readonly traits: readonly EnemyModifierId[];
  /** Flat armor per zone from traits (the archetype's `armor` applies to every zone as well). */
  readonly zoneArmor: Readonly<Partial<Record<DamageZone, number>>>;
  readonly plates: readonly ArmorPlateDefinition[];
  readonly bonusDrops: readonly DropTableId[];
}

/** The canonical form of a trait list: known ids, `ENEMY_MODIFIER_IDS` order, each once. */
export function normalizeTraits(traits: readonly string[]): EnemyModifierId[] {
  for (const trait of traits) {
    if (!(ENEMY_MODIFIER_IDS as readonly string[]).includes(trait)) {
      throw new Error(`Unknown trait "${trait}". Traits: ${ENEMY_MODIFIER_IDS.join(', ')}`);
    }
  }
  return ENEMY_MODIFIER_IDS.filter((id) => traits.includes(id));
}

/**
 * Folds `traits` into `base` (pure and deterministic; see the file header). `definitions` defaults
 * to `ENEMY_TRAITS` (tests pass others to check how overlays compose).
 */
export function applyTraits(
  base: EnemyArchetypeConfig,
  traits: readonly string[] = [],
  definitions: Readonly<Record<EnemyModifierId, EnemyTraitDefinition>> = ENEMY_TRAITS,
): EnemyConfig {
  const ids = normalizeTraits(traits);
  let health = 1;
  let speed = 1;
  let damage = 1;
  let stagger = 1;
  let threat = 1;
  const zoneArmor: Partial<Record<DamageZone, number>> = {};
  const plates: ArmorPlateDefinition[] = [];
  const bonusDrops: DropTableId[] = [];
  for (const id of ids) {
    const trait = definitions[id];
    health *= trait.healthMultiplier ?? 1;
    speed *= trait.moveSpeedMultiplier ?? 1;
    damage *= trait.attackDamageMultiplier ?? 1;
    stagger *= trait.staggerThresholdMultiplier ?? 1;
    threat *= trait.threatCostMultiplier ?? 1;
    for (const [zone, armor] of Object.entries(trait.zoneArmor ?? {}) as [DamageZone, number][]) {
      zoneArmor[zone] = (zoneArmor[zone] ?? 0) + armor;
    }
    plates.push(...(trait.plates ?? []));
    if (trait.bonusDrops) {
      bonusDrops.push(trait.bonusDrops);
    }
  }
  return {
    ...base,
    base,
    traits: ids,
    health: base.health * health,
    moveSpeed: base.moveSpeed * speed,
    attackDamage: base.attackDamage * damage,
    staggerThreshold: base.staggerThreshold * stagger,
    threatCost: base.threatCost * threat,
    zoneArmor,
    plates,
    bonusDrops,
  };
}
