/**
 * Adaptation shapes waves through composition only (D-026, D-047). Across every allowed pair of
 * adaptations at level 2, over many seeds and waves:
 * - everything that is not the mix is unchanged: budget, concurrency, pacing, groups, surges,
 *   mutation, tier, theme, Elite limits;
 * - the mix stays inside the generator's rules: unlocks, caps, the Climber's count and unlock,
 *   trait-free extras, the opening, no Elite from adaptation;
 * - adaptation never adds bodies on average, nor raises the most a wave can bring;
 * - a mutation is never selected, removed or changed by it, and the finale is untouched.
 */

import { describe, expect, it } from 'vitest';
import { composeModifiers } from '../adaptive/compose';
import type { ActiveAdaptation } from '../adaptive/types';
import { ADAPTATION_IDS, ADAPTATIONS } from '../config/adaptation';
import { DEFAULT_ROSTER, type ImplementedEnemyId } from '../config/enemies';
import { MUTATIONS, type MutationId } from '../config/mutations';
import {
  FINAL_WAVE,
  WAVE_RULES,
  type CompositionModifier,
  type WaveDefinition,
} from '../config/waves';
import { Rng } from '../utils/Rng';
import { mutationRng, selectMutation } from './WaveMutation';
import { generateWave } from './WaveGenerator';
import { eliteMax, isUnlocked, traitChance, waveCap } from './WaveDifficulty';

/** Every live adaptation variant at level 2. */
const SINGLES: ActiveAdaptation[] = ADAPTATION_IDS.filter((id) => !ADAPTATIONS[id].status).flatMap(
  (id) =>
    ADAPTATIONS[id].variants.map((v) => ({
      id,
      key: v.key,
      level: 2 as const,
      since: 5,
      levelSince: 5,
    })),
);

/** Every pair the director allows (different families). */
const PAIRS: ActiveAdaptation[][] = SINGLES.flatMap((a, i) =>
  SINGLES.slice(i + 1)
    .filter((b) => ADAPTATIONS[a.id].family !== ADAPTATIONS[b.id].family)
    .map((b) => [a, b]),
);

const label = (pair: readonly ActiveAdaptation[]) => pair.map((a) => `${a.id}/${a.key}`).join('+');
const count = (def: WaveDefinition, a: ImplementedEnemyId) =>
  def.spawns.filter((s) => s.archetype === a).length;

function sameOutsideTheMix(base: WaveDefinition, adapted: WaveDefinition, where: string): void {
  for (const key of [
    'waveNumber',
    'enemyBudget',
    'spawnRate',
    'maxAlive',
    'mutation',
    'tier',
    'theme',
    'finale',
    'groupSize',
    'surges',
    'bossFlag',
    'boss',
  ] as const) {
    expect(adapted[key], `${where}: ${key}`).toEqual(base[key]);
  }
}

describe('adaptation shapes the mix and nothing else (D-026, D-047)', () => {
  it(`${PAIRS.length} allowed pairs at level 2 × 500 seeds: only the mix changes, within the rules`, () => {
    expect(PAIRS.length).toBe(23);
    for (let s = 0; s < 500; s++) {
      const rng = new Rng(`adaptive-waves:${s}`);
      let wave = rng.int(5, 30);
      if (wave === FINAL_WAVE) {
        wave = 21;
      }
      const seed = `seed-${s}`;
      const mutation: MutationId | null = selectMutation(wave, [], mutationRng(seed, wave));
      const base = generateWave(wave, { seed, mutation });
      for (const pair of PAIRS) {
        const modifiers = composeModifiers(pair, { wave, dwellRegions: ['west', 'north', 'east'] });
        const def = generateWave(wave, { seed, mutation, modifiers });
        const where = `${seed} wave ${wave} ${label(pair)}`;
        sameOutsideTheMix(base, def, where);
        // The budget is spent the same way: within one point, never over.
        const spent = def.spawns.reduce((sum, sp) => sum + sp.cost, 0);
        expect(def.enemyBudget - spent, where).toBeGreaterThan(-1e-9);
        expect(def.enemyBudget - spent, where).toBeLessThan(1);
        // Unlocks and caps of the roster archetypes.
        for (const a of DEFAULT_ROSTER) {
          if (!isUnlocked(a, wave)) {
            expect(count(def, a), `${where}: ${a} locked`).toBe(0);
          } else if (a !== 'walker') {
            expect(count(def, a), `${where}: ${a} cap`).toBeLessThanOrEqual(waveCap(a, wave));
          }
        }
        // The Climber: only from wave 8, at most the extras cap, trait-free, never in the opening.
        const climbers = def.spawns
          .map((sp, i) => ({ sp, i }))
          .filter(({ sp }) => sp.archetype === 'climber');
        expect(climbers.length, where).toBeLessThanOrEqual(WAVE_RULES.extraArchetypeMax);
        if (wave < (WAVE_RULES.adaptiveUnlocks.climber ?? 8)) {
          expect(climbers.length, where).toBe(0);
        }
        const opening = Math.ceil(def.spawns.length * WAVE_RULES.openingShare);
        for (const { sp, i } of climbers) {
          expect(sp.traits, where).toEqual([]);
          if (def.spawns.slice(opening).some((x) => x.archetype === 'walker')) {
            expect(i, `${where}: climber in the opening`).toBeGreaterThanOrEqual(opening);
          }
        }
        // Elites: never more than the wave allows (adaptation adds no Elite chance).
        const elites = def.spawns.filter((sp) => sp.traits.includes('elite')).length;
        const bonus = mutation
          ? (base.modifiers.find((m) => m.eliteMaxBonus)?.eliteMaxBonus ?? 0)
          : 0;
        expect(elites, where).toBeLessThanOrEqual(eliteMax(wave) + bonus);
        // The mutation's own modifiers are carried untouched.
        expect(
          def.modifiers.filter((m) => m.source === 'mutation'),
          where,
        ).toEqual(base.modifiers.filter((m) => m.source === 'mutation'));
      }
    }
  });

  // D-048: quotas buy dearer enemies (Tanks, Runners, armour) out of the same budget, so a wave may
  // have fewer bodies, never more.
  it('never more bodies: the mean count stays within ×0.7–1.1 and the most within ×1.1', () => {
    for (const wave of [5, 8, 10, 12, 15, 19, 25, 30]) {
      const seeds = Array.from({ length: 150 }, (_, i) => `s${i}`);
      const baseCounts = seeds.map((seed) => generateWave(wave, { seed }).spawns.length);
      const baseMean = baseCounts.reduce((a, b) => a + b, 0) / seeds.length;
      const baseMax = Math.max(...baseCounts);
      for (const pair of PAIRS) {
        const modifiers = composeModifiers(pair, { wave, dwellRegions: ['west'] });
        const counts = seeds.map((seed) => generateWave(wave, { seed, modifiers }).spawns.length);
        const mean = counts.reduce((a, b) => a + b, 0) / seeds.length;
        expect(mean / baseMean, `wave ${wave} ${label(pair)}`).toBeGreaterThanOrEqual(0.7);
        expect(mean / baseMean, `wave ${wave} ${label(pair)}`).toBeLessThanOrEqual(1.1);
        expect(Math.max(...counts), `wave ${wave} ${label(pair)}`).toBeLessThanOrEqual(
          Math.ceil(baseMax * 1.1),
        );
      }
    }
  });

  it('the adaptive source cannot reach what a mutation owns, nor past its own clamps', () => {
    const rogue = {
      source: 'adaptive',
      budgetMultiplier: 1.5,
      eliteMaxBonus: 3,
      eliteMinimum: 2,
      surges: { at: [0.5], extraGroupSize: 2, warning: 2 },
      traitChance: { elite: 0.5, armored: 0.5, helmeted: 0.5 },
      archetypeWeights: { runner: 10, tank: 10 },
      spawnBias: ['west', 'north', 'east', 'south'],
    } as unknown as CompositionModifier;
    for (const seed of ['a', 'b', 'c', 'd']) {
      const base = generateWave(16, { seed });
      const def = generateWave(16, { seed, modifiers: [rogue] });
      sameOutsideTheMix(base, def, seed);
      expect(def.spawnBias).toEqual(['west', 'north']);
      expect(def.spawns.filter((s) => s.traits.includes('elite')).length).toBeLessThanOrEqual(
        eliteMax(16),
      );
    }
    // Its trait chance totals at most +0.15 (and none before the schedule): over many enemies.
    let armored = 0;
    let total = 0;
    let early = 0;
    for (let i = 0; i < 200; i++) {
      const def = generateWave(12, { seed: `t${i}`, modifiers: [rogue] });
      armored += def.spawns.filter((s) => s.traits.includes('armored')).length;
      total += def.spawns.length;
      early += generateWave(7, { seed: `t${i}`, modifiers: [rogue] }).spawns.filter(
        (s) => s.traits.length > 0,
      ).length;
    }
    // Schedule at wave 12: 0.2; plus at most half of +0.15 (shared with Helmeted).
    expect(armored / total).toBeLessThan(0.2 + 0.075 + 0.03);
    expect(early).toBe(0);
  });

  it('the adaptive clamp is its own: an over-weight is exactly the clamp; ignored fields change nothing', () => {
    const [, hi] = WAVE_RULES.modifierClamp.adaptive.weight;
    for (let i = 0; i < 60; i++) {
      const seed = `exact-${i}`;
      const n = 10 + (i % 15);
      const over = generateWave(n, {
        seed,
        modifiers: [{ source: 'adaptive', archetypeWeights: { runner: 10 } }],
      });
      const atCap = generateWave(n, {
        seed,
        modifiers: [{ source: 'adaptive', archetypeWeights: { runner: hi } }],
      });
      expect(over.spawns, `${seed} wave ${n}`).toEqual(atCap.spawns);
      // An Elite chance, a budget, Elite limits or surges from the adaptive source: no effect at all.
      const plain = generateWave(n, { seed });
      const ignored = generateWave(n, {
        seed,
        modifiers: [
          {
            source: 'adaptive',
            traitChance: { elite: 0.5 },
            budgetMultiplier: 1.5,
            eliteMaxBonus: 3,
            eliteMinimum: 2,
          },
        ],
      });
      expect(ignored.spawns, `${seed} wave ${n}`).toEqual(plain.spawns);
      expect(ignored.surges).toEqual(plain.surges);
    }
  });

  it('the final wave ignores adaptation entirely', () => {
    for (const seed of ['a', 'b', 'c']) {
      const modifiers = composeModifiers(PAIRS[0] ?? [], { wave: 19, dwellRegions: ['west'] });
      const plain = generateWave(FINAL_WAVE, { seed });
      expect(generateWave(FINAL_WAVE, { seed, modifiers })).toEqual({ ...plain });
    }
  });

  it('mutation selection never depends on adaptation (a separate stream and history)', () => {
    for (let s = 0; s < 200; s++) {
      const seed = `m${s}`;
      const history: MutationId[] = [];
      for (let wave = 1; wave <= 30; wave++) {
        const picked = selectMutation(wave, history, mutationRng(seed, wave));
        const modifiers = composeModifiers(SINGLES.slice(0, 2), { wave, dwellRegions: ['west'] });
        const def = generateWave(wave, { seed, mutation: picked, modifiers });
        expect(def.mutation).toBe(picked);
        if (picked) {
          history.push(picked);
          expect(MUTATIONS[picked].status).toBe('enabled');
        }
      }
    }
  });
});

describe('D-048: every adaptation leaves its signature on every wave it may act on', () => {
  /** Every live variant at each level its adaptation allows. */
  const LEVELS: ActiveAdaptation[] = ADAPTATION_IDS.filter((id) => !ADAPTATIONS[id].status).flatMap(
    (id) =>
      ADAPTATIONS[id].variants.flatMap((v) =>
        ([1, 2] as const)
          .filter((level) => level <= (ADAPTATIONS[id].maxLevel ?? 2))
          .map((level) => ({ id, key: v.key, level, since: 5, levelSince: 5 })),
      ),
  );
  const spend = (def: WaveDefinition, a: ImplementedEnemyId) =>
    def.spawns.reduce((sum, s) => sum + (s.archetype === a ? s.cost : 0), 0);
  const capOf = (a: ImplementedEnemyId, wave: number) => waveCap(a, wave, WAVE_RULES);

  it('quotas hold on every seed: the share, the cap, the trait share, the Climbers; never a no-op', () => {
    for (const a of LEVELS) {
      const config = ADAPTATIONS[a.id];
      const variant = config.variants.find((v) => v.key === a.key);
      const from = Math.max(variant?.firstWave ?? config.firstWave, config.firstWave);
      for (let wave = from; wave <= 30; wave++) {
        if (wave === FINAL_WAVE) {
          continue;
        }
        const modifiers = composeModifiers([a], { wave, dwellRegions: ['west'] });
        const m = modifiers[0];
        const where = `${a.id}/${a.key} L${a.level} wave ${wave}`;
        expect(m, where).toBeDefined();
        for (let s = 0; s < 40; s++) {
          const seed = `sig-${s}`;
          const base = generateWave(wave, { seed });
          const def = generateWave(wave, { seed, modifiers });
          // Never a silent no-op: the wave differs from the unadapted one.
          expect(
            JSON.stringify(def.spawns) !== JSON.stringify(base.spawns) ||
              def.spawnBias.join() !== base.spawnBias.join(),
            `${where} ${seed}`,
          ).toBe(true);
          for (const [id, share] of Object.entries(m?.archetypeShares ?? {}) as [
            ImplementedEnemyId,
            number,
          ][]) {
            if (!isUnlocked(id, wave, WAVE_RULES)) {
              continue;
            }
            const capped = count(def, id) >= capOf(id, wave);
            expect(
              capped || spend(def, id) >= share * def.enemyBudget - 1e-6,
              `${where} ${seed}: ${id} quota ${share}`,
            ).toBe(true);
          }
          for (const [t, extra] of Object.entries(m?.traitShares ?? {}) as [
            'armored' | 'helmeted',
            number,
          ][]) {
            const eligible = def.spawns.filter((sp) => sp.archetype !== 'climber');
            const have = eligible.filter((sp) => sp.traits.includes(t)).length;
            // A running quota on top of the rolls: at least that share carries it (within one
            // enemy: the last points may not pay for it), and never less than the schedule.
            expect(have, `${where} ${seed}: ${t}`).toBeGreaterThanOrEqual(
              Math.ceil(extra * eligible.length - 1e-9) - 1,
            );
            const baseEligible = base.spawns.filter((sp) => sp.archetype !== 'climber');
            const baseHave = baseEligible.filter((sp) => sp.traits.includes(t)).length;
            expect(have / eligible.length, `${where} ${seed}: ${t} share`).toBeGreaterThanOrEqual(
              Math.min(baseHave / baseEligible.length, traitChance(t, wave)),
            );
          }
          if (m?.extraCounts?.climber) {
            expect(count(def, 'climber'), where).toBe(m.extraCounts.climber);
          }
          // The budget is the same, spent within one point.
          expect(def.enemyBudget).toBe(base.enemyBudget);
          expect(def.budgetSpent).toBeLessThanOrEqual(def.enemyBudget + 1e-6);
          expect(def.budgetSpent).toBeGreaterThan(def.enemyBudget - 1);
        }
      }
    }
  });

  it('quotas are clamped and only ever honoured from the adaptive source', () => {
    const greedy: CompositionModifier = {
      source: 'adaptive',
      archetypeShares: { runner: 0.9, tank: 0.9, spitter: 0.9 },
      traitShares: { helmeted: 0.9, armored: 0.9 },
    };
    const clamp = WAVE_RULES.modifierClamp.adaptive;
    for (const seed of ['q1', 'q2', 'q3', 'q4']) {
      const def = generateWave(15, { seed, modifiers: [greedy] });
      // Total quota at most shareTotal of the budget (+ one enemy's overshoot each), and the Walker
      // floor still holds; caps hold.
      expect(spend(def, 'walker')).toBeGreaterThanOrEqual(
        WAVE_RULES.minWalkerShare * def.enemyBudget,
      );
      expect(count(def, 'tank')).toBeLessThanOrEqual(capOf('tank', 15));
      expect(count(def, 'spitter')).toBeLessThanOrEqual(capOf('spitter', 15));
      const eligible = def.spawns.length;
      const traitTotal = def.spawns.filter((sp) => sp.traits.length > 0).length / eligible;
      expect(traitTotal).toBeLessThanOrEqual(
        traitChance('armored', 15) + traitChance('helmeted', 15) + clamp.traitShareTotal + 0.35,
      );
      // From any other source a quota is ignored.
      for (const source of ['mutation', 'debug'] as const) {
        expect(generateWave(15, { seed, modifiers: [{ ...greedy, source }] }).spawns).toEqual(
          generateWave(15, { seed }).spawns,
        );
      }
    }
  });
});
