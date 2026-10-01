/**
 * The wave difficulty curves (plan §13, D-044): pure functions of the wave number and the rules.
 * No randomness, no state. Defined for every wave number ≥ 1 (unlimited waves): up to the final
 * wave the budget follows a gentle quadratic, after it a straight line at the final wave's slope,
 * and concurrency, spawn rate and trait chances all have caps.
 */

import type { EnemyModifierId, ImplementedEnemyId } from '../config/enemies';
import {
  DIFFICULTY_TIERS,
  FINAL_WAVE,
  WAVE_RULES,
  type DifficultyTierId,
  type WaveRules,
} from '../config/waves';

/** Clamps a wave number to a whole number ≥ 1. */
export function waveIndex(n: number): number {
  return Number.isFinite(n) ? Math.max(1, Math.floor(n)) : 1;
}

/** Threat points to spend on wave `n`. */
export function waveBudget(n: number, rules: WaveRules = WAVE_RULES): number {
  const w = waveIndex(n);
  const { base, linear, quadratic, endlessSlope } = rules.budget;
  const curve = (k: number) => Math.round(base + linear * (k - 1) + quadratic * (k - 1) ** 2);
  return w <= FINAL_WAVE
    ? curve(w)
    : Math.round(curve(FINAL_WAVE) + endlessSlope * (w - FINAL_WAVE));
}

/** Most wave enemies alive at once on wave `n`. */
export function waveMaxAlive(n: number, rules: WaveRules = WAVE_RULES): number {
  const w = waveIndex(n);
  const { base, perWave, cap, endlessCap, endlessEvery } = rules.maxAlive;
  const inRun = Math.min(cap, Math.round(base + perWave * w));
  return w <= FINAL_WAVE
    ? inRun
    : Math.min(endlessCap, cap + Math.floor((w - FINAL_WAVE) / endlessEvery));
}

/** Enemies spawned per second on wave `n` while below its concurrency cap. */
export function waveSpawnRate(n: number, rules: WaveRules = WAVE_RULES): number {
  const { base, perWave, cap } = rules.spawnRate;
  return Math.min(cap, base + perWave * waveIndex(n));
}

/** Largest spawn group on wave `n` (before the ambush bonus). */
export function waveGroupMax(n: number, rules: WaveRules = WAVE_RULES): number {
  const { every, max } = rules.groupSize;
  return Math.min(max, 1 + Math.floor(waveIndex(n) / every));
}

/** The plan's difficulty tier of wave `n` (waves after the last tier count as `complex`). */
export function waveTier(n: number): DifficultyTierId {
  const w = waveIndex(n);
  return DIFFICULTY_TIERS.find((t) => w >= t.firstWave && w <= t.lastWave)?.id ?? 'complex';
}

/** Whether `archetype` may appear on wave `n` (never, for one outside the roster's unlocks). */
export function isUnlocked(
  archetype: ImplementedEnemyId,
  n: number,
  rules: WaveRules = WAVE_RULES,
): boolean {
  const from = rules.unlocks[archetype];
  return from !== undefined && waveIndex(n) >= from;
}

/** Whether the adaptive system may bring `archetype` (outside the roster) on wave `n` (D-047). */
export function isAdaptiveUnlocked(
  archetype: ImplementedEnemyId,
  n: number,
  rules: WaveRules = WAVE_RULES,
): boolean {
  const from = rules.adaptiveUnlocks[archetype];
  return from !== undefined && waveIndex(n) >= from;
}

/** Most of `archetype` on wave `n` (Infinity when uncapped; 0 before its unlock). */
export function waveCap(
  archetype: ImplementedEnemyId,
  n: number,
  rules: WaveRules = WAVE_RULES,
): number {
  const w = waveIndex(n);
  if (!isUnlocked(archetype, w, rules)) {
    return 0;
  }
  const cap = rules.caps[archetype];
  return cap ? 1 + Math.floor((w - cap.from) / cap.every) : Number.POSITIVE_INFINITY;
}

/** Chance that one enemy of wave `n` gets `trait` (before modifiers). */
export function traitChance(
  trait: EnemyModifierId,
  n: number,
  rules: WaveRules = WAVE_RULES,
): number {
  const w = waveIndex(n);
  const s = rules.traits[trait];
  return w < s.from ? 0 : Math.min(s.max, s.perWave * (w - s.from + 1));
}

/** Most Elites on wave `n`. */
export function eliteMax(n: number, rules: WaveRules = WAVE_RULES): number {
  const w = waveIndex(n);
  if (w > FINAL_WAVE) {
    return 1 + Math.floor(w / rules.eliteMax.endlessEvery);
  }
  let max = 0;
  for (const step of rules.eliteMax.steps) {
    if (w >= step.fromWave) {
      max = step.max;
    }
  }
  return max;
}
