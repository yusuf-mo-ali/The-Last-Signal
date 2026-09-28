/**
 * The wave generator (D-044): deterministic, budget-exact, roster-only (never the Climber),
 * unlocks, caps, guarantees, traits, themes, and the modifier channel future systems plug into.
 * Property tests sweep waves 1–200 over many seeds.
 */

import { describe, expect, it } from 'vitest';
import { DEFAULT_ROSTER, type ImplementedEnemyId } from '../config/enemies';
import { FINAL_WAVE, WAVE_RULES, type WaveDefinition } from '../config/waves';
import { generateWave, spawnCost, waveTheme } from './WaveGenerator';
import { eliteMax, waveBudget, waveCap } from './WaveDifficulty';

const SEEDS = Array.from({ length: 30 }, (_, i) => `seed-${i}`);
const WAVES = [...Array.from({ length: 40 }, (_, i) => i + 1), 50, 75, 100, 150, 200];

function count(def: WaveDefinition, archetype: ImplementedEnemyId): number {
  return def.spawns.filter((s) => s.archetype === archetype).length;
}

function* allWaves(): Generator<[string, number, WaveDefinition]> {
  for (const seed of SEEDS) {
    for (const n of WAVES) {
      yield [seed, n, generateWave(n, { seed })];
    }
  }
}

describe('wave generator: properties over waves 1–200 × 30 seeds', () => {
  it('spends its budget to within one threat point, never over', () => {
    for (const [seed, n, def] of allWaves()) {
      const spent = def.spawns.reduce((sum, s) => sum + s.cost, 0);
      expect(spent, `${seed} wave ${n}`).toBeCloseTo(def.budgetSpent, 9);
      expect(def.enemyBudget - spent, `${seed} wave ${n}`).toBeGreaterThan(-1e-9);
      expect(def.enemyBudget - spent, `${seed} wave ${n}`).toBeLessThan(1);
      expect(def.enemyBudget).toBe(waveBudget(n));
    }
  });

  it('only the default roster ever appears: never the Climber', () => {
    for (const [seed, n, def] of allWaves()) {
      for (const s of def.spawns) {
        expect(DEFAULT_ROSTER, `${seed} wave ${n}`).toContain(s.archetype);
      }
      expect(def.enemyComposition.climber).toBeUndefined();
    }
  });

  it('respects unlocks and caps, and introduces each archetype with exactly one', () => {
    for (const [seed, n, def] of allWaves()) {
      for (const a of DEFAULT_ROSTER) {
        const c = count(def, a);
        expect(c, `${seed} wave ${n} ${a}`).toBeLessThanOrEqual(waveCap(a, n));
        if (a !== 'walker' && n === WAVE_RULES.unlocks[a]) {
          expect(c, `${seed} wave ${n} ${a} introduced`).toBe(1);
        }
      }
      if (n < 3) {
        expect(count(def, 'runner'), `${seed} wave ${n}`).toBe(0);
      }
    }
    const early = generateWave(2, { seed: 'x' });
    expect(early.spawns.every((s) => s.archetype === 'walker')).toBe(true);
    expect(count(generateWave(5, { seed: 'x' }), 'tank')).toBe(0);
  });

  it('Walkers are at least 30 % of the budget; the finale has its heavies', () => {
    for (const [seed, n, def] of allWaves()) {
      const walkers = def.spawns
        .filter((s) => s.archetype === 'walker')
        .reduce((sum, s) => sum + s.cost, 0);
      expect(walkers, `${seed} wave ${n}`).toBeGreaterThanOrEqual(
        WAVE_RULES.minWalkerShare * def.enemyBudget - 1e-9,
      );
      if (n === FINAL_WAVE) {
        expect(count(def, 'tank')).toBeGreaterThanOrEqual(2);
        expect(count(def, 'screamer')).toBeGreaterThanOrEqual(2);
        expect(def.finale).toBe(true);
      }
    }
  });

  it('traits: none before wave 8, no Elite before 13, never more Elites than allowed', () => {
    for (const [seed, n, def] of allWaves()) {
      const traits = def.spawns.flatMap((s) => s.traits);
      if (n < 8) {
        expect(traits, `${seed} wave ${n}`).toEqual([]);
      }
      const elites = traits.filter((t) => t === 'elite').length;
      expect(elites, `${seed} wave ${n}`).toBeLessThanOrEqual(eliteMax(n));
      if (n < 13) {
        expect(elites).toBe(0);
      }
      for (const s of def.spawns) {
        expect(s.cost).toBeCloseTo(spawnCost(s.archetype, s.traits), 9);
      }
    }
  });

  it('traits appear in the later waves, Elites included', () => {
    const late = SEEDS.flatMap((seed) =>
      [16, 17, 18, 19, 20].flatMap((n) => generateWave(n, { seed }).spawns),
    );
    const traits = late.flatMap((s) => s.traits);
    expect(traits).toContain('armored');
    expect(traits).toContain('helmeted');
    expect(traits).toContain('elite');
  });

  it('heavies are kept out of the opening; the counts match the spawn list', () => {
    for (const [seed, n, def] of allWaves()) {
      const opening = Math.ceil(def.spawns.length * WAVE_RULES.openingShare);
      const light = def.spawns.filter((s) => !WAVE_RULES.openingExcluded.includes(s.archetype));
      if (light.length >= opening) {
        for (const s of def.spawns.slice(0, opening)) {
          expect(WAVE_RULES.openingExcluded, `${seed} wave ${n}`).not.toContain(s.archetype);
        }
      }
      for (const a of DEFAULT_ROSTER) {
        expect(def.enemyComposition[a] ?? 0).toBe(count(def, a));
      }
    }
  });

  it('concurrency, pacing and slots: maxAlive capped, no mutation, boss or event in Phase 6', () => {
    for (const [, n, def] of allWaves()) {
      expect(def.maxAlive).toBeLessThanOrEqual(32);
      expect(def.maxAlive).toBeGreaterThanOrEqual(6);
      expect(def.spawnRate).toBeGreaterThan(0);
      expect(def.groupSize.min).toBe(1);
      expect(def.groupSize.max).toBeLessThanOrEqual(5);
      expect(def.mutation).toBeNull();
      expect(def.bossFlag).toBe(false);
      expect(def.boss).toBeNull();
      expect(def.specialEvent).toBeNull();
      expect(def.finale).toBe(n === FINAL_WAVE);
    }
  });
});

describe('wave generator: determinism and themes', () => {
  it('the same seed and wave give the same wave, in any generation order', () => {
    const a = generateWave(12, { seed: 'run' });
    generateWave(3, { seed: 'run' });
    const b = generateWave(12, { seed: 'run' });
    expect(b).toEqual(a);
    expect(generateWave(12, { seed: 'other' })).not.toEqual(a);
  });

  it('themes: intro first, then a rotation that never repeats back to back, finale at 20', () => {
    for (const seed of SEEDS) {
      expect([1, 2, 3].map((n) => waveTheme(n, seed))).toEqual(['intro', 'intro', 'intro']);
      expect(waveTheme(FINAL_WAVE, seed)).toBe('finale');
      for (let n = 4; n < 60; n++) {
        expect(waveTheme(n, seed), `${seed} wave ${n}`).not.toBe(waveTheme(n + 1, seed));
      }
      const seen = new Set(Array.from({ length: 8 }, (_, i) => waveTheme(4 + i, seed)));
      expect([...seen].sort()).toEqual(['ambush', 'heavy', 'mixed', 'swarm']);
    }
  });

  it('themes change the mix: heavy waves bring more Tanks than swarm waves', () => {
    let heavy = 0;
    let swarm = 0;
    for (const seed of SEEDS) {
      for (let n = 10; n <= 19; n++) {
        const def = generateWave(n, { seed });
        if (def.theme === 'heavy') {
          heavy += count(def, 'tank') / def.enemyBudget;
        } else if (def.theme === 'swarm') {
          swarm += count(def, 'tank') / def.enemyBudget;
        }
      }
    }
    expect(heavy).toBeGreaterThan(swarm * 2);
  });

  it('ambush waves spawn in bigger groups', () => {
    const seed = SEEDS.find((s) => waveTheme(13, s) === 'ambush') ?? SEEDS[0] ?? 'x';
    const def = generateWave(13, { seed });
    expect(def.theme).toBe('ambush');
    expect(def.groupSize.max).toBe(3 + WAVE_RULES.groupSize.ambushBonus);
  });
});

describe('wave generator: the modifier channel (future adaptive and mutation systems)', () => {
  it('adaptive weights change the mix but never the budget', () => {
    let runners = 0;
    let boosted = 0;
    for (const seed of SEEDS) {
      const plain = generateWave(12, { seed });
      const adapted = generateWave(12, {
        seed,
        modifiers: [{ source: 'adaptive', archetypeWeights: { runner: 2 } }],
      });
      expect(adapted.enemyBudget).toBe(plain.enemyBudget);
      runners += count(plain, 'runner');
      boosted += count(adapted, 'runner');
    }
    expect(boosted).toBeGreaterThan(runners);
  });

  it('adaptive modifiers cannot change the budget; a mutation can, within its clamp', () => {
    const plain = generateWave(10, { seed: 's' });
    const adaptive = generateWave(10, {
      seed: 's',
      modifiers: [{ source: 'adaptive', budgetMultiplier: 3 }],
    });
    const mutation = generateWave(10, {
      seed: 's',
      modifiers: [{ source: 'mutation', budgetMultiplier: 3 }],
    });
    expect(adaptive.enemyBudget).toBe(plain.enemyBudget);
    expect(mutation.enemyBudget).toBe(Math.round(plain.enemyBudget * 1.5)); // clamped
  });

  it('weights and trait chances are clamped', () => {
    const def = generateWave(12, {
      seed: 's',
      modifiers: [{ source: 'adaptive', archetypeWeights: { runner: 1000 } }],
    });
    // Clamped to ×2: Walkers still appear.
    expect(count(def, 'walker')).toBeGreaterThan(0);
    const traited = generateWave(9, {
      seed: 's',
      modifiers: [{ source: 'adaptive', traitChance: { armored: 1 } }],
    });
    const armored = traited.spawns.filter((s) => s.traits.includes('armored')).length;
    // 0.08 + at most 0.2: well short of every enemy.
    expect(armored).toBeLessThan(traited.spawns.length);
  });

  it('the Climber cannot be brought in while it is not implemented, from any source', () => {
    for (const source of ['adaptive', 'mutation', 'debug'] as const) {
      for (const seed of SEEDS) {
        const def = generateWave(15, {
          seed,
          modifiers: [{ source, extraArchetypes: ['climber'], archetypeWeights: { climber: 2 } }],
        });
        expect(def.spawns.some((s) => (s.archetype as string) === 'climber')).toBe(false);
      }
    }
  });

  it('an archetype outside the roster comes only from the adaptive source, a few at most', () => {
    const roster = ['walker'] as const;
    const adaptive = generateWave(14, {
      seed: 's',
      roster,
      modifiers: [
        { source: 'adaptive', extraArchetypes: ['runner'], archetypeWeights: { runner: 2 } },
      ],
    });
    const mutation = generateWave(14, {
      seed: 's',
      roster,
      modifiers: [{ source: 'mutation', extraArchetypes: ['runner'] }],
    });
    expect(count(adaptive, 'runner')).toBeGreaterThan(0);
    expect(count(adaptive, 'runner')).toBeLessThanOrEqual(WAVE_RULES.extraArchetypeMax);
    expect(count(mutation, 'runner')).toBe(0);
  });

  it('spawn bias and the modifiers are carried in the definition', () => {
    const modifiers = [
      { source: 'adaptive' as const, spawnBias: ['east' as const, 'north' as const] },
    ];
    const def = generateWave(9, { seed: 's', modifiers });
    expect(def.spawnBias).toEqual(['east', 'north']);
    expect(def.modifiers).toBe(modifiers);
  });
});
