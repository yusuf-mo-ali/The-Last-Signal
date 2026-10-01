/**
 * Active adaptations → the next wave's composition modifier (D-026, D-047). Pure.
 *
 * One `CompositionModifier` with `source: 'adaptive'`, already inside the adaptive caps (the
 * generator enforces them again, and then its own clamps): weights multiplied across active
 * adaptations and clamped per archetype; Armored / Helmeted chances added, only once a trait's
 * schedule has started, capped in total; the Climber's count from its adaptive unlock (its
 * fallback before); spawn bias toward where the player dwells. Never the budget, Elites, surges or
 * anything else a mutation owns. None at all on the final wave.
 */

import {
  ADAPTATION_GUARDRAILS,
  ADAPTATIONS,
  type AdaptiveResponse,
  type SignalId,
} from '../config/adaptation';
import type { ImplementedEnemyId } from '../config/enemies';
import {
  FINAL_WAVE,
  WAVE_RULES,
  type CompositionModifier,
  type SpawnRegionId,
  type WaveRules,
} from '../config/waves';
import type { SpawnPointDefinition } from '../world/levels/types';
import { isAdaptiveUnlocked, waveIndex } from '../waves/WaveDifficulty';
import type { ActiveAdaptation } from './types';

export interface ComposeContext {
  /** The wave being shaped. */
  readonly wave: number;
  /** Regions nearest where the player dwells (for `spawnBias: 'dwellNearest'`). */
  readonly dwellRegions?: readonly SpawnRegionId[];
  readonly rules?: WaveRules;
}

const ADAPTIVE_TRAITS = ['armored', 'helmeted'] as const;

/** The response an active adaptation asks for on `wave` (its extra's fallback before its unlock). */
export function responseFor(
  a: ActiveAdaptation,
  wave: number,
  rules: WaveRules = WAVE_RULES,
): { response: AdaptiveResponse; subject: ImplementedEnemyId | null } | null {
  const variant = ADAPTATIONS[a.id].variants.find((v) => v.key === a.key);
  const response = variant?.levels[a.level - 1];
  if (!variant || !response) {
    return null;
  }
  const extra = response.extra;
  if (extra && !isAdaptiveUnlocked(extra.archetype, wave, rules)) {
    const { extra: _unused, ...rest } = response;
    return { response: { ...rest, ...(extra.fallback ?? {}) }, subject: variant.subject ?? null };
  }
  return { response, subject: variant.subject ?? null };
}

export function composeModifiers(
  active: readonly ActiveAdaptation[],
  context: ComposeContext,
): CompositionModifier[] {
  const rules = context.rules ?? WAVE_RULES;
  const wave = waveIndex(context.wave);
  const caps = ADAPTATION_GUARDRAILS.caps;
  if ((ADAPTATION_GUARDRAILS.noAdaptationOnFinale && wave === FINAL_WAVE) || active.length === 0) {
    return [];
  }
  const weights: Partial<Record<ImplementedEnemyId, number>> = {};
  const traits: Partial<Record<(typeof ADAPTIVE_TRAITS)[number], number>> = {};
  const extras: Partial<Record<ImplementedEnemyId, number>> = {};
  let bias = false;
  for (const a of active) {
    const resolved = responseFor(a, wave, rules);
    if (!resolved) {
      continue;
    }
    const { response, subject } = resolved;
    for (const [id, w] of Object.entries(response.archetypeWeights ?? {}) as [
      ImplementedEnemyId,
      number,
    ][]) {
      weights[id] = (weights[id] ?? 1) * w;
    }
    if (subject && response.subjectWeight !== undefined) {
      weights[subject] = (weights[subject] ?? 1) * response.subjectWeight;
    }
    for (const t of ADAPTIVE_TRAITS) {
      const add = response.traitChance?.[t];
      // Only once the trait's own schedule has started: adaptation never brings a trait early.
      if (add !== undefined && wave >= rules.traits[t].from) {
        traits[t] = (traits[t] ?? 0) + add;
      }
    }
    if (response.extra) {
      const id = response.extra.archetype;
      extras[id] = Math.max(extras[id] ?? 0, response.extra.count);
    }
    if (response.spawnBias === 'dwellNearest') {
      bias = true;
    }
  }
  // Caps.
  const [lo, hi] = caps.weight;
  for (const id of Object.keys(weights) as ImplementedEnemyId[]) {
    weights[id] = Math.min(hi, Math.max(lo, weights[id] ?? 1));
  }
  const traitTotal = ADAPTIVE_TRAITS.reduce((sum, t) => sum + (traits[t] ?? 0), 0);
  if (traitTotal > caps.traitTotal) {
    const scale = caps.traitTotal / traitTotal;
    for (const t of ADAPTIVE_TRAITS) {
      if (traits[t] !== undefined) {
        traits[t] = (traits[t] ?? 0) * scale;
      }
    }
  }
  let extrasLeft = rules.extraArchetypeMax;
  for (const id of Object.keys(extras).sort() as ImplementedEnemyId[]) {
    const n = Math.min(extras[id] ?? 0, extrasLeft);
    extras[id] = n;
    extrasLeft -= n;
  }
  const spawnBias = bias ? (context.dwellRegions ?? []).slice(0, caps.biasRegions) : [];
  const modifier: CompositionModifier = {
    source: 'adaptive',
    ...(Object.keys(weights).length > 0 ? { archetypeWeights: weights } : {}),
    ...(Object.keys(traits).length > 0 ? { traitChance: traits } : {}),
    ...(Object.values(extras).some((n) => n > 0) ? { extraCounts: extras } : {}),
    ...(spawnBias.length > 0 ? { spawnBias } : {}),
  };
  return Object.keys(modifier).length > 1 ? [modifier] : [];
}

/**
 * Per signal, the archetypes an active adaptation brought in for it: their hits and samples count
 * down toward that signal (`ADAPTATION_GUARDRAILS.attribution`), so no response feeds its cause.
 */
export function boostedArchetypes(
  active: readonly ActiveAdaptation[],
  wave: number,
  rules: WaveRules = WAVE_RULES,
): Map<SignalId, Set<string>> {
  const out = new Map<SignalId, Set<string>>();
  for (const a of active) {
    const variant = ADAPTATIONS[a.id].variants.find((v) => v.key === a.key);
    const resolved = responseFor(a, wave, rules);
    if (!variant || !resolved) {
      continue;
    }
    const set = out.get(variant.signal) ?? new Set<string>();
    const { response, subject } = resolved;
    for (const [id, w] of Object.entries(response.archetypeWeights ?? {})) {
      if (w > 1) {
        set.add(id);
      }
    }
    if (subject && (response.subjectWeight ?? 1) > 1) {
      set.add(subject);
    }
    if (response.extra) {
      set.add(response.extra.archetype);
    }
    out.set(variant.signal, set);
  }
  return out;
}

/**
 * The `count` spawn regions nearest (x, z): by each region's nearest point that normal waves use
 * (not `elevated`). Ties go to the region id, so the result is deterministic.
 */
export function regionsNear(
  centroid: readonly [number, number] | null,
  points: readonly SpawnPointDefinition[],
  count: number = ADAPTATION_GUARDRAILS.caps.biasRegions,
): SpawnRegionId[] {
  if (!centroid) {
    return [];
  }
  const best = new Map<SpawnRegionId, number>();
  for (const p of points) {
    if (p.tags?.includes('elevated')) {
      continue;
    }
    const d = Math.hypot(p.position[0] - centroid[0], p.position[2] - centroid[1]);
    best.set(p.region, Math.min(best.get(p.region) ?? Infinity, d));
  }
  return [...best.entries()]
    .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))
    .slice(0, count)
    .map(([region]) => region);
}
