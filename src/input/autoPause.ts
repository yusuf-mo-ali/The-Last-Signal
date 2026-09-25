/**
 * Pauses the game whenever the player can no longer be playing (D-017, plan §28 "tab switching"):
 * the pointer lock is lost (including the Esc press the browser consumes), the window loses focus,
 * or the tab is hidden. `pause()` is a no-op outside a run or when already paused, so the usual
 * burst of all three signals at once pauses exactly once.
 *
 * Resuming is deliberately *not* automatic: the player resumes by clicking, which re-acquires the
 * pointer lock inside a user gesture.
 */

export interface Pausable {
  pause(): boolean;
}

export interface PauseSignals {
  onPointerLockLost(listener: () => void): () => void;
  onFocusLost(listener: () => void): () => void;
  onHidden(listener: () => void): () => void;
}

/** Installs the pause triggers. Returns a function that removes them. */
export function installAutoPause(target: Pausable, signals: PauseSignals): () => void {
  const pause = (): void => {
    target.pause();
  };
  const removers = [
    signals.onPointerLockLost(pause),
    signals.onFocusLost(pause),
    signals.onHidden(pause),
  ];
  return () => {
    for (const remove of removers) {
      remove();
    }
  };
}
