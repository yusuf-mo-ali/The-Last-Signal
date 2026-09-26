import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { falloffFactor, WEAPONS, type FirearmDefinition } from '../config/weapons';
import { CollisionWorld } from '../physics/CollisionWorld';
import { Rng } from '../utils/Rng';
import { boxTriangles } from '../world/levels/geometry';
import { Firearm } from './Firearm';
import { Hitscan } from './hitscan';
import type { AttackContext, Stance } from './types';

const DT = 1 / 60;
const PISTOL = WEAPONS.pistol;
/** A test rifle: automatic, 13.3 shots/s (4.5 steps per shot), finite reserve. */
const RIFLE: FirearmDefinition = {
  ...PISTOL,
  id: 'pistol',
  name: 'Test Rifle',
  fireMode: 'auto',
  fireRate: 40 / 3,
  magazineSize: 30,
  reserveAmmo: 45,
  reloadTime: 2,
};
/** A test shotgun: 8 pellets. */
const SHOTGUN: FirearmDefinition = { ...PISTOL, name: 'Test Shotgun', pellets: 8, damage: 96 };

/** A wall whose near face is at z = −10, and a floor. */
const WORLD = new CollisionWorld([
  ...boxTriangles([-50, -1, -50], [50, 0, 50]),
  ...boxTriangles([-50, 0, -11], [50, 10, -10]),
]);
const STILL: Stance = { crouched: false, grounded: true, speedRatio: 0 };

function context(rng = new Rng(1), stance = STILL, direction = new Vector3(0, 0, -1)) {
  const ctx: AttackContext = {
    origin: new Vector3(0, 1.6, 0),
    direction,
    stance,
    rng,
    hitscan: new Hitscan(WORLD),
  };
  return ctx;
}

/** Only plain objects, arrays and primitives, all the way down. */
function isPlainData(value: unknown): boolean {
  if (value === null || typeof value !== 'object') {
    return typeof value !== 'function';
  }
  const proto: unknown = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== Array.prototype) {
    return false;
  }
  return Object.values(value).every(isPlainData);
}

function advance(weapon: Firearm, seconds: number): void {
  for (let t = 0; t < seconds - 1e-9; t += DT) {
    weapon.update(DT);
  }
}

describe('Firearm', () => {
  it('starts with a full magazine and the configured reserve (unlimited for the Pistol)', () => {
    const pistol = new Firearm(PISTOL);
    expect(pistol.getAmmo()).toEqual({ magazine: 12, magazineSize: 12, reserve: Infinity });
    expect(pistol.getState()).toMatchObject({ id: 'pistol', kind: 'firearm', state: 'ready' });
    expect(pistol.canFire()).toBe(true);
  });

  it('rejects impossible definitions', () => {
    expect(() => new Firearm({ ...PISTOL, fireRate: 0 })).toThrow(RangeError);
    expect(() => new Firearm({ ...PISTOL, fireRate: 120 })).toThrow(RangeError);
    expect(() => new Firearm({ ...PISTOL, magazineSize: 0 })).toThrow(RangeError);
    expect(() => new Firearm({ ...PISTOL, pellets: 0 })).toThrow(RangeError);
  });

  describe('fire timing', () => {
    it('fires once, then is cycling for exactly 1 / fireRate', () => {
      const pistol = new Firearm(PISTOL);
      expect(pistol.fire(context())).not.toBeNull();
      expect(pistol.getState().state).toBe('cooldown');
      expect(pistol.fire(context())).toBeNull(); // cannot fire again immediately
      const stepsPerShot = Math.round(60 / PISTOL.fireRate);
      for (let i = 0; i < stepsPerShot - 1; i++) {
        pistol.update(DT);
        expect(pistol.canFire(), `step ${i + 1}`).toBe(false);
      }
      pistol.update(DT);
      expect(pistol.canFire()).toBe(true);
    });

    it('keeps the fractional remainder: 4.5 steps per shot is exactly the fire rate on average', () => {
      const rifle = new Firearm(RIFLE);
      const shotSteps: number[] = [];
      for (let step = 1; shotSteps.length < 21; step++) {
        rifle.update(DT);
        if (rifle.fire(context())) {
          shotSteps.push(step);
        }
      }
      // 20 intervals of 1/13.33 s = 1.5 s = exactly 90 steps, alternating 5 and 4 steps apart.
      expect((shotSteps.at(-1) ?? 0) - (shotSteps[0] ?? 0)).toBe(90);
      const gaps = shotSteps.slice(1).map((s, i) => s - (shotSteps[i] ?? 0));
      expect(new Set(gaps)).toEqual(new Set([4, 5]));
    });

    it('never bursts after sitting idle (at most one step of remainder is kept)', () => {
      const rifle = new Firearm(RIFLE);
      rifle.fire(context());
      advance(rifle, 5);
      expect(rifle.fire(context())).not.toBeNull();
      expect(rifle.fire(context())).toBeNull();
    });
  });

  describe('magazine and reserve', () => {
    it('spends one round per shot and is empty after a magazine', () => {
      const pistol = new Firearm(PISTOL);
      for (let i = 0; i < 12; i++) {
        const shot = pistol.fire(context());
        expect(shot?.magazine).toBe(11 - i);
        advance(pistol, 1 / PISTOL.fireRate);
      }
      expect(pistol.getState().state).toBe('empty');
      expect(pistol.canFire()).toBe(false);
      expect(pistol.fire(context())).toBeNull();
    });

    it('reloads over reloadTime, from an unlimited reserve that never runs out', () => {
      const pistol = new Firearm(PISTOL);
      pistol.magazine = 3;
      expect(pistol.reload()).toBe(true);
      expect(pistol.getState().state).toBe('reloading');
      advance(pistol, PISTOL.reloadTime / 2);
      expect(pistol.getState().reloadProgress).toBeCloseTo(0.5, 1);
      expect(pistol.magazine).toBe(3); // nothing moves until the reload completes
      let completed = false;
      for (let i = 0; i < 60 * PISTOL.reloadTime; i++) {
        completed ||= pistol.update(DT);
      }
      expect(completed).toBe(true);
      expect(pistol.getAmmo()).toEqual({ magazine: 12, magazineSize: 12, reserve: Infinity });
    });

    it('draws from a finite reserve and stops when it is empty', () => {
      const rifle = new Firearm(RIFLE); // 30 + 45
      rifle.magazine = 0;
      rifle.reload();
      advance(rifle, RIFLE.reloadTime);
      expect(rifle.getAmmo()).toMatchObject({ magazine: 30, reserve: 15 });
      rifle.magazine = 0;
      rifle.reload();
      advance(rifle, RIFLE.reloadTime);
      expect(rifle.getAmmo()).toMatchObject({ magazine: 15, reserve: 0 });
      rifle.magazine = 0;
      expect(rifle.reload()).toBe(false); // nothing left
    });

    it('does not reload a full magazine, or twice at once', () => {
      const pistol = new Firearm(PISTOL);
      expect(pistol.reload()).toBe(false);
      pistol.magazine = 5;
      expect(pistol.reload()).toBe(true);
      expect(pistol.reload()).toBe(false);
    });

    it('cannot fire while reloading, even with rounds left', () => {
      const pistol = new Firearm(PISTOL);
      pistol.magazine = 5;
      pistol.reload();
      advance(pistol, 0.5);
      expect(pistol.canFire()).toBe(false);
      expect(pistol.fire(context())).toBeNull();
      expect(pistol.magazine).toBe(5);
    });

    it('can cancel a reload, keeping the rounds it had', () => {
      const pistol = new Firearm(PISTOL);
      pistol.magazine = 5;
      pistol.reload();
      advance(pistol, 1);
      expect(pistol.cancelReload()).toBe(true);
      expect(pistol.cancelReload()).toBe(false);
      advance(pistol, 2);
      expect(pistol.magazine).toBe(5);
      expect(pistol.canFire()).toBe(true);
    });

    it('refills and adds reserve (Supply Terminal ammunition), and can ignore ammo (debug)', () => {
      const rifle = new Firearm(RIFLE);
      rifle.magazine = 2;
      rifle.reserve = 0;
      rifle.refill();
      expect(rifle.getAmmo()).toMatchObject({ magazine: 30, reserve: 45 });
      rifle.addReserve(10);
      rifle.addReserve(-5);
      expect(rifle.reserve).toBe(55);
      rifle.infiniteAmmo = true;
      rifle.fire(context());
      expect(rifle.magazine).toBe(30);
    });
  });

  describe('shots', () => {
    it('hits the level along the aim and reports clean hit data', () => {
      const shot = new Firearm({ ...PISTOL, spread: { ...PISTOL.spread, baseDeg: 0 } }).fire(
        context(),
      );
      expect(shot).not.toBeNull();
      const [pellet] = shot?.pellets ?? [];
      expect(pellet?.hit).toMatchObject({ kind: 'world', distance: 10 });
      expect(pellet?.hit?.point[2]).toBeCloseTo(-10);
      expect(pellet?.end[2]).toBeCloseTo(-10);
      expect(shot?.origin).toEqual([0, 1.6, 0]);
      expect(shot?.headshotMultiplier).toBe(PISTOL.headshotMultiplier);
      expect(pellet?.damage).toBe(PISTOL.damage); // 10 m: inside the falloff start
      expect(isPlainData(shot)).toBe(true); // no three.js objects or references into the weapon
    });

    it('reports a miss with the ray ending at the weapon range', () => {
      const shot = new Firearm(PISTOL).fire(context(new Rng(1), STILL, new Vector3(0, 0, 1)));
      const [pellet] = shot?.pellets ?? [];
      expect(pellet?.hit).toBeNull();
      const [x, y, z] = pellet?.end ?? [0, 0, 0];
      expect(Math.hypot(x, y - 1.6, z)).toBeCloseTo(PISTOL.range);
      expect(pellet?.damage).toBeCloseTo(PISTOL.damage * PISTOL.falloff.minFactor);
    });

    it('splits damage across pellets', () => {
      const shot = new Firearm(SHOTGUN).fire(context());
      expect(shot?.pellets).toHaveLength(8);
      const total = (shot?.pellets ?? []).reduce((sum, p) => sum + p.damage, 0);
      expect(total).toBeCloseTo(96);
    });

    it('is reproducible: the same seed gives the same spread and recoil', () => {
      const a = new Firearm(SHOTGUN).fire(context(new Rng('seed')));
      const b = new Firearm(SHOTGUN).fire(context(new Rng('seed')));
      const c = new Firearm(SHOTGUN).fire(context(new Rng('other')));
      expect(a).toEqual(b);
      expect(a).not.toEqual(c);
    });

    it('keeps every shot inside the spread cone', () => {
      const pistol = new Firearm(PISTOL);
      pistol.infiniteAmmo = true;
      const rng = new Rng(7);
      const cone = pistol.spreadRadians(STILL);
      for (let i = 0; i < 300; i++) {
        pistol.update(1);
        const [pellet] = pistol.fire(context(rng))?.pellets ?? [];
        const angle = Math.acos(-(pellet?.direction[2] ?? 0));
        expect(angle).toBeLessThanOrEqual(cone + 1e-9);
      }
    });
  });

  describe('spread', () => {
    const pistol = new Firearm(PISTOL);
    const base = (PISTOL.spread.baseDeg * Math.PI) / 180;

    it('is the base cone standing still, tighter crouched, wider moving and in the air', () => {
      expect(pistol.spreadRadians(STILL)).toBeCloseTo(base);
      expect(pistol.spreadRadians({ ...STILL, crouched: true })).toBeCloseTo(
        base * PISTOL.spread.crouchMultiplier,
      );
      expect(pistol.spreadRadians({ ...STILL, speedRatio: 1 })).toBeCloseTo(
        base * PISTOL.spread.movingMultiplier,
      );
      expect(pistol.spreadRadians({ ...STILL, speedRatio: 0.5 })).toBeCloseTo(
        base * (1 + (PISTOL.spread.movingMultiplier - 1) / 2),
      );
      expect(pistol.spreadRadians({ ...STILL, speedRatio: 3 })).toBeCloseTo(
        base * PISTOL.spread.movingMultiplier,
      );
      expect(pistol.spreadRadians({ ...STILL, grounded: false })).toBeCloseTo(
        base * PISTOL.spread.airborneMultiplier,
      );
    });
  });

  describe('recoil', () => {
    it('kicks up by pitchDeg ± variance and sideways within ± yawDeg', () => {
      const rng = new Rng(3);
      const r = PISTOL.recoil;
      const deg = Math.PI / 180;
      for (let i = 0; i < 200; i++) {
        const pistol = new Firearm(PISTOL);
        const shot = pistol.fire(context(rng));
        expect(shot?.recoil.pitch).toBeGreaterThanOrEqual((r.pitchDeg - r.pitchVarianceDeg) * deg);
        expect(shot?.recoil.pitch).toBeLessThanOrEqual((r.pitchDeg + r.pitchVarianceDeg) * deg);
        expect(Math.abs(shot?.recoil.yaw ?? 0)).toBeLessThanOrEqual(r.yawDeg * deg);
      }
    });
  });
});

describe('falloffFactor', () => {
  const f = { start: 20, end: 60, minFactor: 0.6 };
  it('is 1 up close, minFactor far away, linear between', () => {
    expect(falloffFactor(f, 0)).toBe(1);
    expect(falloffFactor(f, 20)).toBe(1);
    expect(falloffFactor(f, 40)).toBeCloseTo(0.8);
    expect(falloffFactor(f, 60)).toBe(0.6);
    expect(falloffFactor(f, 500)).toBe(0.6);
  });
});
