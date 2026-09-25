/**
 * The game root: owns the simulation clock and the game-flow state machine, and runs the frame
 * loop described in ARCHITECTURE.md §3 (D-004).
 *
 * `Game` is simulation-layer code and never touches the browser. The frame source and the
 * presentation are injected:
 * - a `FrameScheduler` (in the browser, `requestAnimationFrame`; in tests, a manual queue),
 * - an optional `Presentation` that draws each frame. Without one the game runs headless (D-003).
 */

import { GameStateMachine, type GameStateId } from './GameState';
import { Time, type TimeOptions } from './Time';

/** A source of animation frames. `request` calls back with a timestamp in milliseconds. */
export interface FrameScheduler {
  request(callback: (timestampMs: number) => void): number;
  cancel(handle: number): void;
}

/** Anything advanced by the fixed simulation step. */
export interface FixedUpdateSystem {
  fixedUpdate(fixedDt: number): void;
}

/**
 * Draws a frame. Called once per frame after the fixed steps have run.
 * `alpha` in [0, 1) is how far time has progressed toward the next fixed step, for interpolation.
 */
export interface Presentation {
  render(alpha: number, frameDt: number): void;
}

export interface GameOptions {
  readonly time?: TimeOptions;
  /** Throw on illegal state transitions (dev builds and tests). */
  readonly strict?: boolean;
}

/** States in which simulated time stands still (ARCHITECTURE.md §3). */
export const FROZEN_STATES: ReadonlySet<GameStateId> = new Set<GameStateId>([
  'PAUSED',
  'UPGRADE_SELECTION',
]);

export class Game {
  readonly time: Time;
  readonly state: GameStateMachine;

  private systems: readonly FixedUpdateSystem[] = [];
  private presentation: Presentation | null = null;
  private scheduler: FrameScheduler | null = null;
  private frameHandle: number | null = null;
  private lastTimestampMs: number | null = null;
  private readonly unsubscribeState: () => void;

  constructor(options: GameOptions = {}) {
    this.time = new Time(options.time);
    this.state = new GameStateMachine({ strict: options.strict ?? false });
    this.unsubscribeState = this.state.onChange(({ to }) => {
      this.time.scale = FROZEN_STATES.has(to) ? 0 : 1;
    });
  }

  get isRunning(): boolean {
    return this.scheduler !== null;
  }

  /** Registers a system for the fixed step. Systems run in registration order. */
  addSystem(system: FixedUpdateSystem): () => void {
    this.systems = [...this.systems, system];
    return () => {
      this.systems = this.systems.filter((s) => s !== system);
    };
  }

  /**
   * Registers a system that runs *before* every other system in each fixed step, e.g. sampling
   * input so all systems in a step see the same input window.
   */
  prependSystem(system: FixedUpdateSystem): () => void {
    this.systems = [system, ...this.systems];
    return () => {
      this.systems = this.systems.filter((s) => s !== system);
    };
  }

  /** Sets (or, with `null`, removes) the presentation drawn each frame. */
  setPresentation(presentation: Presentation | null): void {
    this.presentation = presentation;
  }

  /**
   * Starts the frame loop. Leaves BOOT for MAIN_MENU on the first start ("boot complete").
   * Calling `start` while running does nothing.
   */
  start(scheduler: FrameScheduler): void {
    if (this.scheduler) {
      return;
    }
    if (this.state.current === 'BOOT') {
      this.state.transition('MAIN_MENU');
    }
    this.scheduler = scheduler;
    this.lastTimestampMs = null;
    this.frameHandle = scheduler.request(this.tick);
  }

  /** Stops the frame loop. Safe to call at any time, including from inside a frame. */
  stop(): void {
    if (this.scheduler && this.frameHandle !== null) {
      this.scheduler.cancel(this.frameHandle);
    }
    this.scheduler = null;
    this.frameHandle = null;
    this.lastTimestampMs = null;
  }

  /**
   * Runs one frame: the fixed steps owed for `frameDt` seconds, then the presentation.
   * The loop calls this; headless tests may call it directly. Returns the fixed steps run.
   */
  frame(frameDt: number): number {
    const steps = this.time.advance(frameDt, this.fixedStep);
    this.presentation?.render(this.time.alpha, frameDt);
    return steps;
  }

  /** Stops the loop and detaches everything. The game cannot be restarted afterwards. */
  dispose(): void {
    this.stop();
    this.unsubscribeState();
    this.systems = [];
    this.presentation = null;
  }

  // Arrow properties: stable callbacks for Time.advance and the scheduler, no per-frame binding.
  private readonly fixedStep = (fixedDt: number): void => {
    for (const system of this.systems) {
      system.fixedUpdate(fixedDt);
    }
  };

  private readonly tick = (timestampMs: number): void => {
    const scheduler = this.scheduler;
    if (!scheduler) {
      return;
    }
    const last = this.lastTimestampMs;
    this.lastTimestampMs = timestampMs;
    // The first frame after (re)starting has no previous timestamp, so it advances nothing.
    const frameDt = last === null ? 0 : (timestampMs - last) / 1000;

    try {
      this.frame(frameDt);
    } catch (error) {
      // Fail fast: an exception inside a frame would otherwise repeat every frame.
      this.stop();
      throw error;
    }

    // `frame` may have stopped (or restarted) the loop.
    if (this.scheduler === scheduler) {
      this.frameHandle = scheduler.request(this.tick);
    }
  };
}
