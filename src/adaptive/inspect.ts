/**
 * Evidence that an adaptation reaches the wave (D-047, Phase 8.1). Pure: given what the next
 * wave will be generated from (its number, the run seed, its mutation and the frozen adaptive
 * modifiers), it generates the wave twice, with and without the adaptive source, and reports the
 * difference: per archetype, per trait, and for each active adaptation on its own (did it change
 * anything at all?). The same seed and mutation are used for both, so every difference is the
 * adaptation's. Debug tools and tests only; the game never calls it.
 */

import type { EnemyModifierId, ImplementedEnemyId } from '../config/enemies';
import type { MutationId } from '../config/mutations';
import type { CompositionModifier, SpawnRegionId, WaveDefinition } from '../config/waves';
import { generateWave } from '../waves/WaveGenerator';
import { composeModifiers } from './compose';
import type { ActiveAdaptation } from './types';

/** A wave's make-up: bodies by archetype, and how many carry each trait. */
export interface WaveMakeup {
  readonly composition: Readonly<Partial<Record<ImplementedEnemyId, number>>>;
  readonly traits: Readonly<Partial<Record<EnemyModifierId, number>>>;
  readonly total: number;
  readonly spent: number;
  readonly spawnBias: readonly SpawnRegionId[];
}

export interface AdaptationEffect {
  readonly id: ActiveAdaptation['id'];
  readonly key: string;
  readonly level: 1 | 2;
  /** Its own change against the reference (generated with only this adaptation). */
  readonly delta: Readonly<Record<string, number>>;
  /** Whether it changed the generated wave at all (composition, traits or spawn bias). */
  readonly affected: boolean;
}

export interface WaveExplanation {
  readonly wave: number;
  readonly seed: string;
  readonly mutation: MutationId | null;
  readonly budget: number;
  readonly modifiers: readonly CompositionModifier[];
  readonly adapted: WaveMakeup;
  readonly reference: WaveMakeup;
  /** adapted − reference, per archetype and per trait (`trait:helmeted`); zeros left out. */
  readonly delta: Readonly<Record<string, number>>;
  readonly perAdaptation: readonly AdaptationEffect[];
}

export interface ExplainContext {
  readonly wave: number;
  readonly seed: string;
  readonly mutation: MutationId | null;
  readonly active: readonly ActiveAdaptation[];
  readonly dwellRegions?: readonly SpawnRegionId[];
}

/** A generated wave's make-up. */
export function makeupOf(def: WaveDefinition): WaveMakeup {
  const traits: Partial<Record<EnemyModifierId, number>> = {};
  for (const s of def.spawns) {
    for (const t of s.traits) {
      traits[t] = (traits[t] ?? 0) + 1;
    }
  }
  return {
    composition: { ...def.enemyComposition },
    traits,
    total: def.spawns.length,
    spent: Math.round(def.budgetSpent * 100) / 100,
    spawnBias: [...def.spawnBias],
  };
}

/** b − a per archetype and per trait (`trait:<id>`); zeros left out, keys sorted. */
export function makeupDelta(a: WaveMakeup, b: WaveMakeup): Record<string, number> {
  const out: Record<string, number> = {};
  const archetypes = new Set([...Object.keys(a.composition), ...Object.keys(b.composition)]);
  for (const k of [...archetypes].sort()) {
    const d =
      (b.composition[k as ImplementedEnemyId] ?? 0) - (a.composition[k as ImplementedEnemyId] ?? 0);
    if (d !== 0) {
      out[k] = d;
    }
  }
  const traits = new Set([...Object.keys(a.traits), ...Object.keys(b.traits)]);
  for (const t of [...traits].sort()) {
    const d = (b.traits[t as EnemyModifierId] ?? 0) - (a.traits[t as EnemyModifierId] ?? 0);
    if (d !== 0) {
      out[`trait:${t}`] = d;
    }
  }
  return out;
}

function sameBias(a: WaveMakeup, b: WaveMakeup): boolean {
  return a.spawnBias.join(',') === b.spawnBias.join(',');
}

/** The next wave with and without adaptation, and what each active adaptation did. */
export function explainWave(context: ExplainContext): WaveExplanation {
  const { wave, seed, mutation, active, dwellRegions } = context;
  const generate = (modifiers: readonly CompositionModifier[]) =>
    generateWave(wave, { seed, modifiers, mutation });
  const modifiers = composeModifiers(active, { wave, ...(dwellRegions ? { dwellRegions } : {}) });
  const referenceDef = generate([]);
  const reference = makeupOf(referenceDef);
  const adapted = makeupOf(generate(modifiers));
  const perAdaptation = active.map((a): AdaptationEffect => {
    const alone = makeupOf(
      generate(composeModifiers([a], { wave, ...(dwellRegions ? { dwellRegions } : {}) })),
    );
    const delta = makeupDelta(reference, alone);
    return {
      id: a.id,
      key: a.key,
      level: a.level,
      delta,
      affected: Object.keys(delta).length > 0 || !sameBias(reference, alone),
    };
  });
  return {
    wave,
    seed,
    mutation,
    budget: referenceDef.enemyBudget,
    modifiers,
    adapted,
    reference,
    delta: makeupDelta(reference, adapted),
    perAdaptation,
  };
}
