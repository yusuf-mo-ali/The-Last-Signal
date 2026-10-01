/**
 * Signal Glitch maths (D-046): only during a burst, at most 3 tear patterns a second, the same
 * pattern for the same burst and step, a clear centre, and the reduced-motion variant.
 */

import { describe, expect, it } from 'vitest';
import { MUTATIONS } from '../config/mutations';
import { clampStaticParams, type ScreenBurst } from '../modifiers/ScreenEffects';
import { GLITCH_CLEAR, glitchFrame, glitchMask, IDLE_GLITCH, tearBands } from './glitch';

const params = (() => {
  const e = MUTATIONS.STATIC.effects.find((x) => x.kind === 'screen');
  if (!e) {
    throw new Error('no screen effect');
  }
  return clampStaticParams(e.params);
})();

const burst = (start = 10, length = 0.8): ScreenBurst => ({
  sourceId: 'mutation:STATIC',
  start,
  until: start + length,
  intensity: params.opacity,
  glitch: params.glitch ?? null,
});

describe('Signal Glitch frames (D-046)', () => {
  it('idle outside a burst, and for a burst without glitch params', () => {
    expect(glitchFrame(null, 5)).toBe(IDLE_GLITCH);
    expect(glitchFrame(burst(), 9.99)).toBe(IDLE_GLITCH);
    expect(glitchFrame(burst(), 10.8)).toBe(IDLE_GLITCH);
    expect(glitchFrame({ ...burst(), glitch: null }, 10.3)).toBe(IDLE_GLITCH);
  });

  it('follows the burst envelope: rises, holds, fades', () => {
    const b = burst();
    expect(glitchFrame(b, 10.03).envelope).toBeCloseTo(0.5, 6);
    expect(glitchFrame(b, 10.4).envelope).toBe(1);
    expect(glitchFrame(b, 10.74).envelope).toBeCloseTo(0.5, 6);
  });

  it('the tear pattern changes at most 3 times a second (photosensitivity)', () => {
    expect(params.glitch?.stepRate).toBeLessThanOrEqual(3);
    const b = burst(10, 0.8);
    const steps = new Set<number>();
    for (let t = 10; t < 10.8; t += 1 / 240) {
      const f = glitchFrame(b, t);
      if (f.active) {
        steps.add(f.step);
      }
    }
    // 0.8 s at ≤ 3 Hz: at most 3 patterns (0, 1, 2).
    expect(steps.size).toBeLessThanOrEqual(Math.ceil(0.8 * 3));
    // Within one step the bands are the very same.
    expect(glitchFrame(b, 10.05).bands).toEqual(glitchFrame(b, 10.3).bands);
    expect(glitchFrame(b, 10.05).bands).not.toEqual(glitchFrame(b, 10.4).bands);
  });

  it('bands are seeded: the same burst and step give the same bands; within range', () => {
    expect(tearBands(10, 1, 4)).toEqual(tearBands(10, 1, 4));
    expect(tearBands(10, 1, 4)).not.toEqual(tearBands(12, 1, 4));
    for (const band of tearBands(3.5, 2, 6)) {
      expect(band.center).toBeGreaterThan(0);
      expect(band.center).toBeLessThan(1);
      expect(band.halfHeight).toBeLessThanOrEqual(0.06);
      expect(Math.abs(band.shift)).toBeLessThanOrEqual(1);
    }
  });

  it('the centre around the crosshair is clear; the edges get it all', () => {
    const minSide = 768;
    expect(glitchMask(0, minSide)).toBe(0);
    expect(glitchMask(GLITCH_CLEAR.inner * minSide, minSide)).toBe(0);
    expect(glitchMask(GLITCH_CLEAR.outer * minSide, minSide)).toBe(1);
    expect(glitchMask(minSide, minSide)).toBe(1);
  });

  it('reduced motion: one still pattern, no tears, no afterimage, no lag; a colour split only', () => {
    const b = burst();
    const a = glitchFrame(b, 10.05, true);
    const later = glitchFrame(b, 10.5, true);
    expect(a.step).toBe(0);
    expect(later.step).toBe(0);
    expect(a.bands).toEqual([]);
    expect(a.params.maxShift).toBe(0);
    expect(a.params.ghost).toBe(0);
    expect(a.params.desync).toBe(0);
    expect(a.params.chroma).toBeGreaterThan(0);
  });
});
