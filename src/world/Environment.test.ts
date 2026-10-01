/**
 * The environment state (D-028, D-045): overlays blend over the base by priority and fade in and
 * out in simulated time; the visibility floors hold whatever the overlays say.
 */

import { describe, expect, it } from 'vitest';
import { BASE_ENVIRONMENT, ENVIRONMENT_FLOORS, ENVIRONMENT_OVERLAYS } from '../config/environment';
import { Environment } from './Environment';

const DT = 1 / 60;
const step = (env: Environment, seconds: number) => {
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    env.fixedUpdate(DT);
  }
};
const snapshot = (env: Environment) => {
  const r = env.resolve();
  return { ...r, tint: [...r.tint], fog: [...r.fog] };
};

describe('Environment', () => {
  it('is the base look with no overlay', () => {
    const env = new Environment();
    expect(snapshot(env)).toEqual({
      ...BASE_ENVIRONMENT,
      tint: [...BASE_ENVIRONMENT.tint],
      fog: [...BASE_ENVIRONMENT.fog],
    });
  });

  it('fades a blackout in over its fade time, holds, and fades out when removed', () => {
    const env = new Environment();
    env.addOverlay('mutation:BLACKOUT', 'blackout', { priority: 20, fadeIn: 2, fadeOut: 1 });
    expect(env.resolve().ambient).toBe(1);
    step(env, 1);
    const half = env.resolve().ambient;
    expect(half).toBeCloseTo(1 + ((ENVIRONMENT_OVERLAYS.blackout.ambient ?? 0) - 1) * 0.5, 2);
    step(env, 1.5);
    const full = snapshot(env);
    expect(full.ambient).toBeCloseTo(ENVIRONMENT_OVERLAYS.blackout.ambient ?? 0);
    expect(full.emergency).toBe(1);
    expect(full.muzzleLight).toBe(1);
    env.removeSource('mutation:BLACKOUT');
    step(env, 0.5);
    expect(env.resolve().ambient).toBeGreaterThan(full.ambient);
    expect(env.resolve().ambient).toBeLessThan(1);
    step(env, 0.6);
    expect(env.resolve().ambient).toBe(1);
    expect(env.sources()).toEqual([]); // forgotten once faded
  });

  it('stands still when no steps run (paused)', () => {
    const env = new Environment();
    env.addOverlay('m', 'blackout', { priority: 20, fadeIn: 2, fadeOut: 1 });
    step(env, 1);
    const a = env.resolve().ambient;
    // Frames without fixed steps (paused) change nothing.
    expect(env.resolve().ambient).toBe(a);
    expect(env.resolve().ambient).toBe(a);
  });

  it('the higher priority wins where both set a channel; each keeps its own channels', () => {
    const env = new Environment();
    env.addOverlay('b', 'blackout', { priority: 20, fadeIn: 0, fadeOut: 0 });
    env.addOverlay('r', 'bloodMoon', { priority: 10, fadeIn: 0, fadeOut: 0 });
    const r = snapshot(env);
    expect(r.ambient).toBeCloseTo(ENVIRONMENT_OVERLAYS.blackout.ambient ?? 0);
    (ENVIRONMENT_OVERLAYS.blackout.fog ?? []).forEach((v, i) => {
      expect(r.fog[i]).toBeCloseTo(v, 9);
    });
    expect(env.status().map((o) => o.overlay)).toEqual(['bloodMoon', 'blackout']);
  });

  it('the visibility floors hold whatever an overlay asks for', () => {
    const env = new Environment();
    env.setBase({ ...BASE_ENVIRONMENT, ambient: 0.01, eyeGlow: 0, proximity: 0 });
    const r = env.resolve();
    expect(r.ambient).toBe(ENVIRONMENT_FLOORS.ambientFloor);
    expect(r.eyeGlow).toBeCloseTo(ENVIRONMENT_FLOORS.eyeGlowInDark);
    expect(r.proximity).toBeCloseTo(ENVIRONMENT_FLOORS.proximityInDark);
  });

  it('the eye and proximity floors apply only in the dark, in proportion to it', () => {
    const env = new Environment();
    const f = ENVIRONMENT_FLOORS;
    env.setBase({ ...BASE_ENVIRONMENT, ambient: f.darkBelow, eyeGlow: 0, proximity: 0 });
    expect(env.resolve().eyeGlow).toBe(0);
    expect(env.resolve().proximity).toBe(0);
    const half = (f.darkBelow + f.ambientFloor) / 2;
    env.setBase({ ...BASE_ENVIRONMENT, ambient: half, eyeGlow: 0, proximity: 0 });
    expect(env.resolve().eyeGlow).toBeCloseTo(f.eyeGlowInDark / 2);
    expect(env.resolve().proximity).toBeCloseTo(f.proximityInDark / 2);
    // The silhouette is never forced: only an overlay darkens bodies.
    expect(env.resolve().silhouette).toBe(0);
  });

  it('a full blackout gives silhouettes with glowing eyes, and fades back to normal', () => {
    const env = new Environment();
    env.addOverlay('m', 'blackout', { priority: 20, fadeIn: 1, fadeOut: 1 });
    step(env, 1.5);
    const r = env.resolve();
    expect(r.silhouette).toBeCloseTo(ENVIRONMENT_OVERLAYS.blackout.silhouette ?? 0);
    expect(r.eyeGlow).toBeGreaterThanOrEqual(ENVIRONMENT_FLOORS.eyeGlowInDark);
    expect(r.proximity).toBeGreaterThanOrEqual(ENVIRONMENT_FLOORS.proximityInDark);
    env.removeSource('m');
    step(env, 1.5);
    const after = env.resolve();
    expect([after.eyeGlow, after.silhouette, after.proximity, after.ambient]).toEqual([0, 0, 0, 1]);
  });

  it('restarting an overlay continues from its weight; immediate removal and clear are instant', () => {
    const env = new Environment();
    env.addOverlay('m', 'blackout', { priority: 20, fadeIn: 2, fadeOut: 2 });
    step(env, 1);
    const w = env.status()[0]?.weight ?? 0;
    env.addOverlay('m', 'blackout', { priority: 20, fadeIn: 2, fadeOut: 2 });
    expect(env.status()[0]?.weight).toBeCloseTo(w);
    env.removeSource('m', { immediate: true });
    expect(env.resolve().ambient).toBe(1);
    env.addOverlay('m', 'bloodMoon', { priority: 10, fadeIn: 0, fadeOut: 5 });
    env.clear();
    expect(env.sources()).toEqual([]);
  });
});
