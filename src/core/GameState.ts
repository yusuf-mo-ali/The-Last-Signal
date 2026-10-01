/**
 * The game-flow state machine (IMPLEMENTATION_PLAN §6, ARCHITECTURE.md §4, D-005).
 *
 * All 12 plan states are used verbatim. They form a small hierarchy:
 *
 * - `PLAYING` is a composite state meaning "a run is in progress". Its children are the run phases
 *   `WAVE_START`, `WAVE_ACTIVE`, `BOSS`, `WAVE_COMPLETE` and `UPGRADE_SELECTION`. The machine is never
 *   *in* `PLAYING` alone: entering `PLAYING` enters `WAVE_START`, and `isIn('PLAYING')` is true in
 *   any of its children.
 * - `PAUSED` is a push-down state. Pausing suspends the current run phase without exiting it (no
 *   exit or enter hooks fire for it). Resuming returns to exactly that phase. Leaving `PAUSED` any
 *   other way (restart, quit) exits the suspended phase and `PLAYING` properly.
 *
 * Only transitions listed in `TRANSITIONS` are legal. Anything else is rejected: the call returns
 * `false` and `onInvalidTransition` is told, or, with `strict: true`, an `InvalidTransitionError`
 * is thrown. A transition requested from inside a hook is queued and runs after the current one.
 */

export const GameStateId = {
  BOOT: 'BOOT',
  MAIN_MENU: 'MAIN_MENU',
  LOADING: 'LOADING',
  PLAYING: 'PLAYING',
  WAVE_START: 'WAVE_START',
  WAVE_ACTIVE: 'WAVE_ACTIVE',
  WAVE_COMPLETE: 'WAVE_COMPLETE',
  UPGRADE_SELECTION: 'UPGRADE_SELECTION',
  BOSS: 'BOSS',
  PAUSED: 'PAUSED',
  GAME_OVER: 'GAME_OVER',
  VICTORY: 'VICTORY',
} as const;

export type GameStateId = (typeof GameStateId)[keyof typeof GameStateId];

export const ALL_GAME_STATES: readonly GameStateId[] = Object.values(GameStateId);

/** The run phases: children of `PLAYING`. */
export const PLAYING_CHILDREN: readonly GameStateId[] = [
  'WAVE_START',
  'WAVE_ACTIVE',
  'BOSS',
  'WAVE_COMPLETE',
  'UPGRADE_SELECTION',
];

const PARENT: Partial<Record<GameStateId, GameStateId>> = Object.fromEntries(
  PLAYING_CHILDREN.map((child) => [child, 'PLAYING']),
);

/** The child entered when a composite state is the transition target. */
const INITIAL_CHILD: Partial<Record<GameStateId, GameStateId>> = { PLAYING: 'WAVE_START' };

/**
 * Every legal transition, by source state. A rule listed under `PLAYING` applies to all of its
 * children. `PAUSED → PLAYING` means "resume the suspended run phase".
 */
export const TRANSITIONS: Readonly<Record<GameStateId, readonly GameStateId[]>> = {
  BOOT: ['MAIN_MENU'],
  MAIN_MENU: ['LOADING'],
  LOADING: ['PLAYING', 'MAIN_MENU'], // MAIN_MENU: loading failed or was cancelled
  PLAYING: ['PAUSED', 'GAME_OVER'],
  WAVE_START: ['WAVE_ACTIVE', 'BOSS'],
  WAVE_ACTIVE: ['WAVE_COMPLETE'],
  BOSS: ['WAVE_COMPLETE'],
  WAVE_COMPLETE: ['UPGRADE_SELECTION', 'VICTORY'],
  UPGRADE_SELECTION: ['WAVE_START'],
  PAUSED: ['PLAYING', 'LOADING', 'MAIN_MENU'],
  GAME_OVER: ['LOADING', 'MAIN_MENU'],
  VICTORY: ['MAIN_MENU'],
};

/** Returns the parent of a state, or `undefined` for top-level states. */
export function parentOf(state: GameStateId): GameStateId | undefined {
  return PARENT[state];
}

/** `from` and `to` are always the concrete (leaf) states before and after the transition. */
export interface TransitionEvent {
  readonly from: GameStateId;
  readonly to: GameStateId;
}

export type StateListener = (event: TransitionEvent) => void;
export type Unsubscribe = () => void;

export class InvalidTransitionError extends Error {
  readonly from: GameStateId;
  readonly to: GameStateId;

  constructor(from: GameStateId, to: GameStateId) {
    super(`Invalid game state transition: ${from} -> ${to}`);
    this.name = 'InvalidTransitionError';
    this.from = from;
    this.to = to;
  }
}

export interface GameStateMachineOptions {
  /** Throw `InvalidTransitionError` on illegal transitions (use in dev builds and tests). */
  readonly strict?: boolean;
  /** Told about every rejected transition, strict or not. */
  readonly onInvalidTransition?: (from: GameStateId, to: GameStateId) => void;
  /** Receives hook/listener errors. When omitted, they are rethrown after the transition completes. */
  readonly onListenerError?: (error: unknown, event: TransitionEvent) => void;
}

export class GameStateMachine {
  private state: GameStateId = 'BOOT';
  /** The run phase suspended by `PAUSED`; `null` whenever the machine is not paused. */
  private suspended: GameStateId | null = null;

  private readonly enterHooks = new Map<GameStateId, StateListener[]>();
  private readonly exitHooks = new Map<GameStateId, StateListener[]>();
  private changeListeners: StateListener[] = [];

  private transitioning = false;
  private readonly pending: GameStateId[] = [];
  private readonly options: GameStateMachineOptions;

  constructor(options: GameStateMachineOptions = {}) {
    this.options = options;
  }

  /** The current concrete state. Never `PLAYING` itself. */
  get current(): GameStateId {
    return this.state;
  }

  /** The run phase that `resume()` will return to, or `null` when not paused. */
  get pausedState(): GameStateId | null {
    return this.suspended;
  }

  /** True while a run exists: in any run phase, or paused. */
  get isRunActive(): boolean {
    return this.state === 'PAUSED' || this.isIn('PLAYING');
  }

  /** True if the current state is `state` or a child of it. */
  isIn(state: GameStateId): boolean {
    return this.state === state || parentOf(this.state) === state;
  }

  canTransition(to: GameStateId): boolean {
    return isLegal(this.state, to);
  }

  /**
   * Requests a transition. Returns `true` if it happened (or, when called from inside a hook, was
   * queued), `false` if it was rejected. Throws `InvalidTransitionError` instead in strict mode.
   */
  transition(to: GameStateId): boolean {
    if (this.transitioning) {
      this.pending.push(to);
      return true;
    }

    const errors: unknown[] = [];
    let accepted: boolean;
    this.transitioning = true;
    try {
      accepted = this.perform(to, errors);
      for (let next = this.pending.shift(); next !== undefined; next = this.pending.shift()) {
        this.perform(next, errors);
      }
    } finally {
      this.pending.length = 0;
      this.transitioning = false;
    }

    if (errors.length > 0) {
      const first = errors[0];
      throw errors.length === 1 && first instanceof Error
        ? first
        : new AggregateError(errors, `GameStateMachine: ${errors.length} listener(s) threw`);
    }
    return accepted;
  }

  /** Pauses the current run phase. A no-op returning `false` outside a run or when already paused. */
  pause(): boolean {
    if (!this.isIn('PLAYING')) {
      return false;
    }
    return this.transition('PAUSED');
  }

  /** Returns to the suspended run phase. A no-op returning `false` when not paused. */
  resume(): boolean {
    if (this.state !== 'PAUSED') {
      return false;
    }
    return this.transition('PLAYING');
  }

  /** Runs when `state` is entered. Composite states fire before their child. */
  onEnter(state: GameStateId, hook: StateListener): Unsubscribe {
    return addHook(this.enterHooks, state, hook);
  }

  /** Runs when `state` is exited. A child fires before its composite parent. */
  onExit(state: GameStateId, hook: StateListener): Unsubscribe {
    return addHook(this.exitHooks, state, hook);
  }

  /** Runs after every completed transition, once all enter and exit hooks have run. */
  onChange(listener: StateListener): Unsubscribe {
    this.changeListeners = [...this.changeListeners, listener];
    return () => {
      this.changeListeners = this.changeListeners.filter((l) => l !== listener);
    };
  }

  private perform(requested: GameStateId, errors: unknown[]): boolean {
    const from = this.state;
    if (!isLegal(from, requested)) {
      this.options.onInvalidTransition?.(from, requested);
      if (this.options.strict) {
        throw new InvalidTransitionError(from, requested);
      }
      return false;
    }

    let exits: GameStateId[];
    let enters: GameStateId[];
    let to: GameStateId;

    if (requested === 'PAUSED') {
      // Suspend: the run phase is not exited.
      this.suspended = from;
      to = 'PAUSED';
      exits = [];
      enters = ['PAUSED'];
    } else if (from === 'PAUSED' && requested === 'PLAYING') {
      // Resume: the run phase is not re-entered.
      to = this.suspended ?? 'WAVE_START';
      exits = ['PAUSED'];
      enters = [];
    } else {
      // A normal transition. Leaving PAUSED any other way also exits the suspended phase.
      const leaving = from === 'PAUSED' && this.suspended !== null ? this.suspended : from;
      to = INITIAL_CHILD[requested] ?? requested;
      const toChain = chainOf(to);
      const leavingChain = chainOf(leaving);
      exits = leavingChain.filter((s) => !toChain.includes(s));
      if (from === 'PAUSED') {
        exits.unshift('PAUSED');
      }
      enters = toChain.filter((s) => !leavingChain.includes(s)).reverse();
    }

    const event: TransitionEvent = { from, to };
    this.runHooks(this.exitHooks, exits, event, errors);
    this.state = to;
    if (to !== 'PAUSED') {
      this.suspended = null;
    }
    this.runHooks(this.enterHooks, enters, event, errors);
    this.notify(this.changeListeners, event, errors);
    return true;
  }

  private runHooks(
    hooks: ReadonlyMap<GameStateId, StateListener[]>,
    states: readonly GameStateId[],
    event: TransitionEvent,
    errors: unknown[],
  ): void {
    for (const state of states) {
      const list = hooks.get(state);
      if (list) {
        this.notify(list, event, errors);
      }
    }
  }

  private notify(listeners: readonly StateListener[], event: TransitionEvent, errors: unknown[]) {
    for (const listener of listeners) {
      try {
        listener(event);
      } catch (error) {
        if (this.options.onListenerError) {
          this.options.onListenerError(error, event);
        } else {
          errors.push(error);
        }
      }
    }
  }
}

function isLegal(from: GameStateId, to: GameStateId): boolean {
  if (TRANSITIONS[from].includes(to)) {
    return true;
  }
  const parent = parentOf(from);
  return parent !== undefined && TRANSITIONS[parent].includes(to);
}

/** The state followed by its ancestors, innermost first. */
function chainOf(state: GameStateId): GameStateId[] {
  const chain: GameStateId[] = [];
  for (let s: GameStateId | undefined = state; s !== undefined; s = parentOf(s)) {
    chain.push(s);
  }
  return chain;
}

function addHook(
  hooks: Map<GameStateId, StateListener[]>,
  state: GameStateId,
  hook: StateListener,
): Unsubscribe {
  // Copy-on-write so a hook that unsubscribes during a transition cannot disturb the iteration.
  hooks.set(state, [...(hooks.get(state) ?? []), hook]);
  return () => {
    hooks.set(
      state,
      (hooks.get(state) ?? []).filter((h) => h !== hook),
    );
  };
}
