/**
 * Connects an `InputReader` to the simulation's fixed step.
 *
 * - The reader is sampled at the *start* of every fixed step, before any system runs, so every
 *   system in that step sees the same window of input: everything since the previous step.
 * - When the game leaves a frozen state (resume from PAUSED, or the next wave after
 *   UPGRADE_SELECTION), input gathered while frozen is discarded. The click that resumes the game
 *   must not also fire a weapon.
 */

import { FROZEN_STATES, type Game } from '../core/Game';
import type { InputReader } from './InputState';

export function attachStepInput(game: Game, reader: InputReader): () => void {
  // Prepended, so it runs first in every step no matter when gameplay systems are registered.
  const removeSystem = game.prependSystem({
    fixedUpdate: () => {
      reader.sample();
    },
  });
  const removeListener = game.state.onChange(({ from }) => {
    if (FROZEN_STATES.has(from)) {
      reader.discard();
    }
  });
  return () => {
    removeSystem();
    removeListener();
  };
}
