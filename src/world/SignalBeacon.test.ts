import { describe, expect, it } from 'vitest';
import { BEACON_ANGULAR_SPEED, SignalBeacon } from './SignalBeacon';

describe('SignalBeacon (fixed-step beacon on the tower)', () => {
  it('starts at rest', () => {
    const beacon = new SignalBeacon();
    expect(beacon.angle).toBe(0);
    expect(beacon.previousAngle).toBe(0);
    expect(beacon.steps).toBe(0);
  });

  it('advances only in fixed steps, remembering the previous angle', () => {
    const beacon = new SignalBeacon();
    const dt = 1 / 60;
    beacon.fixedUpdate(dt);
    beacon.fixedUpdate(dt);

    expect(beacon.steps).toBe(2);
    expect(beacon.previousAngle).toBeCloseTo(BEACON_ANGULAR_SPEED * dt);
    expect(beacon.angle).toBeCloseTo(BEACON_ANGULAR_SPEED * dt * 2);
  });

  it('interpolates linearly between the previous and current step', () => {
    const beacon = new SignalBeacon();
    beacon.fixedUpdate(1 / 60);
    beacon.fixedUpdate(1 / 60);

    expect(beacon.interpolatedAngle(0)).toBe(beacon.previousAngle);
    expect(beacon.interpolatedAngle(0.5)).toBeCloseTo((beacon.previousAngle + beacon.angle) / 2);
    expect(beacon.interpolatedAngle(0.999)).toBeLessThan(beacon.angle);
  });

  it('turns a quarter circle per simulated second', () => {
    const beacon = new SignalBeacon();
    for (let i = 0; i < 60; i++) {
      beacon.fixedUpdate(1 / 60);
    }
    expect(beacon.angle).toBeCloseTo(Math.PI / 2);
  });
});
