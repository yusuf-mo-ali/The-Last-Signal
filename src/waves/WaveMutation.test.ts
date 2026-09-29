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
