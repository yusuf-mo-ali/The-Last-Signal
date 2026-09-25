/**
 * Frame-time recorder for the debug overlay (D-035). Implements `FrameProbe`, so it only costs
 * anything while attached to the game; detached, the game pays a single null check per frame.
 *
 * It records, per frame, when the frame started and how long our code took (fixed steps +
 * presentation). Storage is a fixed set of typed-array ring buffers: nothing is allocated per
 * frame. The clock is injected, so the statistics are unit-tested with exact timestamps.
 */

import type { FrameProbe } from '../core/Game';

export interface FrameStatsSnapshot {
  /** Frames in the sample window. */
  readonly samples: number;
  /** Frames per second over the window (from frame start times). */
  readonly fps: number;
  /** Average time between frame starts, in ms. */
  readonly frameIntervalMs: number;
  /** Our code's cost per frame (fixed steps + presentation), in ms. */
  readonly costAvgMs: number;
  readonly costP95Ms: number;
  readonly costMaxMs: number;
  /** Average fixed steps per frame. */
  readonly stepsPerFrame: number;
}

export class FrameStats implements FrameProbe {
  private readonly capacity: number;
  private readonly now: () => number;
  private readonly starts: Float64Array;
  private readonly costs: Float64Array;
  private readonly steps: Float64Array;
  private readonly scratch: Float64Array;
  private head = 0;
  private count = 0;
  private currentStart = 0;

  constructor(capacity: number, now: () => number) {
    if (!Number.isInteger(capacity) || capacity < 2) {
      throw new RangeError('FrameStats capacity must be an integer >= 2');
    }
    this.capacity = capacity;
    this.now = now;
    this.starts = new Float64Array(capacity);
    this.costs = new Float64Array(capacity);
    this.steps = new Float64Array(capacity);
    this.scratch = new Float64Array(capacity);
  }

  frameStart(): void {
    this.currentStart = this.now();
  }

  frameEnd(steps: number): void {
    const i = this.head;
    this.starts[i] = this.currentStart;
    this.costs[i] = this.now() - this.currentStart;
    this.steps[i] = steps;
    this.head = (i + 1) % this.capacity;
    this.count = Math.min(this.count + 1, this.capacity);
  }

  reset(): void {
    this.head = 0;
    this.count = 0;
  }

  snapshot(): FrameStatsSnapshot {
    const n = this.count;
    if (n === 0) {
      return {
        samples: 0,
        fps: 0,
        frameIntervalMs: 0,
        costAvgMs: 0,
        costP95Ms: 0,
        costMaxMs: 0,
        stepsPerFrame: 0,
      };
    }
    const oldest = n < this.capacity ? 0 : this.head;
    const newest = (this.head - 1 + this.capacity) % this.capacity;

    let costSum = 0;
    let costMax = 0;
    let stepSum = 0;
    for (let k = 0; k < n; k++) {
      const i = (oldest + k) % this.capacity;
      const cost = this.costs[i] ?? 0;
      costSum += cost;
      costMax = Math.max(costMax, cost);
      stepSum += this.steps[i] ?? 0;
      this.scratch[k] = cost;
    }
    const sorted = this.scratch.subarray(0, n).sort();
    const span = (this.starts[newest] ?? 0) - (this.starts[oldest] ?? 0);
    const interval = n > 1 ? span / (n - 1) : 0;

    return {
      samples: n,
      fps: interval > 0 ? 1000 / interval : 0,
      frameIntervalMs: interval,
      costAvgMs: costSum / n,
      costP95Ms: sorted[Math.min(n - 1, Math.floor(n * 0.95))] ?? 0,
      costMaxMs: costMax,
      stepsPerFrame: stepSum / n,
    };
  }
}
