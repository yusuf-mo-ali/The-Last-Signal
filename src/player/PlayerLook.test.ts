import { describe, expect, it } from 'vitest';
import { ENGINE_CONFIG } from '../core/Config';
import { PlayerLook, wrapAngle, type LookSettings } from './PlayerLook';

const SETTINGS: LookSettings = {
  radiansPerPixel: 0.002,
  sensitivity: 1,
  invertY: false,
  pitchLimitDeg: 89,
};
const LIMIT = (89 * Math.PI) / 180;

describe('PlayerLook', () => {
  it('turns right (yaw decreases) for rightward mouse motion, left for leftward', () => {
    const look = new PlayerLook(SETTINGS);
    look.applyMouseDelta(100, 0);
    expect(look.yaw).toBeCloseTo(-0.2);
    look.applyMouseDelta(-300, 0);
    expect(look.yaw).toBeCloseTo(0.4);
    expect(look.pitch).toBe(0);
  });

  it('looks up for upward mouse motion (negative y), down for downward', () => {
    const look = new PlayerLook(SETTINGS);
    look.applyMouseDelta(0, -100);
    expect(look.pitch).toBeCloseTo(0.2);
    look.applyMouseDelta(0, 200);
    expect(look.pitch).toBeCloseTo(-0.2);
  });

  it('inverts the vertical axis when asked', () => {
    const look = new PlayerLook({ ...SETTINGS, invertY: true });
    look.applyMouseDelta(0, -100);
    expect(look.pitch).toBeCloseTo(-0.2);
  });

  it('scales rotation with sensitivity', () => {
    const slow = new PlayerLook({ ...SETTINGS, sensitivity: 0.5 });
    const fast = new PlayerLook({ ...SETTINGS, sensitivity: 2 });
    slow.applyMouseDelta(100, 50);
    fast.applyMouseDelta(100, 50);
    expect(fast.yaw).toBeCloseTo(slow.yaw * 4);
    expect(fast.pitch).toBeCloseTo(slow.pitch * 4);
  });

  it('clamps pitch just short of straight up and down', () => {
    const look = new PlayerLook(SETTINGS);
    look.applyMouseDelta(0, -100_000);
    expect(look.pitch).toBeCloseTo(LIMIT);
    look.applyMouseDelta(0, 100_000);
    expect(look.pitch).toBeCloseTo(-LIMIT);
    // Coming back from the clamp responds immediately (no stored overshoot).
    look.applyMouseDelta(0, -50);
    expect(look.pitch).toBeCloseTo(-LIMIT + 0.1);
  });

  it('wraps yaw so it never grows without bound', () => {
    const look = new PlayerLook(SETTINGS);
    for (let i = 0; i < 1000; i++) {
      look.applyMouseDelta(1000, 0);
    }
    expect(look.yaw).toBeGreaterThanOrEqual(-Math.PI);
    expect(look.yaw).toBeLessThan(Math.PI);
    expect(wrapAngle(3 * Math.PI)).toBeCloseTo(-Math.PI);
    expect(wrapAngle(-Math.PI / 2)).toBeCloseTo(-Math.PI / 2);
    expect(wrapAngle(2 * Math.PI + 0.5)).toBeCloseTo(0.5);
  });

  it('sets angles directly, clamping pitch; new settings re-clamp', () => {
    const look = new PlayerLook(SETTINGS);
    look.setAngles(1, 2);
    expect(look.yaw).toBe(1);
    expect(look.pitch).toBeCloseTo(LIMIT);
    look.setSettings({ ...SETTINGS, pitchLimitDeg: 45 });
    expect(look.pitch).toBeCloseTo(Math.PI / 4);
    expect(look.getSettings().pitchLimitDeg).toBe(45);
  });

  it('rejects nonsensical settings', () => {
    expect(() => new PlayerLook({ ...SETTINGS, sensitivity: 0 })).toThrow(RangeError);
    expect(() => new PlayerLook({ ...SETTINGS, radiansPerPixel: Number.NaN })).toThrow(RangeError);
    expect(() => new PlayerLook({ ...SETTINGS, pitchLimitDeg: 90 })).toThrow(RangeError);
  });

  it('uses a sane default: a full turn takes a few thousand pixels of mouse motion', () => {
    const pixelsPerTurn = (2 * Math.PI) / ENGINE_CONFIG.camera.radiansPerPixel;
    expect(pixelsPerTurn).toBeGreaterThan(1500);
    expect(pixelsPerTurn).toBeLessThan(5000);
  });

  describe('recoil (D-040)', () => {
    const DEG = Math.PI / 180;

    it('kicks the view up and sideways, remembering only the upward kick', () => {
      const look = new PlayerLook(SETTINGS);
      look.addRecoil(1 * DEG, 0.5 * DEG);
      expect(look.pitch).toBeCloseTo(1 * DEG);
      expect(look.yaw).toBeCloseTo(0.5 * DEG);
      expect(look.recoilPitch).toBeCloseTo(1 * DEG);
    });

    it('settles the kick back down at the given rate, never past where the player aimed', () => {
      const look = new PlayerLook(SETTINGS);
      look.setAngles(0, 0.2);
      look.addRecoil(1 * DEG, 0);
      look.recoverRecoil(0.4 * DEG);
      expect(look.pitch).toBeCloseTo(0.2 + 0.6 * DEG);
      look.recoverRecoil(10 * DEG);
      expect(look.pitch).toBeCloseTo(0.2);
      expect(look.recoilPitch).toBe(0);
      look.recoverRecoil(10 * DEG);
      expect(look.pitch).toBeCloseTo(0.2); // nothing left to recover
    });

    it('counts the player pulling down against the kick as recovery', () => {
      const look = new PlayerLook(SETTINGS);
      look.addRecoil(0.1, 0);
      look.applyMouseDelta(0, 30); // pull down 0.06 rad
      expect(look.recoilPitch).toBeCloseTo(0.04);
      look.applyMouseDelta(0, 100); // pull further down than the kick
      expect(look.recoilPitch).toBe(0);
      const pitch = look.pitch;
      look.recoverRecoil(1);
      expect(look.pitch).toBe(pitch); // the player's own aim is never undone
    });

    it('does not count looking up as recovery', () => {
      const look = new PlayerLook(SETTINGS);
      look.addRecoil(0.1, 0);
      look.applyMouseDelta(0, -50);
      expect(look.recoilPitch).toBeCloseTo(0.1);
    });

    it('respects the pitch clamp: a kick at the limit adds nothing to recover', () => {
      const look = new PlayerLook(SETTINGS);
      look.setAngles(0, 2); // clamped to the limit
      look.addRecoil(0.1, 0);
      expect(look.pitch).toBeCloseTo(LIMIT);
      expect(look.recoilPitch).toBe(0);
    });

    it('forgets outstanding recoil on reset (spawn, teleport)', () => {
      const look = new PlayerLook(SETTINGS);
      look.addRecoil(0.1, 0);
      look.resetRecoil();
      look.recoverRecoil(1);
      expect(look.pitch).toBeCloseTo(0.1);
    });
  });
});
