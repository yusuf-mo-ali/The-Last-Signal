import { describe, expect, it } from 'vitest';
import { BEACON_ANGULAR_SPEED, TestScene } from './TestScene';

describe('TestScene (fixed-step demo simulation)', () => {
  it('starts at rest', () => {
    const scene = new TestScene();
    expect(scene.angle).toBe(0);
    expect(scene.previousAngle).toBe(0);
    expect(scene.steps).toBe(0);
  });

  it('advances only in fixed steps, remembering the previous angle', () => {
    const scene = new TestScene();
    const dt = 1 / 60;
    scene.fixedUpdate(dt);
    scene.fixedUpdate(dt);

    expect(scene.steps).toBe(2);
    expect(scene.previousAngle).toBeCloseTo(BEACON_ANGULAR_SPEED * dt);
    expect(scene.angle).toBeCloseTo(BEACON_ANGULAR_SPEED * dt * 2);
  });

  it('interpolates linearly between the previous and current step', () => {
    const scene = new TestScene();
    scene.fixedUpdate(1 / 60);
    scene.fixedUpdate(1 / 60);

    expect(scene.interpolatedAngle(0)).toBe(scene.previousAngle);
    expect(scene.interpolatedAngle(0.5)).toBeCloseTo((scene.previousAngle + scene.angle) / 2);
    expect(scene.interpolatedAngle(0.999)).toBeLessThan(scene.angle);
  });

  it('turns a quarter circle per simulated second', () => {
    const scene = new TestScene();
    for (let i = 0; i < 60; i++) {
      scene.fixedUpdate(1 / 60);
    }
    expect(scene.angle).toBeCloseTo(Math.PI / 2);
  });
});
