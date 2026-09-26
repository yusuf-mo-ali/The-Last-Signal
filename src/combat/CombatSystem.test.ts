import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { COMBAT_RULES, HUMANOID_RIG } from '../config/combat';
import { WEAPONS, type FirearmDefinition } from '../config/weapons';
import { CollisionWorld } from '../physics/CollisionWorld';
import { Rng } from '../utils/Rng';
import { Firearm } from '../weapons/Firearm';
import { Hitscan } from '../weapons/hitscan';
import { MeleeWeapon } from '../weapons/melee/MeleeWeapon';
import type { AttackContext, ShotResult } from '../weapons/types';
import { NO_WEAPON_INPUT, WeaponManager } from '../weapons/WeaponManager';
import { boxTriangles } from '../world/levels/geometry';
import {
  CombatSystem,
  type CombatEvents,
  type CombatTargetOptions,
  type DamagedEvent,
} from './CombatSystem';
import { Health } from './Health';
import { HitboxRig } from './hitbox';

const DT = 1 / 60;
const EYE = new Vector3(0, 1.62, 0);
/** A precise Pistol: no spread, so every shot goes exactly where it is aimed. */
const PRECISE: FirearmDefinition = {
  ...WEAPONS.pistol,
  spread: { ...WEAPONS.pistol.spread, baseDeg: 0 },
};

/** Floor, plus (optionally) a wall whose near face is at z = −10. */
function world(wall = true) {
  return new CollisionWorld([
    ...boxTriangles([-100, -1, -100], [100, 0, 100]),
    ...(wall ? boxTriangles([-100, 0, -11], [100, 10, -10]) : []),
  ]);
}

type Recorded = {
  [K in keyof CombatEvents]: { type: K; payload: CombatEvents[K] };
}[keyof CombatEvents];

function setup(wall = true) {
  const hitscan = new Hitscan(world(wall));
  const combat = new CombatSystem({ hitscan });
  const events: Recorded[] = [];
  for (const type of ['damaged', 'staggered', 'killed', 'revived'] as const) {
    combat.events.on(type, (payload: unknown) => {
      events.push({ type, payload } as Recorded);
    });
  }
  const kills: string[] = [];
  /** A humanoid target at (x, 0, z), facing the shooter at the origin (south, +z). */
  const addTarget = (
    id: string,
    z: number,
    extra: Partial<Omit<CombatTargetOptions, 'health'>> & { health?: number; x?: number } = {},
  ) => {
    const rig = new HitboxRig(HUMANOID_RIG);
    rig.position.set(extra.x ?? 0, 0, z);
    rig.yaw = Math.PI;
    const { health, ...options } = extra;
    return combat.add({
      id,
      rig,
      health: new Health({ max: health ?? 100 }),
      onKilled: (e) => kills.push(e.targetId),
      ...options,
    });
  };
  const pistol = new Firearm(PRECISE);
  pistol.infiniteAmmo = true;
  const rng = new Rng('combat');
  const context = (target: Vector3, origin = EYE): AttackContext => ({
    origin,
    direction: target.clone().sub(origin).normalize(),
    stance: { crouched: false, grounded: true, speedRatio: 0 },
    rng,
    hitscan,
  });
  /** Fires one Pistol shot at a world point and applies it. */
  const shootAt = (x: number, y: number, z: number, origin = EYE): ShotResult => {
    for (let i = 0; i < 60 && !pistol.canFire(); i++) {
      pistol.update(DT);
    }
    const shot = pistol.fire(context(new Vector3(x, y, z), origin));
    if (!shot) {
      throw new Error('the pistol did not fire');
    }
    combat.applyShot(shot);
    return shot;
  };
  const damaged = () => events.flatMap((e) => (e.type === 'damaged' ? [e.payload] : []));
  const count = (type: keyof CombatEvents) => events.filter((e) => e.type === type).length;
  return { hitscan, combat, events, kills, addTarget, shootAt, context, damaged, count };
}

describe('CombatSystem: weapon hit → hitbox → damage → health', () => {
  it('registers its targets with the hitscan', () => {
    const t = setup();
    t.addTarget('a', -5);
    const hit = t.hitscan.cast(EYE, new Vector3(0, 0, -1), 100);
    expect(hit).toMatchObject({ kind: 'target', targetId: 'a', zone: 'HEAD' });
    expect(hit?.distance).toBeCloseTo(5 - 0.13, 2);
  });

  it('a headshot deals 65, is critical and leaves 35', () => {
    const t = setup();
    t.addTarget('a', -5);
    t.shootAt(0, 1.63, -5);
    expect(t.damaged()).toEqual([
      expect.objectContaining({
        targetId: 'a',
        weaponId: 'pistol',
        source: 'shot',
        zone: 'HEAD',
        critical: true,
        amount: 65,
        health: 35,
        maxHealth: 100,
        killed: false,
      }),
    ]);
  });

  it('body, arm and leg shots use their zone multipliers', () => {
    const t = setup();
    t.addTarget('a', -5, { health: 1000 });
    t.shootAt(0, 1.15, -5); // chest
    t.shootAt(0.31, 1.1, -5); // its left arm (on our right)
    t.shootAt(-0.31, 1.1, -5); // its right arm
    t.shootAt(0.11, 0.45, -5); // its left leg
    t.shootAt(-0.11, 0.45, -5); // its right leg
    expect(t.damaged().map((d) => [d.zone, Number(d.amount.toFixed(6)), d.critical])).toEqual([
      ['TORSO', 26, false],
      ['ARM_LEFT', 16.9, false],
      ['ARM_RIGHT', 16.9, false],
      ['LEG_LEFT', 13, false],
      ['LEG_RIGHT', 13, false],
    ]);
    expect(t.combat.get('a')?.health.current).toBeCloseTo(1000 - 26 - 16.9 * 2 - 13 * 2, 9);
  });

  it('two headshots kill a 100-health target: one killed event, one onKilled call', () => {
    const t = setup();
    t.addTarget('a', -5);
    t.shootAt(0, 1.63, -5);
    t.shootAt(0, 1.63, -5);
    const [, second] = t.damaged();
    expect(second).toMatchObject({ amount: 35, dealt: 65, health: 0, killed: true });
    expect(t.count('killed')).toBe(1);
    expect(t.events.at(-1)).toMatchObject({
      type: 'killed',
      payload: { targetId: 'a', zone: 'HEAD', critical: true, overkill: 30, weaponId: 'pistol' },
    });
    expect(t.kills).toEqual(['a']);
  });

  it('four body shots kill; the killing hit is reported before the kill', () => {
    const t = setup();
    t.addTarget('a', -5);
    for (let i = 0; i < 4; i++) {
      t.shootAt(0, 1.15, -5);
    }
    expect(t.damaged().map((d) => d.health)).toEqual([74, 48, 22, 0]);
    expect(t.events.map((e) => e.type).slice(-2)).toEqual(['damaged', 'killed']);
  });

  it('shots after death are ignored and pass through to the wall behind', () => {
    const t = setup();
    t.addTarget('a', -5);
    t.shootAt(0, 1.63, -5);
    t.shootAt(0, 1.63, -5);
    const before = t.events.length;
    const shot = t.shootAt(0, 1.63, -5);
    expect(shot.pellets[0]?.hit).toMatchObject({ kind: 'world' });
    expect(shot.pellets[0]?.hit?.point[2]).toBeCloseTo(-10, 6);
    expect(t.events.length).toBe(before);
    expect(t.kills).toEqual(['a']);
    // Even a hit forced onto the dead target does nothing.
    expect(
      t.combat.applyHit({
        targetId: 'a',
        zone: 'HEAD',
        weaponId: 'pistol',
        source: 'shot',
        quick: false,
        baseDamage: 26,
        falloff: 1,
        headshotMultiplier: 2.5,
        point: [0, 0, 0],
        direction: [0, 0, -1],
        distance: 5,
      }),
    ).toBeNull();
    expect(t.count('killed')).toBe(1);
  });

  it('walls block targets behind them', () => {
    const t = setup();
    t.addTarget('behind', -15);
    const shot = t.shootAt(0, 1.63, -15);
    expect(shot.pellets[0]?.hit?.kind).toBe('world');
    expect(t.damaged()).toEqual([]);
    expect(t.combat.get('behind')?.health.current).toBe(100);
  });

  it('with several targets in line, the nearest takes the hit; then the next', () => {
    const t = setup();
    t.addTarget('far', -8);
    t.addTarget('near', -4);
    t.shootAt(0, 1.63, -8);
    t.shootAt(0, 1.63, -8);
    expect(t.kills).toEqual(['near']);
    t.shootAt(0, 1.63, -8);
    expect(t.damaged().at(-1)).toMatchObject({ targetId: 'far', zone: 'HEAD' });
    expect(t.combat.get('far')?.health.current).toBe(35);
  });

  it('nearest wins regardless of registration order', () => {
    const t = setup();
    t.addTarget('near', -4);
    t.addTarget('far', -8);
    t.shootAt(0, 1.63, -8);
    expect(t.damaged()[0]?.targetId).toBe('near');
  });

  it('applies the weapon’s falloff at long range', () => {
    const t = setup(false);
    t.addTarget('far', -40.13, { health: 1000 });
    t.shootAt(0, 1.63, -40.13);
    const hit = t.damaged()[0];
    // The head's front surface is 40 m away: halfway between 20 and 60 m, falloff 0.8.
    expect(hit?.distance).toBeCloseTo(40, 1);
    expect(hit?.amount).toBeCloseTo(65 * (1 - (0.4 * ((hit?.distance ?? 0) - 20)) / 40), 6);
    expect(hit?.amount).toBeLessThan(65);
  });

  it('target overrides, armor and resistance are applied', () => {
    const t = setup();
    t.addTarget('tank', -5, {
      health: 1000,
      zoneMultipliers: { TORSO: 0.5 },
      armor: 3,
      resistance: 0.5,
    });
    t.shootAt(0, 1.15, -5);
    expect(t.damaged()[0]?.amount).toBe((26 * 0.5 - 3) * 0.5);
  });

  it('the attacker multiplier hook scales hits', () => {
    const t = setup();
    t.addTarget('a', -5);
    t.combat.attackerMultiplier = 1.5;
    t.shootAt(0, 1.15, -5);
    expect(t.damaged()[0]?.amount).toBe(39);
  });

  it('staggers when enough damage lands within the window, once per threshold', () => {
    const t = setup();
    t.addTarget('a', -5, { health: 1000, staggerThreshold: 40 });
    t.shootAt(0, 1.15, -5);
    expect(t.count('staggered')).toBe(0);
    t.shootAt(0, 1.15, -5); // 52 within the window
    expect(t.count('staggered')).toBe(1);
    t.shootAt(0, 1.15, -5); // meter restarted: 26
    expect(t.count('staggered')).toBe(1);
  });

  it('damage spread out beyond the window never staggers', () => {
    const t = setup();
    t.addTarget('a', -5, { health: 1000, staggerThreshold: 40 });
    for (let i = 0; i < 5; i++) {
      t.shootAt(0, 1.15, -5);
      for (let s = 0; s < (COMBAT_RULES.staggerWindow + 0.1) * 60; s++) {
        t.combat.fixedUpdate(DT);
      }
    }
    expect(t.count('staggered')).toBe(0);
  });

  it('a stagger-immune target (no threshold) never staggers; a kill never staggers', () => {
    const t = setup();
    t.addTarget('a', -5);
    for (let i = 0; i < 4; i++) {
      t.shootAt(0, 1.15, -5);
    }
    expect(t.count('staggered')).toBe(0);
    const u = setup();
    u.addTarget('b', -5, { staggerThreshold: 10 });
    u.shootAt(0, 1.63, -5);
    u.shootAt(0, 1.63, -5);
    expect(u.count('staggered')).toBe(1); // the first hit only; the killing hit does not
  });

  it('revives a dead target: hittable again at full health, and can die again', () => {
    const t = setup();
    t.addTarget('a', -5);
    t.shootAt(0, 1.63, -5);
    t.shootAt(0, 1.63, -5);
    expect(t.combat.revive('a')).toBe(true);
    expect(t.events.at(-1)).toEqual({ type: 'revived', payload: { targetId: 'a' } });
    expect(t.combat.get('a')?.health.current).toBe(100);
    t.shootAt(0, 1.63, -5);
    t.shootAt(0, 1.63, -5);
    expect(t.kills).toEqual(['a', 'a']);
    expect(t.combat.revive('missing')).toBe(false);
  });

  it('direct damage and kill (no weapon) use the same Health, stagger and death', () => {
    const t = setup();
    t.addTarget('a', -5, { staggerThreshold: 35 });
    expect(t.combat.applyDamage('a', { amount: 40 })).toMatchObject({
      targetId: 'a',
      weaponId: null,
      source: 'direct',
      zone: 'TORSO',
      critical: false,
      amount: 40,
      health: 60,
      killed: false,
    });
    expect(t.count('staggered')).toBe(1);
    expect(t.combat.applyDamage('a', { amount: 10, zone: 'HEAD' })).toMatchObject({
      zone: 'HEAD',
      critical: true,
      health: 50,
    });
    expect(t.combat.applyDamage('a', { amount: Number.NaN })).toMatchObject({ amount: 0 });
    expect(t.combat.kill('a')).toMatchObject({ amount: 50, health: 0, killed: true });
    expect(t.kills).toEqual(['a']);
    expect(t.count('killed')).toBe(1);
  });

  it('direct damage and kill do nothing to a dead or unknown target: no event, no second death', () => {
    const t = setup();
    t.addTarget('a', -5);
    t.combat.kill('a');
    const before = t.events.length;
    expect(t.combat.applyDamage('a', { amount: 10 })).toBeNull();
    expect(t.combat.kill('a')).toBeNull();
    expect(t.combat.applyDamage('missing', { amount: 10 })).toBeNull();
    expect(t.combat.kill('missing')).toBeNull();
    expect(t.events).toHaveLength(before);
    expect(t.kills).toEqual(['a']);
  });

  it('removed targets are no longer hit; ids are unique', () => {
    const t = setup();
    t.addTarget('a', -5);
    expect(() => t.addTarget('a', -6)).toThrow(/already registered/);
    expect(t.combat.remove('a')).toBe(true);
    expect(t.combat.remove('a')).toBe(false);
    expect(t.shootAt(0, 1.63, -5).pellets[0]?.hit?.kind).toBe('world');
    expect(t.combat.targets).toEqual([]);
  });

  it('counts the living', () => {
    const t = setup();
    t.addTarget('a', -5);
    t.addTarget('b', -5, { x: 3 });
    expect(t.combat.aliveCount).toBe(2);
    t.shootAt(0, 1.63, -5);
    t.shootAt(0, 1.63, -5);
    expect(t.combat.aliveCount).toBe(1);
  });

  it('every pellet of a multi-pellet shot is applied; the kill is reported once', () => {
    const t = setup();
    t.addTarget('a', -3);
    const shotgun = new Firearm({
      ...PRECISE,
      pellets: 8,
      damage: 160,
      spread: { ...PRECISE.spread, baseDeg: 0.5 },
    });
    const shot = shotgun.fire(t.context(new Vector3(0, 1.15, -3)));
    if (!shot) {
      throw new Error('no shot');
    }
    t.combat.applyShot(shot);
    const hits = t.damaged();
    expect(hits.length).toBeGreaterThanOrEqual(5); // 20 each: the 5th kills
    expect(hits.filter((h) => h.killed)).toHaveLength(1);
    expect(t.count('killed')).toBe(1);
    expect(hits.reduce((sum, h) => sum + h.amount, 0)).toBe(100);
  });

  it('Bare Hands deals damage through the same pipeline, within reach only', () => {
    const t = setup();
    t.addTarget('close', -1.3);
    const hands = new MeleeWeapon(WEAPONS.bareHands);
    const swing = hands.fire(t.context(new Vector3(0, 1.15, -1.3), new Vector3(0, 1.15, 0)));
    if (!swing) {
      throw new Error('no swing');
    }
    t.combat.applyMelee(swing);
    expect(t.damaged()).toEqual([
      expect.objectContaining({
        source: 'melee',
        weaponId: 'bareHands',
        zone: 'TORSO',
        amount: 15,
      }),
    ]);
    const u = setup();
    u.addTarget('far', -3);
    const miss = new MeleeWeapon(WEAPONS.bareHands).fire(
      u.context(new Vector3(0, 1.15, -3), new Vector3(0, 1.15, 0)),
    );
    if (!miss) {
      throw new Error('no swing');
    }
    u.combat.applyMelee(miss);
    expect(u.damaged()).toEqual([]);
  });

  it('listens to a WeaponManager: shots and quick melee deal damage; dispose stops it', () => {
    const hitscan = new Hitscan(world());
    const weapons = new WeaponManager({ definitions: { ...WEAPONS, pistol: PRECISE } });
    const combat = new CombatSystem({ hitscan, weaponEvents: weapons.events });
    const rig = new HitboxRig(HUMANOID_RIG);
    rig.position.set(0, 0, -1.2);
    rig.yaw = Math.PI;
    combat.add({ id: 'a', rig, health: new Health({ max: 1000 }) });
    const hits: DamagedEvent[] = [];
    combat.events.on('damaged', (e) => hits.push(e));
    const ctx: AttackContext = {
      origin: new Vector3(0, 1.15, 0),
      direction: new Vector3(0, 0, -1),
      stance: { crouched: false, grounded: true, speedRatio: 0 },
      rng: new Rng(3),
      hitscan,
    };
    for (let i = 0; i < 30; i++) {
      weapons.step({ ...NO_WEAPON_INPUT, firePressed: i === 25 }, () => ctx, DT);
    }
    weapons.quickMelee(ctx);
    expect(hits.map((h) => [h.source, h.weaponId, h.quick, h.amount])).toEqual([
      ['shot', 'pistol', false, 26],
      ['melee', 'bareHands', true, 15],
    ]);
    combat.dispose();
    for (let i = 0; i < 60; i++) {
      weapons.step({ ...NO_WEAPON_INPUT, firePressed: i === 50 }, () => ctx, DT);
    }
    expect(hits).toHaveLength(2);
  });

  it('is deterministic: the same seed and aim give identical events', () => {
    const run = () => {
      const t = setup();
      t.addTarget('a', -6, { health: 1000, staggerThreshold: 50 });
      t.addTarget('b', -7, { x: 0.5, health: 1000 });
      const pistol = new Firearm(WEAPONS.pistol); // with spread, from the seeded Rng
      pistol.infiniteAmmo = true;
      for (let i = 0; i < 40; i++) {
        for (let s = 0; s < 10; s++) {
          pistol.update(DT);
          t.combat.fixedUpdate(DT);
        }
        const shot = pistol.fire(t.context(new Vector3(0.25 - i * 0.012, 1.3, -6)));
        if (shot) {
          t.combat.applyShot(shot);
        }
      }
      return JSON.stringify(t.events);
    };
    const first = run();
    expect(first.length).toBeGreaterThan(1000);
    expect(run()).toBe(first);
  });
});
