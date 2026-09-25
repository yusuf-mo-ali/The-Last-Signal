import { describe, expect, it } from 'vitest';
import { deepFreeze, ENGINE_CONFIG, GRAPHICS_PRESET_IDS, parseGraphicsPreset } from './Config';
import { Time } from './Time';

describe('ENGINE_CONFIG', () => {
  it('keeps the engine defaults established in Phases 0.2–0.4', () => {
    expect(ENGINE_CONFIG.loop).toEqual({ fixedDt: 1 / 60, maxFrameDt: 0.25, maxStepsPerFrame: 5 });
    expect(ENGINE_CONFIG.camera).toMatchObject({ near: 0.05, far: 500 });
    expect(ENGINE_CONFIG.view.fov).toBe(60);
    expect(ENGINE_CONFIG.input).toEqual({ maxMotionPerEvent: 1500, pointerLockTimeoutMs: 1000 });
  });

  it('has sane look and view defaults (D-038)', () => {
    const { camera, view } = ENGINE_CONFIG;
    expect(camera.pitchLimitDeg).toBeGreaterThan(80);
    expect(camera.pitchLimitDeg).toBeLessThan(90);
    expect(camera.radiansPerPixel).toBeGreaterThan(0);
    expect(camera.headBob.verticalAmplitude).toBeGreaterThan(0);
    expect(camera.headBob.verticalAmplitude).toBeLessThanOrEqual(0.05); // subtle
    expect(camera.headBob.strideLength).toBeGreaterThan(0);
    expect(view).toEqual({ fov: 60, sensitivity: 1, invertY: false, headBob: true });
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

describe('graphics quality presets (D-037)', () => {
  const { presets, defaultPreset } = ENGINE_CONFIG.graphics;

  it('defines every preset, and the default is one of them', () => {
    expect(Object.keys(presets).sort()).toEqual([...GRAPHICS_PRESET_IDS].sort());
    expect(GRAPHICS_PRESET_IDS).toContain(defaultPreset);
  });

  it('never gets cheaper as the preset goes up', () => {
    for (let i = 1; i < GRAPHICS_PRESET_IDS.length; i++) {
      const lower = presets[GRAPHICS_PRESET_IDS[i - 1] ?? 'low'];
      const higher = presets[GRAPHICS_PRESET_IDS[i] ?? 'low'];
      expect(higher.maxPixelRatio).toBeGreaterThanOrEqual(lower.maxPixelRatio);
      expect(higher.renderScale).toBeGreaterThanOrEqual(lower.renderScale);
      expect(higher.shadows.mapSize).toBeGreaterThanOrEqual(lower.shadows.mapSize);
      expect(higher.shadows.maxCasters).toBeGreaterThanOrEqual(lower.shadows.maxCasters);
    }
  });

  it('keeps settings in range: power-of-two shadow maps, positive scales', () => {
    for (const id of GRAPHICS_PRESET_IDS) {
      const p = presets[id];
      expect(p.renderScale).toBeGreaterThan(0);
      expect(p.renderScale).toBeLessThanOrEqual(1);
      expect(p.maxPixelRatio).toBeGreaterThanOrEqual(1);
      expect(Math.log2(p.shadows.mapSize) % 1).toBe(0);
    }
  });

  it('parses a preset id from a query value, and rejects anything else', () => {
    expect(parseGraphicsPreset('ultra')).toBe('ultra');
    expect(parseGraphicsPreset(' Low ')).toBe('low');
    expect(parseGraphicsPreset('extreme')).toBeNull();
    expect(parseGraphicsPreset('')).toBeNull();
    expect(parseGraphicsPreset(null)).toBeNull();
    expect(parseGraphicsPreset(undefined)).toBeNull();
    expect(parseGraphicsPreset('__proto__')).toBeNull();
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
