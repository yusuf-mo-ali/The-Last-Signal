/**
 * Mutation selection (D-024, D-045) as properties over many seeds and waves: none on the first
 * three waves or the final wave, exactly one on every other wave, never twice in a row, never two
 * visibility mutations back to back, only enabled mutations after their first wave, seeded.
 */

import { describe, expect, it } from 'vitest';
import { ENABLED_MUTATION_IDS, MUTATIONS, type MutationId } from '../config/mutations';
import { FINAL_WAVE, MUTATION_FREE_WAVES } from '../config/waves';
import { Rng } from '../utils/Rng';
import { mutationRng, mutationSchedule, selectMutation, waveHasMutation } from './WaveMutation';

const SEEDS = Array.from({ length: 50 }, (_, i) => `run-${i}`);
const LAST = 60;

describe('mutation selection: properties over 50 runs × waves 1–60', () => {
  const schedules = SEEDS.map((seed) => mutationSchedule(seed, LAST));

  it('O-7: none on waves 1–3 or the final wave; exactly one on every other wave', () => {
    for (const schedule of schedules) {
      for (let n = 1; n <= LAST; n++) {
        const id = schedule[n];
        if (n <= MUTATION_FREE_WAVES || n === FINAL_WAVE) {
          expect(id, `wave ${n}`).toBeNull();
        } else {
          expect(id, `wave ${n}`).not.toBeNull();
        }
      }
    }
    expect(waveHasMutation(3)).toBe(false);
    expect(waveHasMutation(4)).toBe(true);
    expect(waveHasMutation(20)).toBe(false);
    expect(waveHasMutation(21)).toBe(true);
  });

  it('never the same twice in a row; never two visibility mutations back to back', () => {
    for (const schedule of schedules) {
      const played = schedule.filter((id): id is MutationId => id !== null);
      for (let i = 1; i < played.length; i++) {
        const a = played[i - 1];
        const b = played[i];
        expect(b).not.toBe(a);
        if (a && b && MUTATIONS[a].group) {
          expect(MUTATIONS[b].group).not.toBe(MUTATIONS[a].group);
        }
      }
    }
  });

  it('only enabled mutations, never before their first wave (never LOW GRAVITY or OVERLOAD)', () => {
    for (const schedule of schedules) {
      schedule.forEach((id, n) => {
        if (id) {
          expect(ENABLED_MUTATION_IDS).toContain(id);
          expect(n).toBeGreaterThanOrEqual(MUTATIONS[id].minWave);
        }
      });
    }
    const all = schedules.flat();
    expect(all).not.toContain('LOW_GRAVITY');
    expect(all).not.toContain('OVERLOAD');
    // Blood Moon waits for wave 9, Hive for wave 7.
    for (const schedule of schedules) {
      expect(schedule.slice(0, 9)).not.toContain('BLOOD_MOON');
      expect(schedule.slice(0, 7)).not.toContain('HIVE');
    }
  });

  it('variety: every v1 mutation appears, none dominates', () => {
    const counts = new Map<MutationId, number>();
    let total = 0;
    for (const schedule of schedules) {
      for (const id of schedule) {
        if (id) {
          counts.set(id, (counts.get(id) ?? 0) + 1);
          total++;
        }
      }
    }
    for (const id of ENABLED_MUTATION_IDS) {
      expect(counts.get(id) ?? 0, id).toBeGreaterThan(total * 0.08);
      expect(counts.get(id) ?? 0, id).toBeLessThan(total * 0.35);
    }
  });

  it('recent mutations come back less often than the others', () => {
    let soon = 0;
    let waves = 0;
    for (const schedule of schedules) {
      const played = schedule.filter((id): id is MutationId => id !== null);
      for (let i = 2; i < played.length; i++) {
        waves++;
        if (played[i] === played[i - 2]) {
          soon++;
        }
      }
    }
    // With six mutations and no memory, a repeat two waves later would be around 1 in 5.
    expect(soon / waves).toBeLessThan(0.14);
  });

  it('is seeded: the same run gives the same schedule; runs differ', () => {
    expect(mutationSchedule('same', 40)).toEqual(mutationSchedule('same', 40));
    expect(mutationSchedule('same', 40)).not.toEqual(mutationSchedule('other', 40));
    expect(selectMutation(9, ['HUNGER'], mutationRng('x', 9))).toBe(
      selectMutation(9, ['HUNGER'], mutationRng('x', 9)),
    );
  });

  it('a pool that only holds the previous mutation yields none rather than a repeat', () => {
    expect(selectMutation(10, ['HUNGER'], new Rng('r'), { pool: ['HUNGER'] })).toBeNull();
    // With only the vision pair left, the group rule gives way (never the repeat rule).
    expect(selectMutation(10, ['BLACKOUT'], new Rng('r'), { pool: ['BLACKOUT', 'STATIC'] })).toBe(
      'STATIC',
    );
  });
});

/** An rng that returns scripted values, then 0.5 forever. */
class ScriptedRng extends Rng {
  private readonly values: number[];
  constructor(values: readonly number[]) {
    super('scripted');
    this.values = [...values];
  }
  override next(): number {
    return this.values.shift() ?? 0.5;
  }
}

describe('BLOOD MOON: a guaranteed first appearance on waves 9–12, by its own roll only (D-046)', () => {
  const g = MUTATIONS.BLOOD_MOON.guarantee;
  const from = MUTATIONS.BLOOD_MOON.minWave;
  const by = g?.by ?? 0;

  it('the window is 9–12', () => {
    expect([from, by]).toEqual([9, 12]);
  });

  it('inside the window and unseen: chosen exactly when the roll is under 1 / waves left', () => {
    for (let n = from; n <= by; n++) {
      const p = 1 / (by - n + 1);
      expect(selectMutation(n, ['HUNGER'], new ScriptedRng([p - 1e-9])), `wave ${n}`).toBe(
        'BLOOD_MOON',
      );
      if (p < 1) {
        expect(selectMutation(n, ['HUNGER'], new ScriptedRng([p])), `wave ${n}`).not.toBe(
          'BLOOD_MOON',
        );
      }
    }
  });

  it('a failed roll is final: the weighted draw never offers it as a second path', () => {
    for (let n = from; n < by; n++) {
      const p = 1 / (by - n + 1);
      for (let k = 0; k < 200; k++) {
        const u = p + ((1 - p) * k) / 200;
        for (const draw of [0, 0.25, 0.5, 0.75, 0.999999]) {
          const id = selectMutation(n, ['HUNGER'], new ScriptedRng([u, draw]));
          expect(id, `wave ${n} roll ${u} draw ${draw}`).not.toBe('BLOOD_MOON');
          expect(id, `wave ${n} roll ${u} draw ${draw}`).not.toBeNull();
        }
      }
    }
  });

  it('wave 12 always brings it when it has not appeared, whatever the stream', () => {
    for (let k = 0; k < 200; k++) {
      expect(selectMutation(by, ['HIVE'], mutationRng(`w12-${k}`, by))).toBe('BLOOD_MOON');
    }
  });

  it('once it has appeared, the normal weighted rules apply (no forced roll, no repeat)', () => {
    // The first draw is the weighted one: 0 picks the first eligible mutation, not BLOOD MOON.
    const history: MutationId[] = ['BLOOD_MOON', 'HUNGER'];
    expect(selectMutation(11, history, new ScriptedRng([0]))).not.toBe('BLOOD_MOON');
    expect(selectMutation(12, ['BLOOD_MOON'], new ScriptedRng([0.999999]))).not.toBe('BLOOD_MOON');
    let later = 0;
    for (let k = 0; k < 400; k++) {
      if (
        selectMutation(11, ['BLOOD_MOON', 'HIVE'], mutationRng(`after-${k}`, 11)) === 'BLOOD_MOON'
      ) {
        later++;
      }
    }
    expect(later).toBeGreaterThan(0);
  });

  it('a pool without it (debug) has no guarantee', () => {
    expect(selectMutation(12, ['HIVE'], new Rng('p'), { pool: ['HUNGER', 'HIVE'] })).toBe('HUNGER');
  });

  describe('over 2000 runs', () => {
    const RUNS = 2000;
    const schedules = Array.from({ length: RUNS }, (_, i) => mutationSchedule(`bm-${i}`, 60));
    const firsts = schedules.map((s) => s.indexOf('BLOOD_MOON'));

    it('the first BLOOD MOON is always on waves 9–12; never on 1–8 or 20', () => {
      for (const [i, first] of firsts.entries()) {
        expect(first, `run ${i}`).toBeGreaterThanOrEqual(9);
        expect(first, `run ${i}`).toBeLessThanOrEqual(12);
        expect(schedules[i]?.[FINAL_WAVE], `run ${i}`).toBeNull();
      }
    });

    it('evenly: 25 % of first appearances on each wave; 1/4, 1/3, 1/2, 1 given none before', () => {
      let remaining = RUNS;
      for (let n = 9; n <= 12; n++) {
        const here = firsts.filter((f) => f === n).length;
        expect(here / RUNS, `share on wave ${n}`).toBeGreaterThan(0.22);
        expect(here / RUNS, `share on wave ${n}`).toBeLessThan(0.28);
        expect(here / remaining, `conditional on wave ${n}`).toBeCloseTo(1 / (12 - n + 1), 1);
        remaining -= here;
      }
      expect(remaining).toBe(0);
    });

    it('afterwards it comes back under the normal rules, never twice in a row', () => {
      let reappeared = 0;
      for (const s of schedules) {
        const played = s.filter((id): id is MutationId => id !== null);
        if (played.filter((id) => id === 'BLOOD_MOON').length > 1) {
          reappeared++;
        }
        for (let i = 1; i < played.length; i++) {
          if (played[i] === 'BLOOD_MOON') {
            expect(played[i - 1]).not.toBe('BLOOD_MOON');
          }
        }
      }
      expect(reappeared / RUNS).toBeGreaterThan(0.5);
    });
  });
});
