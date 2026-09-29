/**
 * Signal Mutation catalogue (plan §14, GAME_DESIGN §9, D-024, D-045). Mutations are pure data: a
 * mutation is a set of effects (D-009) plus how the player is told about it. `WaveMutation`
 * selects one per wave; `SignalMutationSystem` applies its runtime effects at wave start and
 * removes them when the wave ends; its composition (spawnRule) effects shape the wave when it is
 * generated. Nothing about any single mutation is written into the wave runtime.
 *
 * O-4 (resolved by D-045): BLACKOUT, HUNGER, STATIC, SCREAM, HIVE and BLOOD MOON ship; LOW GRAVITY
 * and OVERLOAD are `deferred`: kept as data, never selected, and naming targets the runtime does
 * not register yet, so they cannot be applied by accident.
 *
 * SCREAM is shown to the player as "Death Cry" (D-045): it is not the Screamer's scream. Its
 * alarm is a different kind (`deathCry`): smaller, briefer, and it never calls reinforcements.
 */

import type { Effect, EffectKind } from './effects';
import type { DifficultyTierId } from './waves';

export const MUTATION_IDS = [
  'BLACKOUT',
  'HUNGER',
  'STATIC',
  'SCREAM',
  'HIVE',
  'BLOOD_MOON',
  'LOW_GRAVITY',
  'OVERLOAD',
] as const;
export type MutationId = (typeof MUTATION_IDS)[number];

export type MutationStatus = 'enabled' | 'deferred';

/** Mutations in the same group never follow each other (two visibility waves in a row). */
export type MutationGroup = 'vision';

export interface MutationConfig {
  readonly id: MutationId;
  /** Player-facing name (the HUD shows it upper-case). */
  readonly name: string;
  /** The one-line rule shown when the wave is announced. */
  readonly rule: string;
  /** Counter-play hint shown under the rule. */
  readonly hint: string;
  readonly status: MutationStatus;
  /** First wave it can be selected on. */
  readonly minWave: number;
  /** Selection weight per difficulty tier (0 = never in that tier). */
  readonly weights: Readonly<Record<DifficultyTierId, number>>;
  readonly group?: MutationGroup;
  /** HUD accent colour (CSS). */
  readonly accent: string;
  readonly effects: readonly Effect[];
}

const tiers = (
  variety: number,
  pressure: number,
  complex: number,
): Readonly<Record<DifficultyTierId, number>> => ({
  introduction: 0,
  variety,
  pressure,
  complex,
  boss: 0,
});

/** Pass-1 values; reasoning in BALANCING.md §2.15. */
export const MUTATIONS: Readonly<Record<MutationId, MutationConfig>> = {
  BLACKOUT: {
    id: 'BLACKOUT',
    name: 'Blackout',
    rule: 'The lights are failing; only the red emergency lights stay on.',
    hint: 'Hold the lit zones. Your muzzle flash lights the way.',
    status: 'enabled',
    minWave: 4,
    weights: tiers(1, 1, 1),
    group: 'vision',
    accent: '#7fa6ff',
    effects: [{ kind: 'environment', overlay: 'blackout', priority: 20, fadeIn: 2.5, fadeOut: 2 }],
  },
  HUNGER: {
    id: 'HUNGER',
    name: 'Hunger',
    rule: 'Zombies move 20 % faster.',
    hint: 'Keep your distance and a way out.',
    status: 'enabled',
    minWave: 4,
    weights: tiers(1.2, 1, 1),
    accent: '#ff9f43',
    effects: [
      { kind: 'stat', target: 'enemy.moveSpeed', op: 'mul', value: 1.2 },
      { kind: 'stat', target: 'enemy.acceleration', op: 'mul', value: 1.2 },
    ],
  },
  STATIC: {
    id: 'STATIC',
    name: 'Static',
    rule: 'Signal interference breaks up your view now and then.',
    hint: 'Your crosshair and HUD stay clear. Keep tracking through it.',
    status: 'enabled',
    minWave: 6,
    weights: tiers(0.8, 1, 1),
    group: 'vision',
    accent: '#b8c4cc',
    effects: [
      {
        kind: 'screen',
        effect: 'static',
        params: {
          intervalMin: 6,
          intervalMax: 10,
          durationMin: 0.4,
          durationMax: 0.7,
          opacity: 0.32,
          firstAfter: 4,
        },
      },
    ],
  },
  SCREAM: {
    id: 'SCREAM',
    name: 'Death Cry',
    rule: 'Every kill cries out: zombies nearby surge at you.',
    hint: 'Kill them apart, or from range.',
    status: 'enabled',
    minWave: 5,
    weights: tiers(1, 1, 1),
    accent: '#ff4d4d',
    effects: [
      {
        kind: 'trigger',
        on: 'enemy:died',
        action: 'deathCry',
        params: { radius: 8, alertDuration: 6, hasteMultiplier: 1.2, hasteDuration: 2.5 },
      },
    ],
  },
  HIVE: {
    id: 'HIVE',
    name: 'Hive',
    rule: 'The horde is bigger and surges in twice.',
    hint: 'Watch for the surge warning and turn to face it.',
    status: 'enabled',
    minWave: 7,
    weights: tiers(0.6, 1, 1.2),
    accent: '#d4c14a',
    effects: [
      {
        kind: 'spawnRule',
        composition: { budgetMultiplier: 1.3 },
        surges: { at: [0.4, 0.75], extraGroupSize: 2, warning: 2 },
      },
    ],
  },
  BLOOD_MOON: {
    id: 'BLOOD_MOON',
    name: 'Blood Moon',
    rule: 'Elite zombies are far more common.',
    hint: 'Fewer, tougher enemies: pick your targets.',
    status: 'enabled',
    minWave: 9,
    weights: tiers(0, 0.8, 1.2),
    accent: '#e0443a',
    effects: [
      {
        kind: 'spawnRule',
        composition: {
          traitChance: { elite: 0.15 },
          eliteMaxBonus: 1,
          eliteMaxBonusFrom: 9,
          eliteMaxBonusEvery: 5,
          eliteMinimum: 1,
        },
      },
      { kind: 'environment', overlay: 'bloodMoon', priority: 10, fadeIn: 2.5, fadeOut: 2 },
    ],
  },
  // ---- Deferred (O-4): data only; the runtime does not register their targets yet ----
  LOW_GRAVITY: {
    id: 'LOW_GRAVITY',
    name: 'Low Gravity',
    rule: 'Everyone jumps higher and falls slower.',
    hint: 'Use the height.',
    status: 'deferred',
    minWave: 8,
    weights: tiers(0, 1, 1),
    accent: '#8fd3ff',
    effects: [{ kind: 'stat', target: 'world.gravity', op: 'mul', value: 0.5 }],
  },
  OVERLOAD: {
    id: 'OVERLOAD',
    name: 'Overload',
    rule: 'Gunfire overloads the facility; recoil is heavier.',
    hint: 'Fire in bursts.',
    status: 'deferred',
    minWave: 8,
    weights: tiers(0, 1, 1),
    accent: '#ffe066',
    effects: [
      { kind: 'trigger', on: 'weapon:shot', action: 'environmentPulse' },
      { kind: 'stat', target: 'weapon.recoil', op: 'mul', value: 1.3 },
    ],
  },
};

/** The effect kinds a mutation uses (derived from its effects). */
export function mutationEffectKinds(id: MutationId): EffectKind[] {
  return [...new Set(MUTATIONS[id].effects.map((e) => e.kind))];
}

/** Mutations the selector may pick. */
export const ENABLED_MUTATION_IDS: readonly MutationId[] = MUTATION_IDS.filter(
  (id) => MUTATIONS[id].status === 'enabled',
);

/** Selection rules (D-045). The first waves and the final wave carry none (O-7). */
export const MUTATION_RULES = {
  /** Mutations used within this many previous waves are less likely (the previous one never). */
  cooldownWaves: 3,
  /** Weight factor for a mutation used within `cooldownWaves`. */
  recentPenalty: 0.35,
} as const;
