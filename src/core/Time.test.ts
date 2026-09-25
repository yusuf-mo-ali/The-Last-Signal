import { describe, expect, it } from 'vitest';
import { Rng } from '../utils/Rng';
import { DEFAULT_FIXED_DT, Time } from './Time';

const noop = (): void => undefined;

/** Advances `time` by `frames` frames of `dt` and returns the total steps run. */
function run(time: Time, dt: number, frames: number): number {
  let steps = 0;
  for (let i = 0; i < frames; i++) {
    steps += time.advance(dt, noop);
  }
  return steps;
}

describe('Time', () => {
  it('defaults to a 1/60 s step, a 0.25 s frame clamp and 5 steps per frame', () => {
    const time = new Time();
    expect(time.fixedDt).toBe(DEFAULT_FIXED_DT);
    expect(time.fixedDt).toBeCloseTo(1 / 60);
    expect(time.maxFrameDt).toBe(0.25);
    expect(time.maxStepsPerFrame).toBe(5);
    expect(time.scale).toBe(1);
  });

  it('runs exactly one step per 1/60 s frame and passes fixedDt to the step', () => {
    const time = new Time();
    const received: number[] = [];

    for (let i = 0; i < 60; i++) {
      expect(time.advance(1 / 60, (dt) => received.push(dt))).toBe(1);
    }

    expect(received).toHaveLength(60);
    expect(received.every((dt) => dt === time.fixedDt)).toBe(true);
    expect(time.stepCount).toBe(60);
    expect(time.simTime).toBeCloseTo(1);
  });

  it('runs one step every second frame at 120 FPS', () => {
    const time = new Time();
    const perFrame = Array.from({ length: 6 }, () => time.advance(1 / 120, noop));
    expect(perFrame).toEqual([0, 1, 0, 1, 0, 1]);
  });

  it('runs two steps per frame at 30 FPS', () => {
    const time = new Time();
    expect(run(time, 1 / 30, 30)).toBe(60);
  });

  it('carries fractional time between frames instead of losing it', () => {
    const time = new Time();
    // 144 FPS for one simulated second: steps must track elapsed time within one step.
    const steps = run(time, 1 / 144, 144);
    expect(Math.abs(steps - 60)).toBeLessThanOrEqual(1);
  });

  it('keeps simulated time in lockstep with real time over a long, jittery session', () => {
    const time = new Time();
    const rng = new Rng(42);
    let elapsed = 0;
    for (let i = 0; i < 10_000; i++) {
      const dt = rng.range(0.004, 0.05); // 20–250 FPS, always within the clamp
      elapsed += dt;
      time.advance(dt, noop);
    }
    expect(time.droppedTime).toBe(0);
    expect(Math.abs(time.simTime - elapsed)).toBeLessThan(time.fixedDt);
    expect(time.realTime).toBeCloseTo(elapsed, 6);
  });

  it('exposes simTime at the start of the current step while the step runs', () => {
    const time = new Time();
    const seen: number[] = [];
    time.advance(3 / 60, () => seen.push(time.simTime));
    expect(seen.map((t) => Math.round(t * 60))).toEqual([0, 1, 2]);
    expect(time.stepCount).toBe(3);
  });

  describe('alpha (interpolation factor)', () => {
    it('reports how far the clock is between steps', () => {
      const time = new Time();
      time.advance(1 / 120, noop);
      expect(time.alpha).toBeCloseTo(0.5);
      time.advance(1 / 120, noop);
      expect(time.alpha).toBeCloseTo(0);
    });

    it('stays in [0, 1)', () => {
      const time = new Time();
      const rng = new Rng(7);
      for (let i = 0; i < 1000; i++) {
        time.advance(rng.range(0, 0.1), noop);
        expect(time.alpha).toBeGreaterThanOrEqual(0);
        expect(time.alpha).toBeLessThan(1);
      }
    });
  });

  describe('hitches and invalid frame times', () => {
    it('clamps a long frame to maxFrameDt and caps it at maxStepsPerFrame, dropping the backlog', () => {
      const time = new Time();
      // A 3 s hitch is clamped to 0.25 s (15 steps owed), but only 5 steps may run.
      expect(time.advance(3, noop)).toBe(5);
      expect(time.realTime).toBeCloseTo(0.25);
      expect(time.droppedTime).toBeCloseTo(10 / 60);
      expect(time.alpha).toBe(0);
      // The next normal frame runs normally: no spiral of death.
      expect(time.advance(1 / 60, noop)).toBe(1);
    });

    it('does not drop anything when a frame owes exactly maxStepsPerFrame steps', () => {
      const time = new Time();
      expect(time.advance(5 / 60, noop)).toBe(5);
      expect(time.droppedTime).toBe(0);
    });

    it('treats negative, NaN and infinite frame times as zero', () => {
      const time = new Time();
      for (const dt of [-1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
        expect(time.advance(dt, noop)).toBe(0);
      }
      expect(time.realTime).toBe(0);
      expect(time.frameCount).toBe(4);
    });
  });

  describe('time scale', () => {
    it('freezes the simulation at scale 0 while real time keeps advancing', () => {
      const time = new Time();
      time.scale = 0;
      expect(run(time, 1 / 60, 30)).toBe(0);
      expect(time.stepCount).toBe(0);
      expect(time.realTime).toBeCloseTo(0.5);
    });

    it('does not release a burst of steps when unpausing', () => {
      const time = new Time();
      time.scale = 0;
      run(time, 1 / 60, 600); // ten seconds paused
      time.scale = 1;
      expect(time.advance(1 / 60, noop)).toBe(1);
    });

    it('runs at half speed at scale 0.5', () => {
      const time = new Time();
      time.scale = 0.5;
      expect(run(time, 1 / 60, 60)).toBe(30);
    });

    it('rejects a negative or non-finite scale', () => {
      const time = new Time();
      for (const bad of [-0.1, Number.NaN, Number.POSITIVE_INFINITY]) {
        expect(() => {
          time.scale = bad;
        }).toThrow(RangeError);
      }
      expect(time.scale).toBe(1);
    });
  });

  it('reset() zeroes the counters but keeps options and scale', () => {
    const time = new Time({ fixedDt: 1 / 30 });
    time.scale = 0.5;
    run(time, 0.1, 10);
    time.advance(3, noop);

    time.reset();

    expect(time.stepCount).toBe(0);
    expect(time.frameCount).toBe(0);
    expect(time.simTime).toBe(0);
    expect(time.realTime).toBe(0);
    expect(time.droppedTime).toBe(0);
    expect(time.alpha).toBe(0);
    expect(time.fixedDt).toBe(1 / 30);
    expect(time.scale).toBe(0.5);
  });

  it('accepts custom options', () => {
    const time = new Time({ fixedDt: 0.1, maxFrameDt: 1, maxStepsPerFrame: 2 });
    expect(time.advance(0.35, noop)).toBe(2);
    expect(time.droppedTime).toBeCloseTo(0.15);
  });

  it('rejects invalid options', () => {
    expect(() => new Time({ fixedDt: 0 })).toThrow(RangeError);
    expect(() => new Time({ fixedDt: -1 })).toThrow(RangeError);
    expect(() => new Time({ fixedDt: Number.NaN })).toThrow(RangeError);
    expect(() => new Time({ maxFrameDt: 0 })).toThrow(RangeError);
    expect(() => new Time({ maxStepsPerFrame: 0 })).toThrow(RangeError);
    expect(() => new Time({ maxStepsPerFrame: 2.5 })).toThrow(RangeError);
  });
});
