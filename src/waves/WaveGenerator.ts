/**
 * The wave generator (plan §13, ARCHITECTURE §7.8, D-044): wave number → `WaveDefinition`. Pure
 * and seeded: the same seed, wave number and modifiers always give the same wave, whatever order
 * waves are generated in (each wave draws from its own stream, `${seed}:wave:${n}`), so a preview
 * (`tls.previewWave`) matches what the run will get.
 *
 * Steps:
 *   1. Budget (threat points) from the difficulty curve; only a mutation may scale it (clamped).
 *   2. Tier and theme (intro, then a rotation of mixed / swarm / heavy / ambush that never repeats
 *      back to back, finale on the final wave).
 *   3. Guarantees: an archetype's first wave has exactly one of it; Walkers are at least a share of
 *      the budget; the finale has a minimum of heavies.
 *   4. Fill: weighted draws (tier × theme × clamped modifiers) among affordable archetypes under
 *      their cap, each with its traits rolled; Walkers fill the remainder, so the spend is within
 *      one point of the budget.
 *   5. Order: a seeded shuffle, with heavy archetypes kept out of the opening.
 *
 * Only roster archetypes appear (O-3, D-043: never the Climber). An archetype outside the roster
 * can only come from an adaptive modifier, only if implemented, and only a few per wave.
 */

import {
  DEFAULT_ROSTER,
  ENEMY_MODIFIER_IDS,
  ENEMY_STATS,
  IMPLEMENTED_ENEMY_IDS,
  type EnemyArchetypeId,
  type EnemyModifierId,
  type ImplementedEnemyId,
} from '../config/enemies';
import { MUTATIONS, type MutationId } from '../config/mutations';
import { applyTraits, normalizeTraits } from '../config/traits';
import {
  FINAL_WAVE,
  ROTATING_THEMES,
  WAVE_RULES,
  type CompositionModifier,
  type SpawnRegionId,
  type WaveDefinition,
  type WaveRules,
  type WaveSpawn,
  type WaveSurge,
  type WaveThemeId,
} from '../config/waves';
import { Rng } from '../utils/Rng';
import {
  eliteMax,
  isUnlocked,
  traitChance,
  waveBudget,
  waveCap,
  waveGroupMax,
  waveIndex,
  waveMaxAlive,
  waveSpawnRate,
  waveTier,
} from './WaveDifficulty';

export interface WaveContext {
  /** The run's seed: every wave draws from its own stream derived from it. */
  readonly seed: number | string;
  /** Adaptive (Phase 8) and mutation (Phase 7) influences; none in Phase 6. */
  readonly modifiers?: readonly CompositionModifier[];
  /** Chosen by `selectMutation` (D-024); none in Phase 6. */
  readonly mutation?: MutationId | null;
  /** The archetypes normal waves use (default `DEFAULT_ROSTER`). */
  readonly roster?: readonly ImplementedEnemyId[];
}

/** Tolerance for sums of fractional threat costs (1.3, 1.5, …). */
const EPSILON = 1e-9;

const clamp = (v: number, [lo, hi]: readonly [number, number]) => Math.min(hi, Math.max(lo, v));

function isImplemented(id: EnemyArchetypeId): id is ImplementedEnemyId {
  return (IMPLEMENTED_ENEMY_IDS as readonly string[]).includes(id);
}

/** Threat cost of one enemy with its traits. */
export function spawnCost(
  archetype: ImplementedEnemyId,
  traits: readonly EnemyModifierId[],
): number {
  return applyTraits(ENEMY_STATS[archetype], traits).threatCost;
}

/** The composition theme of wave `n` for a run seeded `seed`. */
export function waveTheme(n: number, seed: number | string): WaveThemeId {
  const w = waveIndex(n);
  if (w <= 3) {
    return 'intro';
  }
  if (w === FINAL_WAVE) {
    return 'finale';
  }
  // A fixed rotation from a seeded start: consecutive waves never share a theme (wave 20 is the
  // finale, and 19 and 21 are two steps apart in the rotation).
  const offset = new Rng(`${seed}:themes`).int(0, ROTATING_THEMES.length - 1);
  return ROTATING_THEMES[(offset + w - 4) % ROTATING_THEMES.length] ?? 'mixed';
}

export function generateWave(
  n: number,
  context: WaveContext,
  rules: WaveRules = WAVE_RULES,
): WaveDefinition {
  const wave = waveIndex(n);
  const rng = new Rng(`${context.seed}:wave:${wave}`);
  // The wave's mutation shapes it through the same channel as every other influence (D-045).
  const modifiers = [
    ...(context.modifiers ?? []),
    ...mutationModifiers(context.mutation ?? null, wave),
  ];
  const fromMutations = modifiers.filter((m) => m.source === 'mutation');
  const roster = context.roster ?? DEFAULT_ROSTER;
  const tier = waveTier(wave);
  const theme = waveTheme(wave, context.seed);
  const finale = wave === FINAL_WAVE;

  // 1. Budget: only mutations may change it (D-026: adaptation changes the mix, not the total).
  let budgetScale = 1;
  for (const m of modifiers) {
    if (m.source === 'mutation' && m.budgetMultiplier !== undefined) {
      budgetScale *= m.budgetMultiplier;
    }
  }
  const budget = Math.round(
    waveBudget(wave, rules) * clamp(budgetScale, rules.modifierClamp.budget),
  );

  // 2. Who may appear, with what weight and cap.
  const extras = new Set<ImplementedEnemyId>();
  for (const m of modifiers) {
    if (m.source !== 'adaptive') {
      continue;
    }
    for (const id of m.extraArchetypes ?? []) {
      if (isImplemented(id) && !roster.includes(id)) {
        extras.add(id);
      }
    }
  }
  const candidates = [...roster.filter((a) => isUnlocked(a, wave, rules)), ...extras];
  const weights = new Map<ImplementedEnemyId, number>();
  for (const a of candidates) {
    let scale = 1;
    for (const m of modifiers) {
      scale *= m.archetypeWeights?.[a] ?? 1;
    }
    const base = extras.has(a) ? 0.5 : (rules.tierWeights[tier][a] ?? 0);
    const w =
      base * (rules.themeMultipliers[theme][a] ?? 1) * clamp(scale, rules.modifierClamp.weight);
    if (w > 0) {
      weights.set(a, w);
    }
  }
  const caps = new Map<ImplementedEnemyId, number>();
  for (const a of candidates) {
    // An archetype's first wave introduces exactly one of it.
    const introduced = a !== 'walker' && !extras.has(a) && wave === rules.unlocks[a];
    caps.set(a, introduced ? 1 : waveCap(a, wave, rules));
  }
  let extrasLeft = rules.extraArchetypeMax;
  // Base (trait-free) cost of each candidate, looked up on every draw.
  const baseCost = new Map(candidates.map((a) => [a, spawnCost(a, [])] as const));

  // Trait chances: the schedule plus clamped modifiers.
  const chances = new Map<EnemyModifierId, number>();
  for (const t of ENEMY_MODIFIER_IDS) {
    let extra = 0;
    for (const m of modifiers) {
      extra += m.traitChance?.[t] ?? 0;
    }
    const limit = rules.modifierClamp.traitChance;
    const p = traitChance(t, wave, rules) + clamp(extra, [-limit, limit]);
    chances.set(t, Math.min(1, Math.max(0, p)));
  }
  // Mutations only: a higher Elite limit and a guaranteed minimum (BLOOD MOON).
  const eliteBonus = clamp(
    fromMutations.reduce((sum, m) => sum + (m.eliteMaxBonus ?? 0), 0),
    [0, rules.modifierClamp.eliteMaxBonus],
  );
  const elitesAllowed = eliteMax(wave, rules) + eliteBonus;
  const eliteMinimum = Math.min(
    elitesAllowed,
    clamp(
      fromMutations.reduce((most, m) => Math.max(most, m.eliteMinimum ?? 0), 0),
      [0, rules.modifierClamp.eliteMinimum],
    ),
  );
  let elites = 0;

  const spawns: WaveSpawn[] = [];
  const counts = new Map<ImplementedEnemyId, number>();
  let remaining = budget;

  const rollTraits = (): EnemyModifierId[] => {
    const traits: EnemyModifierId[] = [];
    for (const t of ENEMY_MODIFIER_IDS) {
      const p = chances.get(t) ?? 0;
      if (p > 0 && rng.chance(p) && (t !== 'elite' || elites < elitesAllowed)) {
        traits.push(t);
      }
    }
    return traits;
  };
  const add = (archetype: ImplementedEnemyId, withTraits: boolean): boolean => {
    let traits = withTraits ? rollTraits() : [];
    let cost = spawnCost(archetype, traits);
    if (cost > remaining + EPSILON && traits.length > 0) {
      traits = [];
      cost = spawnCost(archetype, traits);
    }
    if (cost > remaining + EPSILON) {
      return false;
    }
    if (traits.includes('elite')) {
      elites++;
    }
    if (extras.has(archetype)) {
      extrasLeft--;
    }
    spawns.push({ archetype, traits, cost });
    counts.set(archetype, (counts.get(archetype) ?? 0) + 1);
    remaining -= cost;
    return true;
  };
  const underCap = (a: ImplementedEnemyId) =>
    (counts.get(a) ?? 0) < (caps.get(a) ?? 0) && (!extras.has(a) || extrasLeft > 0);

  // 3. Guarantees.
  for (const a of candidates) {
    if (a !== 'walker' && !extras.has(a) && wave === rules.unlocks[a]) {
      add(a, false);
    }
  }
  if (finale) {
    for (const [a, min] of Object.entries(rules.finaleMinimum) as [ImplementedEnemyId, number][]) {
      while ((counts.get(a) ?? 0) < min && isUnlocked(a, wave, rules) && add(a, true)) {
        // placed
      }
    }
  }
  const walkerFloor = rules.minWalkerShare * budget;
  let walkerSpend = 0;
  while (walkerSpend < walkerFloor && remaining >= 1 - EPSILON) {
    const before = remaining;
    if (!add('walker', true)) {
      break;
    }
    walkerSpend += before - remaining;
  }

  // 4. Weighted fill; Walkers take whatever is left.
  for (;;) {
    let total = 0;
    const open: [ImplementedEnemyId, number][] = [];
    for (const [a, w] of weights) {
      if (underCap(a) && (baseCost.get(a) ?? Infinity) <= remaining + EPSILON) {
        open.push([a, w]);
        total += w;
      }
    }
    if (open.length === 0) {
      break;
    }
    let pick = rng.next() * total;
    let chosen = open[open.length - 1]?.[0] ?? 'walker';
    for (const [a, w] of open) {
      pick -= w;
      if (pick < 0) {
        chosen = a;
        break;
      }
    }
    if (!add(chosen, true)) {
      break;
    }
  }
  // A guaranteed Elite minimum: promote plain Walkers, making room by dropping others if needed
  // (the budget never grows for it).
  while (elites < eliteMinimum) {
    let index = spawns.findIndex((sp) => sp.archetype === 'walker' && !sp.traits.includes('elite'));
    const target = spawns[index];
    if (!target) {
      break;
    }
    const traits = normalizeTraits([...target.traits, 'elite']);
    const cost = spawnCost('walker', traits);
    const delta = cost - target.cost;
    while (remaining + EPSILON < delta) {
      const drop = spawns.findLastIndex(
        (sp, k) => k !== index && sp.archetype === 'walker' && sp.traits.length === 0,
      );
      const dropped = spawns[drop];
      if (!dropped) {
        break;
      }
      spawns.splice(drop, 1);
      counts.set('walker', (counts.get('walker') ?? 1) - 1);
      remaining += dropped.cost;
      if (drop < index) {
        index--;
      }
    }
    if (remaining + EPSILON < delta) {
      break;
    }
    spawns[index] = { archetype: 'walker', traits, cost };
    remaining -= delta;
    elites++;
  }
  while (remaining >= 1 - EPSILON && add('walker', false)) {
    // the remainder
  }

  // 5. Order: shuffled, heavy archetypes kept out of the opening.
  for (let i = spawns.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    const a = spawns[i];
    const b = spawns[j];
    if (a && b) {
      spawns[i] = b;
      spawns[j] = a;
    }
  }
  const opening = Math.ceil(spawns.length * rules.openingShare);
  const heavy = (s: WaveSpawn | undefined) =>
    s !== undefined && rules.openingExcluded.includes(s.archetype);
  for (let i = 0; i < opening; i++) {
    if (heavy(spawns[i])) {
      const j = spawns.findIndex((s, k) => k >= opening && !heavy(s));
      if (j < 0) {
        break;
      }
      const a = spawns[i];
      const b = spawns[j];
      if (a && b) {
        spawns[i] = b;
        spawns[j] = a;
      }
    }
  }

  const enemyComposition: Partial<Record<EnemyArchetypeId, number>> = {};
  for (const [a, c] of counts) {
    enemyComposition[a] = c;
  }
  const spawnBias = new Set<SpawnRegionId>();
  for (const m of modifiers) {
    for (const r of m.spawnBias ?? []) {
      spawnBias.add(r);
    }
  }
  const groupMax =
    waveGroupMax(wave, rules) + (theme === 'ambush' ? rules.groupSize.ambushBonus : 0);
  // Surges (mutations only, e.g. HIVE): bigger groups at set points of the queue, clamped.
  const surgeClamp = rules.modifierClamp.surges;
  const surgeRule = fromMutations.find((m) => m.surges)?.surges;
  const surges: WaveSurge[] = surgeRule
    ? [...surgeRule.at]
        .filter((at) => at > 0 && at < 1)
        .sort((a, b) => a - b)
        .slice(0, surgeClamp.count)
        .map((at) => ({
          at,
          size: Math.min(
            surgeClamp.groupSize,
            groupMax + clamp(surgeRule.extraGroupSize, [0, surgeClamp.extraGroupSize]),
          ),
          warning: clamp(surgeRule.warning, surgeClamp.warning),
        }))
    : [];
  return {
    waveNumber: wave,
    enemyBudget: budget,
    spawnRate: waveSpawnRate(wave, rules),
    enemyComposition,
    mutation: context.mutation ?? null,
    specialEvent: null,
    bossFlag: false,
    maxAlive: waveMaxAlive(wave, rules),
    tier,
    theme,
    finale,
    boss: null,
    spawns,
    budgetSpent: budget - remaining,
    groupSize: { min: 1, max: groupMax },
    spawnBias: [...spawnBias],
    modifiers,
    surges,
  };
}

/**
 * The composition modifier wave `n` gets from `mutation`'s spawn rules (none without one). Growth
 * fields (an Elite bonus that rises with the wave) are resolved for `n` here.
 */
export function mutationModifiers(mutation: MutationId | null, n: number): CompositionModifier[] {
  if (!mutation) {
    return [];
  }
  const wave = waveIndex(n);
  const out: CompositionModifier[] = [];
  for (const effect of MUTATIONS[mutation].effects) {
    if (effect.kind !== 'spawnRule') {
      continue;
    }
    const c = effect.composition ?? {};
    const growth =
      c.eliteMaxBonusEvery !== undefined && c.eliteMaxBonusEvery > 0
        ? Math.max(0, Math.floor((wave - (c.eliteMaxBonusFrom ?? wave)) / c.eliteMaxBonusEvery))
        : 0;
    out.push({
      source: 'mutation',
      ...(c.budgetMultiplier !== undefined ? { budgetMultiplier: c.budgetMultiplier } : {}),
      ...(c.traitChance ? { traitChance: c.traitChance } : {}),
      ...(c.archetypeWeights ? { archetypeWeights: c.archetypeWeights } : {}),
      ...(c.eliteMaxBonus !== undefined ? { eliteMaxBonus: c.eliteMaxBonus + growth } : {}),
      ...(c.eliteMinimum !== undefined ? { eliteMinimum: c.eliteMinimum } : {}),
      ...(effect.surges ? { surges: effect.surges } : {}),
    });
  }
  return out;
}
