import { describe, expect, it, vi } from 'vitest';
import {
  ALL_GAME_STATES,
  GameStateId,
  GameStateMachine,
  InvalidTransitionError,
  PLAYING_CHILDREN,
  parentOf,
  type GameStateMachineOptions,
  type TransitionEvent,
} from './GameState';

type Id = GameStateId;

/** Transitions that drive a fresh machine from BOOT into each concrete state. */
const PATHS: Readonly<Record<Exclude<Id, 'PLAYING'>, readonly Id[]>> = {
  BOOT: [],
  MAIN_MENU: ['MAIN_MENU'],
  LOADING: ['MAIN_MENU', 'LOADING'],
  WAVE_START: ['MAIN_MENU', 'LOADING', 'PLAYING'],
  WAVE_ACTIVE: ['MAIN_MENU', 'LOADING', 'PLAYING', 'WAVE_ACTIVE'],
  BOSS: ['MAIN_MENU', 'LOADING', 'PLAYING', 'BOSS'],
  WAVE_COMPLETE: ['MAIN_MENU', 'LOADING', 'PLAYING', 'WAVE_ACTIVE', 'WAVE_COMPLETE'],
  UPGRADE_SELECTION: [
    'MAIN_MENU',
    'LOADING',
    'PLAYING',
    'WAVE_ACTIVE',
    'WAVE_COMPLETE',
    'UPGRADE_SELECTION',
  ],
  PAUSED: ['MAIN_MENU', 'LOADING', 'PLAYING', 'WAVE_ACTIVE', 'PAUSED'],
  GAME_OVER: ['MAIN_MENU', 'LOADING', 'PLAYING', 'WAVE_ACTIVE', 'GAME_OVER'],
  VICTORY: ['MAIN_MENU', 'LOADING', 'PLAYING', 'WAVE_ACTIVE', 'WAVE_COMPLETE', 'VICTORY'],
};

const LEAF_STATES = Object.keys(PATHS) as Exclude<Id, 'PLAYING'>[];

/**
 * The legal transitions, written out independently of the production table so the test checks
 * the table rather than restating it (source: ARCHITECTURE.md §4).
 */
const RUN_PHASE_EXITS: readonly Id[] = ['PAUSED', 'GAME_OVER'];
const EXPECTED_LEGAL: Readonly<Record<Exclude<Id, 'PLAYING'>, readonly Id[]>> = {
  BOOT: ['MAIN_MENU'],
  MAIN_MENU: ['LOADING'],
  LOADING: ['PLAYING', 'MAIN_MENU'],
  WAVE_START: ['WAVE_ACTIVE', 'BOSS', ...RUN_PHASE_EXITS],
  WAVE_ACTIVE: ['WAVE_COMPLETE', ...RUN_PHASE_EXITS],
  BOSS: ['WAVE_COMPLETE', ...RUN_PHASE_EXITS],
  WAVE_COMPLETE: ['UPGRADE_SELECTION', 'VICTORY', ...RUN_PHASE_EXITS],
  UPGRADE_SELECTION: ['WAVE_START', ...RUN_PHASE_EXITS],
  PAUSED: ['PLAYING', 'LOADING', 'MAIN_MENU'],
  GAME_OVER: ['LOADING', 'MAIN_MENU'],
  VICTORY: ['MAIN_MENU'],
};

/** The concrete state a legal transition lands in. */
function expectedLanding(from: Id, to: Id): Id {
  if (to === 'PLAYING') {
    return from === 'PAUSED' ? 'WAVE_ACTIVE' : 'WAVE_START'; // PATHS pauses from WAVE_ACTIVE
  }
  return to;
}

function machineIn(state: Exclude<Id, 'PLAYING'>, options: GameStateMachineOptions = {}) {
  const fsm = new GameStateMachine({ strict: true, ...options });
  for (const step of PATHS[state]) {
    fsm.transition(step);
  }
  expect(fsm.current).toBe(state);
  return fsm;
}

/** Records every hook and change notification as readable strings. */
function recordHooks(fsm: GameStateMachine): string[] {
  const log: string[] = [];
  for (const state of ALL_GAME_STATES) {
    fsm.onExit(state, () => log.push(`exit:${state}`));
    fsm.onEnter(state, () => log.push(`enter:${state}`));
  }
  fsm.onChange(({ from, to }) => log.push(`change:${from}->${to}`));
  return log;
}

describe('GameState definitions', () => {
  it('defines exactly the 12 states required by the plan', () => {
    expect([...ALL_GAME_STATES].sort()).toEqual(
      [
        'BOOT',
        'MAIN_MENU',
        'LOADING',
        'PLAYING',
        'WAVE_START',
        'WAVE_ACTIVE',
        'WAVE_COMPLETE',
        'UPGRADE_SELECTION',
        'BOSS',
        'PAUSED',
        'GAME_OVER',
        'VICTORY',
      ].sort(),
    );
    for (const [key, value] of Object.entries(GameStateId)) {
      expect(key).toBe(value);
    }
  });

  it('nests exactly the five run phases under PLAYING', () => {
    expect([...PLAYING_CHILDREN].sort()).toEqual(
      ['BOSS', 'UPGRADE_SELECTION', 'WAVE_ACTIVE', 'WAVE_COMPLETE', 'WAVE_START'].sort(),
    );
    for (const state of ALL_GAME_STATES) {
      expect(parentOf(state)).toBe(PLAYING_CHILDREN.includes(state) ? 'PLAYING' : undefined);
    }
  });
});

describe('GameStateMachine', () => {
  it('starts in BOOT with no run active', () => {
    const fsm = new GameStateMachine();
    expect(fsm.current).toBe('BOOT');
    expect(fsm.isRunActive).toBe(false);
    expect(fsm.pausedState).toBeNull();
  });

  describe('transition table', () => {
    for (const from of LEAF_STATES) {
      for (const to of ALL_GAME_STATES) {
        const legal = EXPECTED_LEGAL[from].includes(to);
        it(`${from} -> ${to} is ${legal ? 'legal' : 'rejected'}`, () => {
          const onInvalidTransition = vi.fn();
          const fsm = machineIn(from, { strict: false, onInvalidTransition });

          expect(fsm.canTransition(to)).toBe(legal);
          expect(fsm.transition(to)).toBe(legal);

          if (legal) {
            expect(fsm.current).toBe(expectedLanding(from, to));
            expect(onInvalidTransition).not.toHaveBeenCalled();
          } else {
            expect(fsm.current).toBe(from);
            expect(onInvalidTransition).toHaveBeenCalledWith(from, to);
          }
        });
      }
    }
  });

  describe('rejected transitions', () => {
    it('leave the state, the paused phase and all hooks untouched', () => {
      const fsm = machineIn('PAUSED', { strict: false });
      const log = recordHooks(fsm);

      expect(fsm.transition('GAME_OVER')).toBe(false); // cannot die while paused
      expect(fsm.transition('PAUSED')).toBe(false); // no self-transition
      expect(fsm.transition('WAVE_COMPLETE')).toBe(false); // cannot jump into a run phase

      expect(fsm.current).toBe('PAUSED');
      expect(fsm.pausedState).toBe('WAVE_ACTIVE');
      expect(log).toEqual([]);
    });

    it('throw InvalidTransitionError in strict mode', () => {
      const fsm = machineIn('MAIN_MENU');
      let caught: unknown;
      try {
        fsm.transition('VICTORY');
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(InvalidTransitionError);
      expect((caught as InvalidTransitionError).from).toBe('MAIN_MENU');
      expect((caught as InvalidTransitionError).to).toBe('VICTORY');
      expect(fsm.current).toBe('MAIN_MENU');
    });

    it('reject entering a run phase directly from outside the run', () => {
      const fsm = machineIn('LOADING', { strict: false });
      for (const child of PLAYING_CHILDREN) {
        expect(fsm.transition(child)).toBe(false);
      }
      expect(fsm.current).toBe('LOADING');
    });

    it('reject re-entering PLAYING from inside the run', () => {
      for (const child of PLAYING_CHILDREN) {
        const fsm = machineIn(child as Exclude<Id, 'PLAYING'>, { strict: false });
        expect(fsm.transition('PLAYING')).toBe(false);
        expect(fsm.current).toBe(child);
      }
    });

    it('reject unknown state ids from untyped callers', () => {
      const fsm = machineIn('MAIN_MENU', { strict: false });
      expect(fsm.transition('NOT_A_STATE' as Id)).toBe(false);
      expect(fsm.current).toBe('MAIN_MENU');
    });
  });

  describe('hierarchy', () => {
    it('enters WAVE_START when PLAYING is entered, firing parent before child', () => {
      const fsm = machineIn('LOADING');
      const log = recordHooks(fsm);

      fsm.transition('PLAYING');

      expect(fsm.current).toBe('WAVE_START');
      expect(log).toEqual([
        'exit:LOADING',
        'enter:PLAYING',
        'enter:WAVE_START',
        'change:LOADING->WAVE_START',
      ]);
    });

    it('is in PLAYING during every run phase, and only then', () => {
      for (const state of LEAF_STATES) {
        const fsm = machineIn(state);
        expect(fsm.isIn('PLAYING')).toBe(PLAYING_CHILDREN.includes(state));
        expect(fsm.isIn(state)).toBe(true);
      }
    });

    it('does not fire PLAYING hooks when moving between run phases', () => {
      const fsm = machineIn('WAVE_START');
      const log = recordHooks(fsm);

      fsm.transition('WAVE_ACTIVE');
      fsm.transition('WAVE_COMPLETE');
      fsm.transition('UPGRADE_SELECTION');
      fsm.transition('WAVE_START');
      fsm.transition('BOSS');

      expect(log.filter((entry) => entry.endsWith(':PLAYING'))).toEqual([]);
      expect(log).toContain('exit:WAVE_ACTIVE');
      expect(log).toContain('enter:BOSS');
    });

    it('exits the run phase and then PLAYING on game over, from every run phase', () => {
      for (const phase of PLAYING_CHILDREN) {
        const fsm = machineIn(phase as Exclude<Id, 'PLAYING'>);
        const log = recordHooks(fsm);

        fsm.transition('GAME_OVER');

        expect(fsm.current).toBe('GAME_OVER');
        expect(fsm.isRunActive).toBe(false);
        expect(log).toEqual([
          `exit:${phase}`,
          'exit:PLAYING',
          'enter:GAME_OVER',
          `change:${phase}->GAME_OVER`,
        ]);
      }
    });

    it('allows victory only once the final wave is complete', () => {
      const fsm = machineIn('BOSS', { strict: false });
      expect(fsm.transition('VICTORY')).toBe(false);
      fsm.transition('WAVE_COMPLETE');
      expect(fsm.transition('VICTORY')).toBe(true);
      expect(fsm.isIn('PLAYING')).toBe(false);
    });
  });

  describe('pause and resume', () => {
    it('restores exactly the suspended run phase, from every run phase', () => {
      for (const phase of PLAYING_CHILDREN) {
        const fsm = machineIn(phase as Exclude<Id, 'PLAYING'>);

        expect(fsm.pause()).toBe(true);
        expect(fsm.current).toBe('PAUSED');
        expect(fsm.pausedState).toBe(phase);
        expect(fsm.isIn('PLAYING')).toBe(false);
        expect(fsm.isRunActive).toBe(true);

        expect(fsm.resume()).toBe(true);
        expect(fsm.current).toBe(phase);
        expect(fsm.pausedState).toBeNull();
      }
    });

    it('suspends rather than exits: only PAUSED hooks fire on pause and resume', () => {
      const fsm = machineIn('BOSS');
      const log = recordHooks(fsm);

      fsm.pause();
      fsm.resume();

      expect(log).toEqual([
        'enter:PAUSED',
        'change:BOSS->PAUSED',
        'exit:PAUSED',
        'change:PAUSED->BOSS',
      ]);
    });

    it('pause() is a no-op when already paused (e.g. blur followed by pointer-lock loss)', () => {
      const fsm = machineIn('WAVE_ACTIVE');
      expect(fsm.pause()).toBe(true);
      expect(fsm.pause()).toBe(false);
      expect(fsm.pausedState).toBe('WAVE_ACTIVE');
      expect(fsm.resume()).toBe(true);
      expect(fsm.current).toBe('WAVE_ACTIVE');
    });

    it('pause() is a no-op outside a run', () => {
      for (const state of ['BOOT', 'MAIN_MENU', 'LOADING', 'GAME_OVER', 'VICTORY'] as const) {
        const fsm = machineIn(state);
        expect(fsm.pause()).toBe(false);
        expect(fsm.current).toBe(state);
      }
    });

    it('resume() is a no-op when not paused', () => {
      for (const state of LEAF_STATES.filter((s) => s !== 'PAUSED')) {
        const fsm = machineIn(state);
        expect(fsm.resume()).toBe(false);
        expect(fsm.current).toBe(state);
      }
    });

    it('survives rapid pause/resume toggling', () => {
      const fsm = machineIn('UPGRADE_SELECTION');
      for (let i = 0; i < 101; i++) {
        if (i % 2 === 0) {
          fsm.pause();
        } else {
          fsm.resume();
        }
        fsm.pause(); // spurious extra pause requests are ignored
      }
      expect(fsm.current).toBe('PAUSED');
      expect(fsm.resume()).toBe(true);
      expect(fsm.current).toBe('UPGRADE_SELECTION');
    });

    it('restart while paused exits PAUSED, the suspended phase and PLAYING, in that order', () => {
      const fsm = machineIn('PAUSED');
      const log = recordHooks(fsm);

      fsm.transition('LOADING');

      expect(fsm.current).toBe('LOADING');
      expect(fsm.pausedState).toBeNull();
      expect(fsm.isRunActive).toBe(false);
      expect(log).toEqual([
        'exit:PAUSED',
        'exit:WAVE_ACTIVE',
        'exit:PLAYING',
        'enter:LOADING',
        'change:PAUSED->LOADING',
      ]);

      // The new run starts fresh at WAVE_START, not at the old suspended phase.
      fsm.transition('PLAYING');
      expect(fsm.current).toBe('WAVE_START');
    });

    it('quit while paused exits the run the same way', () => {
      const fsm = machineIn('PAUSED');
      const log = recordHooks(fsm);

      fsm.transition('MAIN_MENU');

      expect(fsm.current).toBe('MAIN_MENU');
      expect(log).toEqual([
        'exit:PAUSED',
        'exit:WAVE_ACTIVE',
        'exit:PLAYING',
        'enter:MAIN_MENU',
        'change:PAUSED->MAIN_MENU',
      ]);
    });
  });

  describe('full flows', () => {
    it('runs a multi-wave run with a boss wave to victory and back to the menu', () => {
      const fsm = new GameStateMachine({ strict: true });
      const changes: string[] = [];
      fsm.onChange(({ to }) => changes.push(to));

      const steps: Id[] = [
        'MAIN_MENU',
        'LOADING',
        'PLAYING',
        'WAVE_ACTIVE',
        'WAVE_COMPLETE',
        'UPGRADE_SELECTION',
        'WAVE_START',
        'BOSS',
        'WAVE_COMPLETE',
        'VICTORY',
        'MAIN_MENU',
      ];
      for (const step of steps) {
        expect(fsm.transition(step)).toBe(true);
      }

      expect(changes).toEqual([
        'MAIN_MENU',
        'LOADING',
        'WAVE_START',
        'WAVE_ACTIVE',
        'WAVE_COMPLETE',
        'UPGRADE_SELECTION',
        'WAVE_START',
        'BOSS',
        'WAVE_COMPLETE',
        'VICTORY',
        'MAIN_MENU',
      ]);
    });

    it('supports game over then an immediate restart', () => {
      const fsm = machineIn('GAME_OVER');
      expect(fsm.transition('LOADING')).toBe(true);
      expect(fsm.transition('PLAYING')).toBe(true);
      expect(fsm.current).toBe('WAVE_START');
    });

    it('can abandon loading back to the main menu', () => {
      const fsm = machineIn('LOADING');
      expect(fsm.transition('MAIN_MENU')).toBe(true);
    });
  });

  describe('transitions requested from hooks', () => {
    it('queues them until the current transition completes', () => {
      const fsm = machineIn('MAIN_MENU');
      const log = recordHooks(fsm);
      fsm.onEnter('LOADING', () => {
        // e.g. assets already cached: finish loading immediately.
        expect(fsm.transition('PLAYING')).toBe(true);
        log.push('requested PLAYING');
      });

      expect(fsm.transition('LOADING')).toBe(true);

      expect(fsm.current).toBe('WAVE_START');
      expect(log).toEqual([
        'exit:MAIN_MENU',
        'enter:LOADING',
        'requested PLAYING',
        'change:MAIN_MENU->LOADING',
        'exit:LOADING',
        'enter:PLAYING',
        'enter:WAVE_START',
        'change:LOADING->WAVE_START',
      ]);
    });

    it('rejects a queued transition that is illegal by the time it runs', () => {
      const onInvalidTransition = vi.fn();
      const fsm = machineIn('WAVE_ACTIVE', { strict: false, onInvalidTransition });
      fsm.onEnter('WAVE_COMPLETE', () => {
        fsm.transition('BOSS'); // illegal from WAVE_COMPLETE
      });

      expect(fsm.transition('WAVE_COMPLETE')).toBe(true);

      expect(fsm.current).toBe('WAVE_COMPLETE');
      expect(onInvalidTransition).toHaveBeenCalledWith('WAVE_COMPLETE', 'BOSS');
    });

    it('handles death requested during a wave transition (plan §28)', () => {
      const fsm = machineIn('WAVE_ACTIVE');
      fsm.onExit('WAVE_ACTIVE', () => {
        fsm.transition('GAME_OVER'); // e.g. lingering damage lands as the wave ends
      });

      fsm.transition('WAVE_COMPLETE');

      expect(fsm.current).toBe('GAME_OVER');
    });
  });

  describe('hooks and listeners', () => {
    it('passes the concrete from/to states to hooks', () => {
      const fsm = machineIn('LOADING');
      const events: TransitionEvent[] = [];
      fsm.onEnter('PLAYING', (event) => events.push(event));
      fsm.onEnter('WAVE_START', (event) => events.push(event));

      fsm.transition('PLAYING');

      expect(events).toEqual([
        { from: 'LOADING', to: 'WAVE_START' },
        { from: 'LOADING', to: 'WAVE_START' },
      ]);
    });

    it('stops calling hooks and listeners after they unsubscribe', () => {
      const fsm = machineIn('BOOT');
      const enter = vi.fn();
      const exit = vi.fn();
      const change = vi.fn();
      const offEnter = fsm.onEnter('MAIN_MENU', enter);
      const offExit = fsm.onExit('BOOT', exit);
      const offChange = fsm.onChange(change);

      offEnter();
      offExit();
      offChange();
      fsm.transition('MAIN_MENU');

      expect(enter).not.toHaveBeenCalled();
      expect(exit).not.toHaveBeenCalled();
      expect(change).not.toHaveBeenCalled();
    });

    it('completes the transition and runs other hooks before rethrowing a hook error', () => {
      const fsm = machineIn('BOOT');
      const boom = new Error('boom');
      const later = vi.fn();
      fsm.onEnter('MAIN_MENU', () => {
        throw boom;
      });
      fsm.onEnter('MAIN_MENU', later);

      expect(() => fsm.transition('MAIN_MENU')).toThrow(boom);
      expect(fsm.current).toBe('MAIN_MENU');
      expect(later).toHaveBeenCalledOnce();

      // The machine is still usable afterwards.
      expect(fsm.transition('LOADING')).toBe(true);
    });

    it('reports hook errors to onListenerError instead of throwing when provided', () => {
      const onListenerError = vi.fn();
      const fsm = machineIn('BOOT', { onListenerError });
      const boom = new Error('boom');
      fsm.onChange(() => {
        throw boom;
      });

      expect(fsm.transition('MAIN_MENU')).toBe(true);
      expect(onListenerError).toHaveBeenCalledWith(boom, { from: 'BOOT', to: 'MAIN_MENU' });
    });
  });
});
