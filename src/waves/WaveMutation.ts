/**
 * The wave's mutation selector (D-024): which Signal Mutation a wave carries, never how it is
 * applied (that is `SignalMutationSystem`, Phase 7). Pure: the same wave, history and seed give the
 * same answer.
 *
 * Phase 6 (D-044): no mutations exist yet, so every wave gets none. Phase 7 fills this in: weighted,
 * gated by tier, none in the first `MUTATION_FREE_WAVES` (O-7), never the same twice in a row.
 */

import type { MutationId } from '../config/mutations';
import type { Rng } from '../utils/Rng';

export function selectMutation(
  _waveNumber: number,
  _previous: MutationId | null,
  _rng: Rng,
): MutationId | null {
  return null;
}
