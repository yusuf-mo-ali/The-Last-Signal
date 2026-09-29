/**
 * The wave's mutation selector (D-024, D-045): which Signal Mutation a wave carries, never how it
 * is applied (that is `SignalMutationSystem`). Pure: the same wave number, history and stream give
 * the same answer.
 *
 * Rules:
 * - none on the first `MUTATION_FREE_WAVES` waves (O-7) and none on the final wave (boss rules);
 *   exactly one on every other wave, endless waves included;
 * - only `enabled` mutations whose `minWave` has come (LOW GRAVITY and OVERLOAD never);
 * - never the previous wave's mutation, nor one from the same group (two visibility waves in a
 *   row);
 * - a draw weighted by the mutation's weight for the wave's tier, less likely if used in the last
 *   few waves.
 *
 * The history is the run's actually played sequence (the wave runtime keeps it). For normal play
 * it equals `mutationSchedule(runSeed)`, which previews use.
 */

import {
  ENABLED_MUTATION_IDS,
  MUTATION_RULES,
  MUTATIONS,
  type MutationConfig,
  type MutationId,
} from '../config/mutations';
import { FINAL_WAVE, MUTATION_FREE_WAVES } from '../config/waves';
import { Rng } from '../utils/Rng';
import { waveIndex, waveTier } from './WaveDifficulty';

export interface SelectionOptions {
  /** The mutations that may be drawn (default: every enabled one). */
  readonly pool?: readonly MutationId[];
  readonly catalogue?: Readonly<Record<MutationId, MutationConfig>>;
}

/** Whether wave `n` carries a mutation at all. */
export function waveHasMutation(n: number): boolean {
  const w = waveIndex(n);
  return w > MUTATION_FREE_WAVES && w !== FINAL_WAVE;
}

/** The stream a wave's selection draws from (D-014). */
export function mutationRng(runSeed: number | string, n: number): Rng {
  return new Rng(`${runSeed}:mutation:${waveIndex(n)}`);
}

export function selectMutation(
  n: number,
  history: readonly MutationId[],
  rng: Rng,
  options: SelectionOptions = {},
): MutationId | null {
  const wave = waveIndex(n);
  if (!waveHasMutation(wave)) {
    return null;
  }
  const catalogue = options.catalogue ?? MUTATIONS;
  const tier = waveTier(wave);
  const eligible = (options.pool ?? ENABLED_MUTATION_IDS).filter((id) => {
    const m = catalogue[id];
    return m.status === 'enabled' && m.minWave <= wave && m.weights[tier] > 0;
  });
  const previous = history.at(-1);
  const previousGroup = previous ? catalogue[previous].group : undefined;
  const notPrevious = eligible.filter((id) => id !== previous);
  const apartFromGroup = notPrevious.filter(
    (id) => previousGroup === undefined || catalogue[id].group !== previousGroup,
  );
  // Never the same twice in a row; the group rule gives way only if nothing else is left.
  const pool = apartFromGroup.length > 0 ? apartFromGroup : notPrevious;
  if (pool.length === 0) {
    return null;
  }
  const recent = history.slice(-MUTATION_RULES.cooldownWaves);
  const weights = pool.map(
    (id) => catalogue[id].weights[tier] * (recent.includes(id) ? MUTATION_RULES.recentPenalty : 1),
  );
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rng.next() * total;
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i] ?? 0;
    if (r < 0) {
      return pool[i] ?? null;
    }
  }
  return pool[pool.length - 1] ?? null;
}

/**
 * The mutations a run with `runSeed` meets on waves 1…`to` when played straight through (index =
 * wave number; index 0 unused). Used for previews and to check the runtime's choices.
 */
export function mutationSchedule(
  runSeed: number | string,
  to: number,
  options: SelectionOptions = {},
): (MutationId | null)[] {
  const schedule: (MutationId | null)[] = [null];
  const history: MutationId[] = [];
  for (let n = 1; n <= Math.max(0, Math.floor(to)); n++) {
    const id = selectMutation(n, history, mutationRng(runSeed, n), options);
    schedule.push(id);
    if (id) {
      history.push(id);
    }
  }
  return schedule;
}
