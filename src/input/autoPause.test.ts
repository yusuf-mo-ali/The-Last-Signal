import { describe, expect, it } from 'vitest';
import { GameStateMachine } from '../core/GameState';
import { installAutoPause, type PauseSignals } from './autoPause';

/** Pause signal sources that the test fires by hand. */
function fakeSignals() {
  const listeners = {
    lock: new Set<() => void>(),
    focus: new Set<() => void>(),
    hidden: new Set<() => void>(),
  };
  const subscribe = (set: Set<() => void>) => (listener: () => void) => {
    set.add(listener);
    return () => set.delete(listener);
  };
  const signals: PauseSignals = {
    onPointerLockLost: subscribe(listeners.lock),
    onFocusLost: subscribe(listeners.focus),
    onHidden: subscribe(listeners.hidden),
  };
  const fire = (name: keyof typeof listeners) => {
    for (const listener of listeners[name]) {
      listener();
    }
  };
  return { signals, fire, listeners };
}

function machineInWave(): GameStateMachine {
  const fsm = new GameStateMachine({ strict: true });
  for (const step of ['MAIN_MENU', 'LOADING', 'PLAYING', 'WAVE_ACTIVE'] as const) {
    fsm.transition(step);
  }
  return fsm;
}

describe('installAutoPause', () => {
  for (const signal of ['lock', 'focus', 'hidden'] as const) {
    it(`pauses the run when ${signal === 'lock' ? 'pointer lock is lost' : signal === 'focus' ? 'the window loses focus' : 'the tab is hidden'}`, () => {
      const fsm = machineInWave();
      const { signals, fire } = fakeSignals();
      installAutoPause(fsm, signals);

      fire(signal);

      expect(fsm.current).toBe('PAUSED');
      expect(fsm.pausedState).toBe('WAVE_ACTIVE');
    });
  }

  it('pauses once when all three signals arrive together (alt-tab while playing)', () => {
    const fsm = machineInWave();
    const changes: string[] = [];
    fsm.onChange(({ to }) => changes.push(to));
    const { signals, fire } = fakeSignals();
    installAutoPause(fsm, signals);

    fire('focus');
    fire('lock');
    fire('hidden');

    expect(changes).toEqual(['PAUSED']);
  });

  it('does nothing outside a run (e.g. Esc in the main menu)', () => {
    const fsm = new GameStateMachine({ strict: true });
    fsm.transition('MAIN_MENU');
    const { signals, fire } = fakeSignals();
    installAutoPause(fsm, signals);

    fire('lock');
    fire('focus');

    expect(fsm.current).toBe('MAIN_MENU');
  });

  it('never resumes by itself', () => {
    const fsm = machineInWave();
    const { signals, fire } = fakeSignals();
    installAutoPause(fsm, signals);
    fire('lock');
    fire('lock');
    expect(fsm.current).toBe('PAUSED');
  });

  it('removes every trigger when uninstalled', () => {
    const fsm = machineInWave();
    const { signals, fire, listeners } = fakeSignals();
    const uninstall = installAutoPause(fsm, signals);
    uninstall();

    fire('lock');
    fire('focus');
    fire('hidden');

    expect(fsm.current).toBe('WAVE_ACTIVE');
    expect(listeners.lock.size + listeners.focus.size + listeners.hidden.size).toBe(0);
  });
});
