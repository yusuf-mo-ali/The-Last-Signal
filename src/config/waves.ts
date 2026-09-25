/**
 * Wave configuration schema (plan §13, GAME_DESIGN §8). Holds the plan's difficulty tiers and run
 * length; the generator's curves arrive with the wave system (Phase 6).
 */

import type { EnemyArchetypeId } from './enemies';
import type { MutationId } from './mutations';

/** A standard run ends in victory after this wave (plan §42); the generator supports more (§13). */
export const FINAL_WAVE = 20;

/** Waves without a mutation at the start of a run [Proposed, O-7]. */
export const MUTATION_FREE_WAVES = 3;

export const DIFFICULTY_TIER_IDS = [
  'introduction',
  'variety',
  'pressure',
  'complex',
  'boss',
] as const;
export type DifficultyTierId = (typeof DIFFICULTY_TIER_IDS)[number];

/** Plan §13 tiers; wave ranges are inclusive. */
export const DIFFICULTY_TIERS: readonly {
  readonly id: DifficultyTierId;
  readonly firstWave: number;
  readonly lastWave: number;
  readonly description: string;
}[] = [
  { id: 'introduction', firstWave: 1, lastWave: 3, description: 'Basic introduction' },
  { id: 'variety', firstWave: 4, lastWave: 7, description: 'More enemy variety' },
  { id: 'pressure', firstWave: 8, lastWave: 12, description: 'Higher pressure' },
  { id: 'complex', firstWave: 13, lastWave: 19, description: 'Complex combinations' },
  { id: 'boss', firstWave: 20, lastWave: 20, description: 'Boss / major event' },
];

/** Plan §13: what each generated wave contains (plus the concurrency cap, ARCHITECTURE §7.8). */
export interface WaveDefinition {
  readonly waveNumber: number;
  /** Threat points to spend. */
  readonly enemyBudget: number;
  /** Enemies spawned per second while below `maxAlive`. */
  readonly spawnRate: number;
  readonly enemyComposition: Readonly<Partial<Record<EnemyArchetypeId, number>>>;
  readonly mutation: MutationId | null;
  readonly specialEvent: string | null;
  readonly bossFlag: boolean;
  readonly maxAlive: number;
}
