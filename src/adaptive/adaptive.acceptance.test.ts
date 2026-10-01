/**
 * Phase 8.1 acceptance (D-048): an adaptation the horde announces is in the next wave, visibly.
 *
 * The full headless game (wired as `main.ts`), one wave played to its end, every spawn recorded:
 *
 *   forced adaptation → frozen modifiers → WaveManager → generateWave → definition → spawned
 *
 * For each tested adaptation and level, on the waves where it acts: the preview (`explainWave`)
 * equals the generated definition, which equals what actually spawned; and the wave differs from
 * the same wave without adaptation (same seed, same mutation) by the adaptation's signature, on
 * every seed (responses are quotas, not odds). Adaptive OFF gives exactly the unadapted wave; the
 * budget and the mutation are the same either way; the same seed and play give the same spawns.
 */

import { describe, expect, it } from 'vitest';
import { ADAPTATIONS, type AdaptationId } from '../config/adaptation';
import { ENEMY_STATS, type ImplementedEnemyId } from '../config/enemies';
import { WAVE_RULES, type CompositionModifier } from '../config/waves';
import { traitChance, waveCap } from '../waves/WaveDifficulty';
import { explainWave, makeupOf, type WaveMakeup } from './inspect';
import { headlessGame } from './testGame';

interface Forced {
  readonly id: AdaptationId;
  readonly key: string;
  readonly level: 1 | 2;
}

interface Played {
  readonly definition: WaveMakeup;
  readonly spawns: string[];
  readonly spawned: { composition: Record<string, number>; traits: Record<string, number> };
  readonly tally: { composition: Record<string, number>; traits: Record<string, number> };
  readonly budget: number;
  readonly mutation: string | null;
  readonly mutationLog: string;
  readonly modifiers: readonly CompositionModifier[];
  readonly explanation: ReturnType<typeof explainWave>;
}

/**
 * Starts a run, forces `forced` for wave `n`, starts wave `n` (no mutation, or the normal draw with
 * `drawMutation`) and plays it to the end, killing wave enemies as they come.
 */
function playWave(
  seed: string,
  n: number,
  forced: readonly Forced[],
  {
    adaptive = true,
    enabled = true,
    drawMutation = false,
  }: { adaptive?: boolean; enabled?: boolean; drawMutation?: boolean } = {},
): Played {
  const g = headlessGame(seed, { adaptive });
  g.playerHealth.godMode = true;
  g.startRun();
  g.adaptive.setEnabled(enabled);
  for (const f of forced) {
    g.adaptive.force(f.id, f.level, f.key, n);
  }
  const composition: Record<string, number> = {};
  const traits: Record<string, number> = {};
  const order: string[] = [];
  g.waves.events.on('enemySpawned', (e) => {
    composition[e.archetype] = (composition[e.archetype] ?? 0) + 1;
    for (const t of e.traits) {
      traits[t] = (traits[t] ?? 0) + 1;
    }
    order.push([e.archetype, ...e.traits].join('+'));
  });
  g.waves.startWave(n, drawMutation ? undefined : 'none');
  g.until(() => g.game.state.current === 'WAVE_ACTIVE', 10);
  const def = g.waves.definition;
  if (!def) {
    throw new Error('no wave generated');
  }
  const explanation = explainWave({
    wave: n,
    seed: g.waves.seed,
    mutation: def.mutation,
    active: adaptive && enabled ? g.adaptive.snapshot.state.active : [],
    dwellRegions: g.adaptive.dwellRegions,
  });
  let steps = 0;
  g.until(() => {
    if (++steps % 120 === 0) {
      g.killWave();
    }
    return g.game.state.current !== 'WAVE_ACTIVE';
  }, 600);
  const status = g.waves.status;
  return {
    definition: makeupOf(def),
    spawns: order,
    spawned: { composition, traits },
    tally: {
      composition: { ...status.spawnedComposition },
      traits: { ...status.spawnedTraits },
    },
    budget: def.enemyBudget,
    mutation: def.mutation,
    mutationLog: JSON.stringify(g.waves.mutations),
    modifiers: g.adaptive.modifiers(n),
    explanation,
  };
}

const count = (m: WaveMakeup, a: ImplementedEnemyId) => m.composition[a] ?? 0;
const traitCount = (m: WaveMakeup, t: 'armored' | 'helmeted') => m.traits[t] ?? 0;
/** Spawns that can carry a trait (adaptive extras never do). */
const eligible = (m: WaveMakeup) => m.total - count(m, 'climber');

/** The signature each adaptation must leave on the wave, against the unadapted reference. */
/** Threat spent on an archetype at its base cost (what the quota counts). */
const spend = (m: WaveMakeup, a: ImplementedEnemyId) => count(m, a) * ENEMY_STATS[a].threatCost;
/** The budget share an adaptation's level asks for an archetype. */
const quota = (f: Forced, a: ImplementedEnemyId) =>
  ADAPTATIONS[f.id].variants.find((v) => v.key === f.key)?.levels[f.level - 1]?.share?.[a] ?? 0;

function signature(
  f: Forced,
  wave: number,
  adapted: WaveMakeup,
  reference: WaveMakeup,
  budget: number,
): void {
  const where = `${f.id}${f.key === 'default' ? '' : `:${f.key}`} L${f.level} wave ${wave}`;
  const cap = (a: ImplementedEnemyId) => waveCap(a, wave, WAVE_RULES);
  switch (f.id) {
    case 'HIGH_GROUND':
      expect(count(adapted, 'climber'), where).toBe(f.level);
      expect(count(reference, 'climber'), where).toBe(0);
      break;
    case 'SKIRMISHER':
      expect(spend(adapted, 'runner'), where).toBeGreaterThanOrEqual(quota(f, 'runner') * budget);
      expect(count(adapted, 'runner'), where).toBeGreaterThan(count(reference, 'runner'));
      break;
    case 'CLOSE_QUARTERS':
      expect(count(adapted, 'tank'), where).toBe(cap('tank'));
      expect(traitCount(adapted, 'armored'), where).toBeGreaterThanOrEqual(
        Math.max(2 * traitCount(reference, 'armored'), traitCount(reference, 'armored') + 2),
      );
      break;
    case 'LONG_RANGE':
      expect(spend(adapted, 'runner'), where).toBeGreaterThanOrEqual(quota(f, 'runner') * budget);
      expect(count(adapted, 'runner'), where).toBeGreaterThan(count(reference, 'runner'));
      if (f.level === 2) {
        expect(count(adapted, 'screamer'), where).toBe(cap('screamer'));
      }
      break;
    case 'NEGLECT': {
      const subject = f.key as ImplementedEnemyId;
      expect(count(adapted, subject), where).toBe(cap(subject));
      expect(count(adapted, subject), where).toBeGreaterThanOrEqual(count(reference, subject));
      break;
    }
    case 'HEADHUNTER': {
      expect(traitCount(adapted, 'helmeted'), where).toBeGreaterThanOrEqual(
        traitCount(reference, 'helmeted') + 2,
      );
      const response = ADAPTATIONS.HEADHUNTER.variants[0]?.levels[f.level - 1];
      const extra = response?.traitShare?.helmeted ?? 0;
      // A running quota on top of the scheduled rolls: that share at least (within one enemy).
      expect(traitCount(adapted, 'helmeted'), where).toBeGreaterThanOrEqual(
        Math.ceil(extra * eligible(adapted) - 1e-9) - 1,
      );
      expect(traitCount(adapted, 'helmeted') / eligible(adapted), where).toBeGreaterThan(
        traitChance('helmeted', wave, WAVE_RULES),
      );
      break;
    }
    default:
      throw new Error(`no signature for ${f.id}`);
  }
}

/** Each tested adaptation, its levels and the waves it is checked on. */
const CASES: readonly {
  forced: Omit<Forced, 'level'>;
  levels: readonly (1 | 2)[];
  waves: readonly number[];
}[] = [
  { forced: { id: 'HIGH_GROUND', key: 'default' }, levels: [1, 2], waves: [8, 12] },
  { forced: { id: 'SKIRMISHER', key: 'default' }, levels: [1, 2], waves: [8, 12] },
  { forced: { id: 'CLOSE_QUARTERS', key: 'default' }, levels: [1, 2], waves: [8, 12] },
  { forced: { id: 'LONG_RANGE', key: 'default' }, levels: [1, 2], waves: [8, 12] },
  { forced: { id: 'NEGLECT', key: 'screamer' }, levels: [1], waves: [9, 12] },
  { forced: { id: 'NEGLECT', key: 'spitter' }, levels: [1], waves: [12, 15] },
  { forced: { id: 'HEADHUNTER', key: 'default' }, levels: [1, 2], waves: [8, 12] },
];

const SEED = 'acceptance';

describe('Phase 8.1 acceptance: the announced adaptation is in the next wave', () => {
  for (const { forced, levels, waves } of CASES) {
    for (const level of levels) {
      const f: Forced = { ...forced, level };
      const label = `${f.id}${f.key === 'default' ? '' : `:${f.key}`} L${level}`;
      it(`${label}: preview = generated = spawned, and visibly different from the unadapted wave`, () => {
        for (const wave of waves) {
          const adapted = playWave(SEED, wave, [f]);
          const plain = playWave(SEED, wave, [], { adaptive: false });
          // The pipeline, end to end: preview → definition → what really spawned.
          expect(adapted.explanation.adapted, `${label} w${wave} preview`).toEqual(
            adapted.definition,
          );
          expect(adapted.spawned.composition, `${label} w${wave} spawned`).toEqual(
            adapted.definition.composition,
          );
          expect(adapted.spawned.traits, `${label} w${wave} traits`).toEqual(
            adapted.definition.traits,
          );
          expect(adapted.tally, `${label} w${wave} WaveManager tally`).toEqual(adapted.spawned);
          // The reference is exactly the game without adaptation.
          expect(adapted.explanation.reference, `${label} w${wave} reference`).toEqual(
            plain.definition,
          );
          // The adaptation, and only the adaptation, changed it.
          expect(adapted.explanation.perAdaptation[0]?.affected, label).toBe(true);
          signature(f, wave, adapted.definition, plain.definition, adapted.budget);
          // Same budget and mutation; spent within 1 of the budget either way.
          expect(adapted.budget).toBe(plain.budget);
          expect(adapted.mutation).toBe(plain.mutation);
          expect(adapted.definition.spent).toBeGreaterThan(adapted.budget - 1);
          expect(adapted.definition.spent).toBeLessThanOrEqual(adapted.budget + 1e-6);
          // No mutation field ever comes from adaptation.
          for (const m of adapted.modifiers) {
            expect(m.source).toBe('adaptive');
            for (const key of ['budgetMultiplier', 'surges', 'eliteMaxBonus', 'eliteMinimum']) {
              expect(m, key).not.toHaveProperty(key);
            }
          }
        }
      }, 120_000);
    }
  }

  it('adaptive OFF: an adaptation forced but switched off gives exactly the unadapted wave', () => {
    const off = playWave(SEED, 12, [{ id: 'SKIRMISHER', key: 'default', level: 2 }], {
      enabled: false,
    });
    const plain = playWave(SEED, 12, [], { adaptive: false });
    expect(off.modifiers).toEqual([]);
    expect(off.definition).toEqual(plain.definition);
    expect(off.spawns).toEqual(plain.spawns);
  }, 60_000);

  it('deterministic: the same seed and the same adaptation spawn the same wave, in order', () => {
    const forced: Forced[] = [
      { id: 'HIGH_GROUND', key: 'default', level: 2 },
      { id: 'HEADHUNTER', key: 'default', level: 2 },
    ];
    const a = playWave(SEED, 12, forced);
    const b = playWave(SEED, 12, forced);
    expect(a.spawns).toEqual(b.spawns);
    expect(a.definition).toEqual(b.definition);
  }, 60_000);

  it('the mutation drawn for a wave and the run’s mutation log are the same with or without adaptation', () => {
    for (const wave of [8, 12]) {
      const adapted = playWave(SEED, wave, [{ id: 'SKIRMISHER', key: 'default', level: 2 }], {
        drawMutation: true,
      });
      const plain = playWave(SEED, wave, [], { adaptive: false, drawMutation: true });
      expect(adapted.mutation).not.toBeNull();
      expect(adapted.mutation).toBe(plain.mutation);
      expect(adapted.mutationLog).toBe(plain.mutationLog);
      expect(adapted.budget).toBe(plain.budget);
    }
  }, 60_000);
});
