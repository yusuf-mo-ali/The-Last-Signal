import { describe, expect, it } from 'vitest';
import { ENGINE_CONFIG } from '../core/Config';
import { HeadBob } from './HeadBob';

const CONFIG = ENGINE_CONFIG.camera.headBob;
const WALK = 5;
const DT = 1 / 60;

function simulate(bob: HeadBob, seconds: number, speed: number, grounded = true) {
  let maxVertical = 0;
  let maxLateral = 0;
  for (let t = 0; t < seconds; t += DT) {
    const o = bob.update(DT, speed, WALK, grounded);
    maxVertical = Math.max(maxVertical, Math.abs(o.vertical));
    maxLateral = Math.max(maxLateral, Math.abs(o.lateral));
  }
  return { maxVertical, maxLateral };
}

describe('HeadBob', () => {
  it('is zero while standing still', () => {
    const bob = new HeadBob(CONFIG);
    const { maxVertical, maxLateral } = simulate(bob, 2, 0);
    expect(maxVertical).toBe(0);
    expect(maxLateral).toBe(0);
  });

  it('bobs subtly while walking: centimetres, at the configured amplitude', () => {
    const bob = new HeadBob(CONFIG);
    const { maxVertical, maxLateral } = simulate(bob, 3, WALK);
    expect(maxVertical).toBeGreaterThan(CONFIG.verticalAmplitude * 0.9);
    expect(maxVertical).toBeLessThanOrEqual(CONFIG.verticalAmplitude * 1.001);
    expect(maxLateral).toBeGreaterThan(CONFIG.lateralAmplitude * 0.9);
    expect(maxVertical).toBeLessThan(0.05);
  });

  it('bobs a little more when sprinting, capped at maxIntensity', () => {
    const walk = simulate(new HeadBob(CONFIG), 3, WALK).maxVertical;
    const sprint = simulate(new HeadBob(CONFIG), 3, WALK * 1.5).maxVertical;
    const absurd = simulate(new HeadBob(CONFIG), 3, WALK * 10).maxVertical;
    expect(sprint).toBeGreaterThan(walk);
    expect(absurd).toBeLessThanOrEqual(CONFIG.verticalAmplitude * CONFIG.maxIntensity * 1.001);
  });

  it('follows distance travelled: one cycle per stride length', () => {
    const bob = new HeadBob(CONFIG);
    bob.update(DT, WALK, WALK, true);
    const phasePerMetre = bob.phase / (WALK * DT);
    expect(phasePerMetre).toBeCloseTo((2 * Math.PI) / CONFIG.strideLength);
  });

  it('fades out smoothly after stopping and while airborne', () => {
    for (const [speed, grounded] of [
      [0, true],
      [WALK, false],
    ] as const) {
      const bob = new HeadBob(CONFIG);
      simulate(bob, 2, WALK);
      const before = bob.intensity;
      bob.update(DT, speed, WALK, grounded);
      expect(bob.intensity).toBeLessThan(before);
      expect(bob.intensity).toBeGreaterThan(before * 0.5); // eased, not cut
      simulate(bob, 1.5, speed, grounded);
      expect(bob.intensity).toBeLessThan(1e-4);
    }
  });

  it('holds still with a zero time step (paused)', () => {
    const bob = new HeadBob(CONFIG);
    simulate(bob, 1, WALK);
    const { phase, intensity } = bob;
    bob.update(0, WALK, WALK, true);
    expect(bob.phase).toBe(phase);
    expect(bob.intensity).toBe(intensity);
  });

  it('does nothing when disabled', () => {
    const bob = new HeadBob(CONFIG);
    simulate(bob, 1, WALK);
    bob.enabled = false;
    const { maxVertical, maxLateral } = simulate(bob, 1, WALK);
    expect(maxVertical).toBe(0);
    expect(maxLateral).toBe(0);
  });
});
