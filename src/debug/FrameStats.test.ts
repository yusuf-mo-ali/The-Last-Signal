import { describe, expect, it } from 'vitest';
import { FrameStats } from './FrameStats';

/** Drives FrameStats with a fake clock: frames start every `interval` ms and cost `cost` ms. */
function run(
  stats: FrameStats,
  clock: { t: number },
  frames: number,
  interval: number,
  cost: number,
  steps = 1,
) {
  for (let i = 0; i < frames; i++) {
    stats.frameStart();
    clock.t += cost;
    stats.frameEnd(steps);
    clock.t += interval - cost;
  }
}

function setup(capacity = 120) {
  const clock = { t: 1000 };
  const stats = new FrameStats(capacity, () => clock.t);
  return { clock, stats };
}

describe('FrameStats', () => {
  it('is empty before any frame', () => {
    const { stats } = setup();
    expect(stats.snapshot()).toMatchObject({ samples: 0, fps: 0, costAvgMs: 0 });
  });

  it('measures FPS from frame start times and our cost per frame', () => {
    const { clock, stats } = setup();
    run(stats, clock, 60, 1000 / 60, 2);
    const s = stats.snapshot();
    expect(s.samples).toBe(60);
    expect(s.fps).toBeCloseTo(60, 6);
    expect(s.frameIntervalMs).toBeCloseTo(16.667, 2);
    expect(s.costAvgMs).toBeCloseTo(2);
    expect(s.costMaxMs).toBeCloseTo(2);
    expect(s.stepsPerFrame).toBe(1);
  });

  it('reports p95 and max cost, catching occasional spikes', () => {
    const { clock, stats } = setup(100);
    run(stats, clock, 94, 16, 1);
    run(stats, clock, 6, 16, 12); // 6% of frames spike
    const s = stats.snapshot();
    expect(s.costMaxMs).toBeCloseTo(12);
    expect(s.costP95Ms).toBeCloseTo(12);
    expect(s.costAvgMs).toBeCloseTo((94 * 1 + 6 * 12) / 100);
  });

  it('keeps only the most recent frames once the ring buffer wraps', () => {
    const { clock, stats } = setup(10);
    run(stats, clock, 50, 33, 20); // old: 30 FPS, expensive
    run(stats, clock, 10, 10, 1); // recent: 100 FPS, cheap
    const s = stats.snapshot();
    expect(s.samples).toBe(10);
    expect(s.fps).toBeCloseTo(100, 6);
    expect(s.costMaxMs).toBeCloseTo(1);
  });

  it('averages steps per frame (e.g. 144 Hz display, 60 Hz simulation)', () => {
    const { clock, stats } = setup();
    for (let i = 0; i < 12; i++) {
      run(stats, clock, 1, 7, 0.5, i % 12 < 5 ? 1 : 0);
    }
    expect(stats.snapshot().stepsPerFrame).toBeCloseTo(5 / 12);
  });

  it('reset() clears all samples', () => {
    const { clock, stats } = setup();
    run(stats, clock, 5, 16, 1);
    stats.reset();
    expect(stats.snapshot().samples).toBe(0);
  });

  it('rejects a capacity below 2', () => {
    expect(() => new FrameStats(1, () => 0)).toThrow(RangeError);
    expect(() => new FrameStats(2.5, () => 0)).toThrow(RangeError);
  });
});
