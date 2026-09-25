import { describe, expect, it } from 'vitest';
import { deepFreeze, ENGINE_CONFIG } from './Config';
import { Time } from './Time';

describe('ENGINE_CONFIG', () => {
  it('keeps the engine defaults established in Phases 0.2–0.4', () => {
    expect(ENGINE_CONFIG.loop).toEqual({ fixedDt: 1 / 60, maxFrameDt: 0.25, maxStepsPerFrame: 5 });
    expect(ENGINE_CONFIG.render).toMatchObject({
      maxPixelRatio: 2,
      renderScale: 1,
      antialias: true,
      shadows: true,
    });
    expect(ENGINE_CONFIG.camera).toEqual({ fov: 60, near: 0.05, far: 500 });
    expect(ENGINE_CONFIG.input).toEqual({ maxMotionPerEvent: 1500, pointerLockTimeoutMs: 1000 });
  });

  it('has sane debug and error settings', () => {
    expect(ENGINE_CONFIG.debug.frameSampleSize).toBeGreaterThanOrEqual(2);
    expect(ENGINE_CONFIG.debug.overlayRefreshMs).toBeGreaterThan(0);
    expect(ENGINE_CONFIG.debug.overlayToggleKey).toBe('Backquote');
    expect(ENGINE_CONFIG.errors.maxReports).toBeGreaterThan(0);
    expect(ENGINE_CONFIG.render.contextRestoreTimeoutMs).toBeGreaterThan(0);
  });

  it('is deeply frozen, so no system can change a shared default at runtime', () => {
    expect(Object.isFrozen(ENGINE_CONFIG)).toBe(true);
    for (const section of Object.values(ENGINE_CONFIG)) {
      expect(Object.isFrozen(section)).toBe(true);
    }
    expect(() => {
      (ENGINE_CONFIG.loop as { fixedDt: number }).fixedDt = 1;
    }).toThrow(TypeError);
  });

  it('is the single source of the loop defaults (no duplicated constants)', () => {
    const time = new Time();
    expect(time.fixedDt).toBe(ENGINE_CONFIG.loop.fixedDt);
    expect(time.maxFrameDt).toBe(ENGINE_CONFIG.loop.maxFrameDt);
    expect(time.maxStepsPerFrame).toBe(ENGINE_CONFIG.loop.maxStepsPerFrame);
  });
});

describe('deepFreeze', () => {
  it('freezes nested objects and arrays and returns the same value', () => {
    const value = { a: { b: [1, { c: 2 }] } };
    expect(deepFreeze(value)).toBe(value);
    expect(Object.isFrozen(value.a.b)).toBe(true);
    expect(Object.isFrozen(value.a.b[1])).toBe(true);
  });

  it('leaves primitives and null alone', () => {
    expect(deepFreeze(3)).toBe(3);
    expect(deepFreeze(null)).toBeNull();
  });
});
