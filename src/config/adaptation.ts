/**
 * Adaptive horde configuration (plan §15, GAME_DESIGN §10, D-026).
 * Metrics are the plan's; guardrails are the design's proposed values; rules arrive in Phase 8.
 */

import type { EnemyArchetypeId, EnemyModifierId } from './enemies';

/** Plan §15 player behaviour metrics. */
export const ADAPTIVE_METRICS = [
  'shotgunUsage',
  'rifleUsage',
  'headshotRate',
  'averageDistance',
  'timeSpentInOneArea',
  'elevatedPositionUsage',
  'sprintUsage',
  'meleeUsage',
  'accuracy',
  'damageTaken',
  'kiteFrequency',
] as const;
export type AdaptiveMetric = (typeof ADAPTIVE_METRICS)[number];

export interface AdaptationRule {
  readonly id: string;
  readonly metric: AdaptiveMetric;
  /** The rule activates above this value and deactivates below `exitThreshold` (hysteresis). */
  readonly enterThreshold: number;
  readonly exitThreshold: number;
  /** Minimum evidence (relevant events) before the rule may fire. */
  readonly minSamples: number;
  /** Waves before the rule may fire again. */
  readonly cooldownWaves: number;
  readonly response: {
    readonly archetypeWeights?: Readonly<Partial<Record<EnemyArchetypeId, number>>>;
    readonly modifierChance?: Readonly<Partial<Record<EnemyModifierId, number>>>;
  };
}

/** GAME_DESIGN §10.2 guardrails [Proposed, D-026]. */
export const ADAPTATION_GUARDRAILS = {
  /** No adaptation before this wave. */
  firstAdaptiveWave: 5,
  /** Waves of evidence required before any rule fires. */
  minWavesOfEvidence: 2,
  /** Most adaptations active at once. */
  maxActiveAdaptations: 2,
} as const;
