import { describe, expect, it } from 'vitest';
import { COMBAT_RULES } from '../config/combat';
import { DAMAGE_ZONES, DEFAULT_ZONE_MULTIPLIERS, type DamageZone } from '../config/enemies';
import { WEAPONS } from '../config/weapons';
import { computeDamage, zoneMultiplier, type DamageInput } from './damage';

const PISTOL = WEAPONS.pistol;
const HANDS = WEAPONS.bareHands;

const pistolHit = (zone: DamageZone, extra: Partial<DamageInput> = {}): DamageInput => ({
  baseDamage: PISTOL.damage,
  falloff: 1,
  zone,
  headshotMultiplier: PISTOL.headshotMultiplier,
  ...extra,
});

describe('zone multipliers (plan §10)', () => {
  it('uses the plan table for every body zone', () => {
    expect(zoneMultiplier('TORSO', 2.5)).toBe(1);
    expect(zoneMultiplier('ARM_LEFT', 2.5)).toBe(0.65);
    expect(zoneMultiplier('ARM_RIGHT', 2.5)).toBe(0.65);
    expect(zoneMultiplier('LEG_LEFT', 2.5)).toBe(0.5);
    expect(zoneMultiplier('LEG_RIGHT', 2.5)).toBe(0.5);
  });

  it('HEAD uses the weapon’s headshot multiplier', () => {
    expect(zoneMultiplier('HEAD', PISTOL.headshotMultiplier)).toBe(2.5);
    expect(zoneMultiplier('HEAD', HANDS.headshotMultiplier)).toBe(1.5);
  });

  it('body zones do not depend on the weapon’s headshot multiplier', () => {
    for (const zone of DAMAGE_ZONES.filter((z) => z !== 'HEAD')) {
      expect(zoneMultiplier(zone, 1)).toBe(zoneMultiplier(zone, 9));
    }
  });

  it('target overrides replace body zones and scale the head in proportion', () => {
    const tank = { TORSO: 0.5, ARM_LEFT: 0.3 };
    expect(zoneMultiplier('TORSO', 2.5, tank)).toBe(0.5);
    expect(zoneMultiplier('ARM_LEFT', 2.5, tank)).toBe(0.3);
    expect(zoneMultiplier('ARM_RIGHT', 2.5, tank)).toBe(0.65); // not overridden
    expect(zoneMultiplier('HEAD', 2.5, tank)).toBe(2.5); // "its head does not" resist
    const weakHead = { HEAD: 3.75 }; // 1.5× the plan's head value
    expect(zoneMultiplier('HEAD', 2.5, weakHead)).toBeCloseTo(3.75, 12);
    expect(zoneMultiplier('HEAD', 1.5, weakHead)).toBeCloseTo(2.25, 12);
  });

  it('a broken multiplier deals nothing rather than NaN', () => {
    expect(zoneMultiplier('TORSO', 2.5, { TORSO: Number.NaN })).toBe(0);
    expect(zoneMultiplier('HEAD', Number.NaN)).toBe(0);
  });
});

describe('computeDamage', () => {
  it('Pistol at close range: 26 body, 65 head, 16.9 arm, 13 leg', () => {
    expect(computeDamage(pistolHit('TORSO')).amount).toBe(26);
    expect(computeDamage(pistolHit('HEAD')).amount).toBe(65);
    expect(computeDamage(pistolHit('ARM_LEFT')).amount).toBeCloseTo(16.9, 12);
    expect(computeDamage(pistolHit('ARM_RIGHT')).amount).toBeCloseTo(16.9, 12);
    expect(computeDamage(pistolHit('LEG_LEFT')).amount).toBe(13);
    expect(computeDamage(pistolHit('LEG_RIGHT')).amount).toBe(13);
  });

  it('each zone’s damage is base × its multiplier', () => {
    for (const zone of DAMAGE_ZONES) {
      const expected =
        zone === 'HEAD'
          ? PISTOL.damage * PISTOL.headshotMultiplier
          : PISTOL.damage * DEFAULT_ZONE_MULTIPLIERS[zone];
      expect(computeDamage(pistolHit(zone)).amount).toBeCloseTo(expected, 12);
    }
  });

  it('only a headshot is critical', () => {
    for (const zone of DAMAGE_ZONES) {
      expect(computeDamage(pistolHit(zone)).critical).toBe(zone === 'HEAD');
    }
  });

  it('criticality depends on the zone, not on the size of the multiplier', () => {
    const weakBody = { TORSO: 1.8 };
    expect(computeDamage(pistolHit('TORSO', { zoneMultipliers: weakBody })).critical).toBe(false);
    const toughHead = { HEAD: 1 };
    const head = computeDamage(pistolHit('HEAD', { zoneMultipliers: toughHead }));
    expect(head.critical).toBe(true);
    expect(head.amount).toBeCloseTo(26, 12); // 2.5 × (1 / 2.5)
  });

  it('applies the falloff from the hit result, never boosts above 1', () => {
    expect(computeDamage(pistolHit('TORSO', { falloff: 0.6 })).amount).toBeCloseTo(15.6, 12);
    expect(computeDamage(pistolHit('HEAD', { falloff: 0.6 })).amount).toBeCloseTo(39, 12);
    expect(computeDamage(pistolHit('TORSO', { falloff: 1.5 })).amount).toBe(26);
  });

  it('falloff and zone multiply: a far headshot and a close body shot differ as expected', () => {
    const far = computeDamage(pistolHit('HEAD', { falloff: PISTOL.falloff.minFactor }));
    expect(far.amount).toBeCloseTo(PISTOL.damage * PISTOL.falloff.minFactor * 2.5, 12);
  });

  it('Bare Hands: 15 body, 22.5 head, no falloff', () => {
    const swing = (zone: DamageZone) =>
      computeDamage({
        baseDamage: HANDS.damage,
        falloff: 1,
        zone,
        headshotMultiplier: HANDS.headshotMultiplier,
      }).amount;
    expect(swing('TORSO')).toBe(15);
    expect(swing('HEAD')).toBe(22.5);
    expect(swing('LEG_LEFT')).toBe(7.5);
  });

  it('attacker multiplier scales everything', () => {
    expect(computeDamage(pistolHit('TORSO', { attackerMultiplier: 1.2 })).amount).toBeCloseTo(
      31.2,
      12,
    );
  });

  it('armor subtracts a flat amount per hit, with a floor, and never raises a weak hit', () => {
    const armored = computeDamage(pistolHit('TORSO', { armor: 10 }));
    expect(armored.amount).toBe(16);
    expect(armored.armorReduction).toBe(10);
    expect(armored.raw).toBe(26);
    expect(computeDamage(pistolHit('TORSO', { armor: 100 })).amount).toBe(
      COMBAT_RULES.minimumDamage,
    );
    const graze = computeDamage(pistolHit('TORSO', { baseDamage: 0.5, armor: 5 }));
    expect(graze.amount).toBe(0.5);
  });

  it('resistance removes a fraction last', () => {
    expect(computeDamage(pistolHit('TORSO', { armor: 6, resistance: 0.5 })).amount).toBe(10);
    expect(computeDamage(pistolHit('TORSO', { resistance: 2 })).amount).toBe(0);
  });

  it('never returns a negative or NaN amount', () => {
    for (const bad of [-5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const r = computeDamage(pistolHit('TORSO', { baseDamage: bad }));
      expect(r.amount).toBe(0);
      expect(computeDamage(pistolHit('TORSO', { falloff: bad })).amount).toBeGreaterThanOrEqual(0);
    }
    expect(computeDamage(pistolHit('TORSO', { armor: -4 })).amount).toBe(26);
  });

  it('is deterministic and pure: the same input gives the same result, inputs untouched', () => {
    const input = Object.freeze(pistolHit('ARM_LEFT', { falloff: 0.83, armor: 2 }));
    const a = computeDamage(input);
    const b = computeDamage(input);
    expect(a).toEqual(b);
    expect(input.falloff).toBe(0.83);
  });

  it('Pass-1 time-to-kill intents hold against a 100-health target', () => {
    const shots = (zone: DamageZone) => Math.ceil(100 / computeDamage(pistolHit(zone)).amount);
    expect(shots('TORSO')).toBe(4); // 4–5 body shots
    expect(shots('HEAD')).toBe(2); // 1–2 headshots
    const punches = Math.ceil(
      100 /
        computeDamage({ ...pistolHit('TORSO'), baseDamage: HANDS.damage, headshotMultiplier: 1.5 })
          .amount,
    );
    expect(punches).toBeGreaterThanOrEqual(5); // "a last resort"
  });
});
