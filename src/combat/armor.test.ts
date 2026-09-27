/**
 * Mitigation added for traits and archetypes (D-043): breakable plates (`ArmorPlate`), flat armor
 * per zone, stagger that only counts some zones, and changing a target's profile at run time.
 */

import { describe, expect, it } from 'vitest';
import { HUMANOID_RIG } from '../config/combat';
import type { DamageZone } from '../config/enemies';
import { CollisionWorld } from '../physics/CollisionWorld';
import { Hitscan } from '../weapons/hitscan';
import { boxTriangles } from '../world/levels/geometry';
import { ArmorPlate } from './armor';
import {
  CombatSystem,
  type ArmorBrokenEvent,
  type CombatTargetOptions,
  type DamagedEvent,
} from './CombatSystem';
import { Health } from './Health';
import { HitboxRig } from './hitbox';

const HELMET = { id: 'helmet', zones: ['HEAD'], durability: 50, staggerOnBreak: true } as const;

describe('ArmorPlate', () => {
  it('absorbs what it can, then breaks and stops covering', () => {
    const plate = new ArmorPlate(HELMET);
    expect(plate.covers('HEAD')).toBe(true);
    expect(plate.covers('TORSO')).toBe(false);
    expect(plate.absorb(30)).toBe(30);
    expect(plate.durability).toBe(20);
    expect(plate.broken).toBe(false);
    expect(plate.absorb(65)).toBe(20);
    expect(plate.broken).toBe(true);
    expect(plate.covers('HEAD')).toBe(false);
    expect(plate.absorb(10)).toBe(0);
  });

  it('ignores nothing-hits (zero, negative, NaN) and resets whole', () => {
    const plate = new ArmorPlate(HELMET);
    expect(plate.absorb(0)).toBe(0);
    expect(plate.absorb(-5)).toBe(0);
    expect(plate.absorb(Number.NaN)).toBe(0);
    expect(plate.durability).toBe(50);
    plate.absorb(50);
    expect(plate.broken).toBe(true);
    plate.reset();
    expect(plate.durability).toBe(50);
    expect(plate.broken).toBe(false);
  });
});

function setup(options: Partial<Omit<CombatTargetOptions, 'id' | 'rig' | 'health'>> = {}) {
  const combat = new CombatSystem({
    hitscan: new Hitscan(new CollisionWorld(boxTriangles([-10, -1, -10], [10, 0, 10]))),
  });
  const health = new Health({ max: 200 });
  combat.add({ id: 'z', rig: new HitboxRig(HUMANOID_RIG), health, ...options });
  const damaged: DamagedEvent[] = [];
  const broken: ArmorBrokenEvent[] = [];
  const staggers: DamageZone[] = [];
  combat.events.on('damaged', (e) => damaged.push(e));
  combat.events.on('armorBroken', (e) => broken.push(e));
  combat.events.on('staggered', (e) => staggers.push(e.zone));
  /** A Pistol hit (26, headshots ×2.5) on `zone`. */
  const hit = (zone: DamageZone) =>
    combat.applyHit({
      targetId: 'z',
      zone,
      weaponId: 'pistol',
      source: 'shot',
      quick: false,
      baseDamage: 26,
      falloff: 1,
      headshotMultiplier: 2.5,
      point: [0, 1, 0],
      direction: [0, 0, -1],
      distance: 5,
    });
  return { combat, health, damaged, broken, staggers, hit };
}

describe('CombatSystem: per-zone armor', () => {
  it('adds to the target’s flat armor on its zones only', () => {
    const t = setup({ armor: 2, zoneArmor: { TORSO: 10, LEG_LEFT: 6 } });
    t.hit('TORSO');
    t.hit('LEG_LEFT');
    t.hit('HEAD');
    t.hit('ARM_LEFT');
    expect(
      t.damaged.map((d) => [d.zone, +d.amount.toFixed(6), +d.armorReduction.toFixed(6)]),
    ).toEqual([
      ['TORSO', 14, 12],
      ['LEG_LEFT', 5, 8],
      ['HEAD', 63, 2],
      ['ARM_LEFT', 14.9, 2],
    ]);
  });

  it('never takes a hit below the minimum-damage floor', () => {
    const t = setup({ zoneArmor: { LEG_LEFT: 100 } });
    t.hit('LEG_LEFT');
    expect(t.damaged[0]?.amount).toBe(1);
    expect(t.damaged[0]?.armorReduction).toBe(12);
  });
});

describe('CombatSystem: breakable plates', () => {
  it('a helmet absorbs a headshot up to its durability; the rest reaches health', () => {
    const helmet = new ArmorPlate(HELMET);
    const t = setup({ plates: [helmet] });
    const first = t.hit('HEAD');
    expect(first).toMatchObject({ amount: 15, absorbed: 50, dealt: 15, critical: true });
    expect(t.health.current).toBe(185);
    expect(helmet.broken).toBe(true);
    // Once broken, headshots land in full.
    expect(t.hit('HEAD')).toMatchObject({ amount: 65, absorbed: 0 });
  });

  it('breaking it emits armorBroken once, and staggers when the plate says so', () => {
    const t = setup({ plates: [new ArmorPlate({ ...HELMET, durability: 100 })] });
    t.hit('HEAD'); // 65 absorbed, 35 left
    expect(t.broken).toEqual([]);
    expect(t.staggers).toEqual([]);
    t.hit('HEAD'); // 35 absorbed, 30 through: broken
    expect(t.broken).toEqual([
      expect.objectContaining({ targetId: 'z', plateId: 'helmet', zone: 'HEAD' }),
    ]);
    expect(t.staggers).toEqual(['HEAD']);
    t.hit('HEAD');
    expect(t.broken).toHaveLength(1);
  });

  it('a plate that does not stagger on breaking does not', () => {
    const t = setup({ plates: [new ArmorPlate({ ...HELMET, staggerOnBreak: false })] });
    t.hit('HEAD');
    expect(t.broken).toHaveLength(1);
    expect(t.staggers).toEqual([]);
  });

  it('only protects its own zones', () => {
    const helmet = new ArmorPlate(HELMET);
    const t = setup({ plates: [helmet] });
    expect(t.hit('TORSO')).toMatchObject({ amount: 26, absorbed: 0 });
    expect(helmet.durability).toBe(50);
  });

  it('breaking a helmet with a killing blow kills without a stagger', () => {
    const t = setup({ plates: [new ArmorPlate(HELMET)] });
    t.health.damage(190);
    t.hit('HEAD');
    expect(t.damaged.at(-1)?.killed).toBe(true);
    expect(t.broken).toHaveLength(1);
    expect(t.staggers).toEqual([]);
  });

  it('direct damage ignores plates and armor', () => {
    const helmet = new ArmorPlate(HELMET);
    const t = setup({ plates: [helmet], zoneArmor: { HEAD: 20 } });
    t.combat.applyDamage('z', { amount: 40, zone: 'HEAD' });
    expect(t.damaged[0]).toMatchObject({ amount: 40, absorbed: 0, armorReduction: 0 });
    expect(helmet.durability).toBe(50);
  });
});

describe('CombatSystem: stagger zones', () => {
  it('only damage to the listed zones counts towards a stagger', () => {
    const t = setup({ staggerThreshold: 60, staggerZones: ['HEAD'] });
    for (let i = 0; i < 5; i++) {
      t.hit('TORSO'); // 130 to the body: no stagger
    }
    expect(t.staggers).toEqual([]);
    t.hit('HEAD');
    expect(t.staggers).toEqual(['HEAD']);
  });

  it('without a list every zone counts (Phase 3–4 behaviour)', () => {
    const t = setup({ staggerThreshold: 50 });
    t.hit('TORSO');
    t.hit('TORSO');
    expect(t.staggers).toEqual(['TORSO']);
  });
});

describe('CombatSystem: configure', () => {
  it('changes a registered target’s profile in place (traits added at run time)', () => {
    const t = setup({ staggerThreshold: 1000 });
    expect(t.hit('TORSO')?.amount).toBe(26);
    const helmet = new ArmorPlate(HELMET);
    expect(
      t.combat.configure('z', { zoneArmor: { TORSO: 10 }, plates: [helmet], staggerThreshold: 20 }),
    ).toBe(true);
    const view = t.combat.get('z');
    expect(view?.zoneArmor).toEqual({ TORSO: 10 });
    expect(view?.plates).toEqual([helmet]);
    expect(view?.staggerThreshold).toBe(20);
    expect(t.hit('TORSO')?.amount).toBe(16);
    expect(t.hit('HEAD')?.absorbed).toBe(50);
    // And back: an empty profile removes it all.
    t.combat.configure('z', {});
    expect(t.combat.get('z')?.zoneArmor).toEqual({});
    expect(t.combat.get('z')?.plates).toEqual([]);
    expect(t.hit('TORSO')?.amount).toBe(26);
  });

  it('refuses an unknown target', () => {
    const t = setup();
    expect(t.combat.configure('nobody', { armor: 5 })).toBe(false);
  });
});
