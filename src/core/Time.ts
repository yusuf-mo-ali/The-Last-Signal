/**
 * Fixed-timestep simulation clock (ARCHITECTURE.md §3, D-004).
 *
 * Each render frame calls `advance(frameDt, step)`. The clock accumulates scaled frame time and
 * calls `step(fixedDt)` once per whole fixed step owed. Frame time is clamped, and each frame runs
 * at most `maxStepsPerFrame` steps; any backlog beyond that is dropped rather than carried over,
 * so a long hitch or a background tab never causes a "spiral of death".
 *
 * The clock is pure: it never reads the wall clock, so tests drive it with exact frame times.
 */

import { ENGINE_CONFIG } from './Config';

export interface TimeOptions {
  /** Simulation step in seconds. Default: `ENGINE_CONFIG.loop` (1/60). */
  readonly fixedDt?: number;
  /** Largest frame time accepted, in seconds. Default: `ENGINE_CONFIG.loop` (0.25). */
  readonly maxFrameDt?: number;
  /** Most fixed steps run in one frame. Default: `ENGINE_CONFIG.loop` (5). */
  readonly maxStepsPerFrame?: number;
}

/** Absorbs floating-point error so e.g. two frames of 1/120 s owe exactly one step of 1/60 s. */
const EPSILON = 1e-9;

export type FixedStep = (fixedDt: number) => void;

export class Time {
  readonly fixedDt: number;
  readonly maxFrameDt: number;
  readonly maxStepsPerFrame: number;

  private accumulator = 0;
  private timeScale = 1;
  private steps = 0;
  private frames = 0;
  private unscaledTime = 0;
  private dropped = 0;

  constructor(options: TimeOptions = {}) {
    const defaults = ENGINE_CONFIG.loop;
    this.fixedDt = options.fixedDt ?? defaults.fixedDt;
    this.maxFrameDt = options.maxFrameDt ?? defaults.maxFrameDt;
    this.maxStepsPerFrame = options.maxStepsPerFrame ?? defaults.maxStepsPerFrame;

    if (!isPositiveFinite(this.fixedDt)) {
      throw new RangeError('fixedDt must be a positive finite number');
    }
    if (!isPositiveFinite(this.maxFrameDt)) {
      throw new RangeError('maxFrameDt must be a positive finite number');
    }
    if (!Number.isInteger(this.maxStepsPerFrame) || this.maxStepsPerFrame < 1) {
      throw new RangeError('maxStepsPerFrame must be a positive integer');
    }
  }

  /** Multiplier applied to frame time. 0 freezes the simulation (e.g. PAUSED). */
  get scale(): number {
    return this.timeScale;
  }

  set scale(value: number) {
    if (!Number.isFinite(value) || value < 0) {
      throw new RangeError('Time scale must be a finite number >= 0');
    }
    this.timeScale = value;
  }

  /** Simulated seconds: exactly `stepCount * fixedDt`, so it never drifts. */
  get simTime(): number {
    return this.steps * this.fixedDt;
  }

  /** Total fixed steps run since construction or `reset()`. */
  get stepCount(): number {
    return this.steps;
  }

  /** Total frames passed to `advance()`. */
  get frameCount(): number {
    return this.frames;
  }

  /** Sum of accepted (clamped, unscaled) frame times. Advances even while the scale is 0. */
  get realTime(): number {
    return this.unscaledTime;
  }

  /** Simulated seconds discarded because a frame owed more than `maxStepsPerFrame` steps. */
  get droppedTime(): number {
    return this.dropped;
  }

  /** How far the simulation is between the last step and the next, in [0, 1). For interpolation. */
  get alpha(): number {
    return Math.min(this.accumulator / this.fixedDt, 1 - Number.EPSILON);
  }

  /**
   * Advances the clock by one render frame and runs the fixed steps it owes.
   * Invalid frame times (negative, NaN, infinite) count as 0. Returns the number of steps run.
   */
  advance(frameDt: number, step: FixedStep): number {
    const dt = Number.isFinite(frameDt) && frameDt > 0 ? Math.min(frameDt, this.maxFrameDt) : 0;
    this.frames++;
    this.unscaledTime += dt;
    this.accumulator += dt * this.timeScale;

    let stepsThisFrame = 0;
    while (this.accumulator + EPSILON >= this.fixedDt && stepsThisFrame < this.maxStepsPerFrame) {
      this.accumulator = Math.max(0, this.accumulator - this.fixedDt);
      stepsThisFrame++;
      // `simTime` reads as the start of the current step while `step` runs.
      step(this.fixedDt);
      this.steps++;
    }

    if (this.accumulator + EPSILON >= this.fixedDt) {
      this.dropped += this.accumulator;
      this.accumulator = 0;
    }
    return stepsThisFrame;
  }

  /** Returns every counter to zero. Options and the current scale are kept. */
  reset(): void {
    this.accumulator = 0;
    this.steps = 0;
    this.frames = 0;
    this.unscaledTime = 0;
    this.dropped = 0;
  }
}

function isPositiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}
