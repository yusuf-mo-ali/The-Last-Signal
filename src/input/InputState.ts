/**
 * Browser-independent input state (ARCHITECTURE.md §2 platform layer, D-034).
 *
 * `InputState` receives raw events (from `BrowserInput` in the browser, or directly in tests) and
 * keeps two kinds of information:
 * - **held state**: which keys and mouse buttons are down right now;
 * - **running totals**: how many times each key/button was pressed and released, how far the mouse
 *   moved, how many wheel steps occurred. Totals only ever grow.
 *
 * Consumers never clear shared state. Each one owns an `InputReader`, which samples the totals and
 * answers "what happened between my previous sample and my latest one". The frame reader samples
 * once per render frame and the simulation's reader once per fixed step, so each consumer sees
 * every press exactly once, whatever the ratio of frames to steps (a 240 Hz frame may run no
 * fixed step; a hitch may run five).
 */

import { ENGINE_CONFIG } from '../core/Config';

export interface InputStateOptions {
  /**
   * A single mouse-move event larger than this (in either axis, CSS pixels) is discarded as a
   * browser glitch rather than turning the camera (D-017). Default: `ENGINE_CONFIG.input`.
   */
  readonly maxMotionPerEvent?: number;
}

/** `WheelEvent.deltaMode` values. */
export const WheelDeltaMode = { PIXEL: 0, LINE: 1, PAGE: 2 } as const;

/** Wheel distance that counts as one notch ("step"), per delta mode. */
const WHEEL_UNITS_PER_STEP: Readonly<Record<number, number>> = {
  [WheelDeltaMode.PIXEL]: 100, // Chrome/Edge: 100 px per notch
  [WheelDeltaMode.LINE]: 3, // Firefox: 3 lines per notch
  [WheelDeltaMode.PAGE]: 1,
};

const WHEEL_EPSILON = 1e-9;

/** Continuous quantities, as running totals. */
export interface InputTotals {
  motionX: number;
  motionY: number;
  wheelDown: number;
  wheelUp: number;
}

/** Held state and press/release totals for one kind of input (keys or mouse buttons). */
class EdgeCounter<K> {
  readonly held = new Set<K>();
  readonly presses = new Map<K, number>();
  readonly releases = new Map<K, number>();

  down(k: K): void {
    if (this.held.has(k)) {
      return; // auto-repeat or a duplicate event: not a new press
    }
    this.held.add(k);
    this.presses.set(k, (this.presses.get(k) ?? 0) + 1);
  }

  up(k: K): void {
    if (!this.held.delete(k)) {
      return; // released without a recorded press (e.g. pressed before focus): ignore
    }
    this.releases.set(k, (this.releases.get(k) ?? 0) + 1);
  }

  releaseAll(): void {
    for (const k of [...this.held]) {
      this.up(k);
    }
  }
}

export class InputState {
  /** @internal Shared with readers. */
  readonly keys = new EdgeCounter<string>();
  /** @internal Shared with readers. */
  readonly buttons = new EdgeCounter<number>();

  private motionX = 0;
  private motionY = 0;
  private wheelDown = 0;
  private wheelUp = 0;
  private wheelRemainder = 0;
  private discarded = 0;
  private readonly maxMotionPerEvent: number;

  constructor(options: InputStateOptions = {}) {
    this.maxMotionPerEvent = options.maxMotionPerEvent ?? ENGINE_CONFIG.input.maxMotionPerEvent;
  }

  // ---- raw events --------------------------------------------------------------------------

  /** `code` is `KeyboardEvent.code` (physical key). Repeats while held are ignored. */
  keyDown(code: string): void {
    if (code !== '') {
      this.keys.down(code);
    }
  }

  keyUp(code: string): void {
    this.keys.up(code);
  }

  /** `button` is `MouseEvent.button`. */
  buttonDown(button: number): void {
    this.buttons.down(button);
  }

  buttonUp(button: number): void {
    this.buttons.up(button);
  }

  /** Relative mouse motion in CSS pixels (`movementX/Y`). Glitch-sized or invalid events are dropped. */
  mouseMove(dx: number, dy: number): void {
    if (
      !Number.isFinite(dx) ||
      !Number.isFinite(dy) ||
      Math.abs(dx) > this.maxMotionPerEvent ||
      Math.abs(dy) > this.maxMotionPerEvent
    ) {
      this.discarded++;
      return;
    }
    this.motionX += dx;
    this.motionY += dy;
  }

  /**
   * Wheel motion (`WheelEvent.deltaY`, positive = down, and `deltaMode`). Converted to whole
   * notches; fractional trackpad motion accumulates until it makes a full notch.
   */
  wheel(deltaY: number, deltaMode: number = WheelDeltaMode.PIXEL): void {
    const unitsPerStep = WHEEL_UNITS_PER_STEP[deltaMode];
    if (!Number.isFinite(deltaY) || unitsPerStep === undefined) {
      return;
    }
    this.wheelRemainder += deltaY / unitsPerStep;
    // The tolerance absorbs floating-point error: 7 × 30 px + 90 px is exactly 3 notches, but the
    // divided sum lands at 2.9999999999999996, which would otherwise lose a notch.
    const steps = Math.trunc(this.wheelRemainder + Math.sign(this.wheelRemainder) * WHEEL_EPSILON);
    if (steps > 0) {
      this.wheelDown += steps;
    } else if (steps < 0) {
      this.wheelUp -= steps;
    }
    this.wheelRemainder -= steps;
  }

  /** Releases every held key and button, recording the releases (e.g. on window blur). */
  releaseAll(): void {
    this.keys.releaseAll();
    this.buttons.releaseAll();
    this.wheelRemainder = 0;
  }

  // ---- live queries ------------------------------------------------------------------------

  isKeyDown(code: string): boolean {
    return this.keys.held.has(code);
  }

  isButtonDown(button: number): boolean {
    return this.buttons.held.has(button);
  }

  /** Mouse-move events dropped as glitches since creation. */
  get discardedMotionEvents(): number {
    return this.discarded;
  }

  /** @internal Copies the running totals into `out` (readers reuse their objects). */
  readTotals(out: InputTotals): void {
    out.motionX = this.motionX;
    out.motionY = this.motionY;
    out.wheelDown = this.wheelDown;
    out.wheelUp = this.wheelUp;
  }

  /** Creates a reader positioned at "now": it reports nothing that happened before it existed. */
  createReader(): InputReader {
    return new InputReader(this);
  }
}

/** Press/release counts of one kind of input at the reader's previous and latest samples. */
class EdgeWindow<K> {
  private readonly prevPresses = new Map<K, number>();
  private readonly currPresses = new Map<K, number>();
  private readonly prevReleases = new Map<K, number>();
  private readonly currReleases = new Map<K, number>();

  private readonly counter: EdgeCounter<K>;

  constructor(counter: EdgeCounter<K>) {
    this.counter = counter;
    this.discard();
  }

  sample(): void {
    advance(this.prevPresses, this.currPresses, this.counter.presses);
    advance(this.prevReleases, this.currReleases, this.counter.releases);
  }

  discard(): void {
    copyInto(this.prevPresses, this.counter.presses);
    copyInto(this.currPresses, this.counter.presses);
    copyInto(this.prevReleases, this.counter.releases);
    copyInto(this.currReleases, this.counter.releases);
  }

  pressed(k: K): boolean {
    return (this.currPresses.get(k) ?? 0) > (this.prevPresses.get(k) ?? 0);
  }

  released(k: K): boolean {
    return (this.currReleases.get(k) ?? 0) > (this.prevReleases.get(k) ?? 0);
  }
}

/**
 * One consumer's view of input. Call `sample()` at the start of each of your updates; the `was*`
 * queries and deltas then describe everything that happened since your previous `sample()`.
 * Held-state queries (`isKeyDown`, `isButtonDown`) are always live.
 */
export class InputReader {
  private readonly state: InputState;
  private readonly keyWindow: EdgeWindow<string>;
  private readonly buttonWindow: EdgeWindow<number>;
  // Two reusable objects, swapped on each sample: no allocation per frame or step.
  private prevTotals: InputTotals = { motionX: 0, motionY: 0, wheelDown: 0, wheelUp: 0 };
  private currTotals: InputTotals = { motionX: 0, motionY: 0, wheelDown: 0, wheelUp: 0 };

  constructor(state: InputState) {
    this.state = state;
    this.keyWindow = new EdgeWindow(state.keys);
    this.buttonWindow = new EdgeWindow(state.buttons);
    this.discard();
  }

  /** Starts a new window: everything since the previous sample becomes visible to the queries. */
  sample(): void {
    this.keyWindow.sample();
    this.buttonWindow.sample();
    const recycled = this.prevTotals;
    this.prevTotals = this.currTotals;
    this.state.readTotals(recycled);
    this.currTotals = recycled;
  }

  /** Forgets everything up to now, e.g. input gathered while the game was paused. */
  discard(): void {
    this.keyWindow.discard();
    this.buttonWindow.discard();
    this.state.readTotals(this.prevTotals);
    this.state.readTotals(this.currTotals);
  }

  isKeyDown(code: string): boolean {
    return this.state.isKeyDown(code);
  }

  isButtonDown(button: number): boolean {
    return this.state.isButtonDown(button);
  }

  /** True if `code` went down at least once in this window (even if already released again). */
  wasKeyPressed(code: string): boolean {
    return this.keyWindow.pressed(code);
  }

  wasKeyReleased(code: string): boolean {
    return this.keyWindow.released(code);
  }

  wasButtonPressed(button: number): boolean {
    return this.buttonWindow.pressed(button);
  }

  wasButtonReleased(button: number): boolean {
    return this.buttonWindow.released(button);
  }

  /** Mouse motion accumulated in this window, in CSS pixels (right and down are positive). */
  get mouseDeltaX(): number {
    return this.currTotals.motionX - this.prevTotals.motionX;
  }

  get mouseDeltaY(): number {
    return this.currTotals.motionY - this.prevTotals.motionY;
  }

  /** Whole wheel notches toward the user ("down") in this window. */
  get wheelStepsDown(): number {
    return this.currTotals.wheelDown - this.prevTotals.wheelDown;
  }

  /** Whole wheel notches away from the user ("up") in this window. */
  get wheelStepsUp(): number {
    return this.currTotals.wheelUp - this.prevTotals.wheelUp;
  }
}

/** prev ← curr, curr ← source, updating the maps in place (no allocation once warm). */
function advance<K>(prev: Map<K, number>, curr: Map<K, number>, source: ReadonlyMap<K, number>) {
  for (const [k, v] of curr) {
    prev.set(k, v);
  }
  copyInto(curr, source);
}

function copyInto<K>(target: Map<K, number>, source: ReadonlyMap<K, number>): void {
  for (const [k, v] of source) {
    target.set(k, v);
  }
}
