/**
 * Mutations shaping waves through the generator (D-045): HIVE's clamped extra budget and surges,
 * BLOOD MOON's Elites within the same budget, and every other mutation leaving the composition
 * untouched. No mutation changes concurrency, pacing, the roster (never the Climber) or the
 * budget beyond its clamp.
 */

import { describe, expect, it } from 'vitest';
import { applyTraits } from '../config/traits';
import { ENEMY_STATS } from '../config/enemies';
import { ENABLED_MUTATION_IDS, MUTATIONS } from '../config/mutations';
import { DEFAULT_ROSTER } from '../config/enemies';
import { WAVE_RULES } from '../config/waves';
import { eliteMax, waveBudget, waveGroupMax } from './WaveDifficulty';
import { generateWave, mutationModifiers } from './WaveGenerator';

const SEEDS = Array.from({ length: 20 }, (_, i) => `mut-${i}`);
const WAVES = [4, 5, 6, 7, 8, 9, 10, 12, 14, 16, 19, 21, 25, 30, 40];
const elitesOf = (spawns: readonly { traits: readonly string[] }[]) =>
  spawns.filter((s) => s.traits.includes('elite')).length;

describe('mutations in the generator: invariants for every v1 mutation', () => {
  it('concurrency, pacing, roster and spend stay within the rules; the budget only for HIVE', () => {
    for (const id of ENABLED_MUTATION_IDS) {
      for (const seed of SEEDS.slice(0, 8)) {
        for (const n of WAVES.filter((w) => w >= MUTATIONS[id].minWave)) {
          const plain = generateWave(n, { seed });
          const def = generateWave(n, { seed, mutation: id });
          const where = `${id} ${seed} wave ${n}`;
          expect(def.mutation, where).toBe(id);
          expect(def.maxAlive, where).toBe(plain.maxAlive);
          expect(def.spawnRate, where).toBe(plain.spawnRate);
          expect(def.groupSize, where).toEqual(plain.groupSize);
          expect(
            def.spawns.every((s) => DEFAULT_ROSTER.includes(s.archetype)),
            where,
          ).toBe(true);
          const expectedBudget = id === 'HIVE' ? Math.round(waveBudget(n) * 1.3) : waveBudget(n);
          expect(def.enemyBudget, where).toBe(expectedBudget);
          expect(def.enemyBudget / waveBudget(n), where).toBeLessThanOrEqual(
            WAVE_RULES.modifierClamp.budget[1] + 0.05,
          );
          const spent = def.spawns.reduce((sum, s) => sum + s.cost, 0);
          expect(def.enemyBudget - spent, where).toBeGreaterThan(-1e-9);
          expect(def.enemyBudget - spent, where).toBeLessThan(1);
          for (const s of def.spawns) {
            expect(s.cost, where).toBeCloseTo(
              applyTraits(ENEMY_STATS[s.archetype], s.traits).threatCost,
              9,
            );
          }
        }
      }
    }
  });

  it('mutations without spawn rules leave the wave exactly as it was', () => {
    for (const id of ['BLACKOUT', 'HUNGER', 'STATIC', 'SCREAM'] as const) {
      expect(mutationModifiers(id, 10)).toEqual([]);
      for (const seed of SEEDS.slice(0, 5)) {
        for (const n of [6, 11, 17, 24]) {
          expect(generateWave(n, { seed, mutation: id }).spawns).toEqual(
            generateWave(n, { seed }).spawns,
          );
        }
      }
    }
    expect(mutationModifiers(null, 10)).toEqual([]);
  });
});

describe('HIVE: a bigger wave that surges in', () => {
  it('two surges at 40 % and 75 % of the queue, groups up to the wave’s largest + 2 (≤ 6)', () => {
    for (const n of [7, 10, 15, 19, 30]) {
      const def = generateWave(n, { seed: 'hive', mutation: 'HIVE' });
      const groupMax = def.groupSize.max;
      expect(def.surges.map((s) => s.at)).toEqual([0.4, 0.75]);
      for (const s of def.surges) {
        expect(s.size).toBe(Math.min(6, groupMax + 2));
        expect(s.size).toBeLessThanOrEqual(WAVE_RULES.modifierClamp.surges.groupSize);
        expect(s.warning).toBe(2);
      }
      expect(groupMax).toBeGreaterThanOrEqual(waveGroupMax(n));
    }
    expect(generateWave(10, { seed: 'hive' }).surges).toEqual([]);
  });

  it('surges and Elite rules from any other source are ignored; the mutation’s are clamped', () => {
    const adaptive = generateWave(12, {
      seed: 's',
      modifiers: [
        {
          source: 'adaptive',
          surges: { at: [0.5], extraGroupSize: 2, warning: 2 },
          eliteMinimum: 2,
          eliteMaxBonus: 3,
        },
      ],
    });
    expect(adaptive.surges).toEqual([]);
    expect(elitesOf(adaptive.spawns)).toBe(0); // wave 12: no Elites without BLOOD MOON
    const wild = generateWave(12, {
      seed: 's',
      modifiers: [
        {
          source: 'mutation',
          surges: { at: [0.1, 0.2, 0.3, 0.4, 0.5], extraGroupSize: 9, warning: 30 },
        },
      ],
    });
    expect(wild.surges).toHaveLength(WAVE_RULES.modifierClamp.surges.count);
    for (const s of wild.surges) {
      expect(s.size).toBeLessThanOrEqual(WAVE_RULES.modifierClamp.surges.groupSize);
      expect(s.warning).toBe(WAVE_RULES.modifierClamp.surges.warning[1]);
    }
  });
});

describe('BLOOD MOON: Elites, within the same budget', () => {
  it('always at least one Elite, never more than the raised limit, the budget unchanged', () => {
    for (const seed of SEEDS) {
      for (const n of [9, 10, 11, 12, 13, 15, 18, 19, 24, 33]) {
        const def = generateWave(n, { seed, mutation: 'BLOOD_MOON' });
        const bonus = Math.min(3, 1 + Math.floor((n - 9) / 5));
        const elites = elitesOf(def.spawns);
        expect(elites, `${seed} wave ${n}`).toBeGreaterThanOrEqual(1);
        expect(elites, `${seed} wave ${n}`).toBeLessThanOrEqual(eliteMax(n) + bonus);
        expect(def.enemyBudget).toBe(waveBudget(n));
      }
    }
  });

  it('brings Elites before wave 13, where none appear otherwise; more of them later', () => {
    let early = 0;
    let plainEarly = 0;
    let late = 0;
    let plainLate = 0;
    for (const seed of SEEDS) {
      for (const n of [9, 10, 11, 12]) {
        early += elitesOf(generateWave(n, { seed, mutation: 'BLOOD_MOON' }).spawns);
        plainEarly += elitesOf(generateWave(n, { seed }).spawns);
      }
      for (const n of [15, 17, 19]) {
        late += elitesOf(generateWave(n, { seed, mutation: 'BLOOD_MOON' }).spawns);
        plainLate += elitesOf(generateWave(n, { seed }).spawns);
      }
    }
    expect(plainEarly).toBe(0);
    expect(early).toBeGreaterThanOrEqual(SEEDS.length * 4);
    expect(late).toBeGreaterThan(plainLate * 1.5);
  });

  it('the Elite bonus grows with the wave and stops at the clamp', () => {
    const bonus = (n: number) =>
      mutationModifiers('BLOOD_MOON', n).reduce((s, m) => s + (m.eliteMaxBonus ?? 0), 0);
    expect([9, 13, 14, 19, 24, 40].map(bonus)).toEqual([1, 1, 2, 3, 4, 7]);
    // The generator clamps the total at +3 whatever the data grows to.
    for (const seed of SEEDS.slice(0, 5)) {
      const def = generateWave(40, { seed, mutation: 'BLOOD_MOON' });
      expect(elitesOf(def.spawns)).toBeLessThanOrEqual(eliteMax(40) + 3);
    }
  });
});

describe('determinism', () => {
  it('the same seed, wave and mutation give the same wave', () => {
    for (const id of ENABLED_MUTATION_IDS) {
      expect(generateWave(14, { seed: 'd', mutation: id })).toEqual(
        generateWave(14, { seed: 'd', mutation: id }),
      );
    }
  });
});
