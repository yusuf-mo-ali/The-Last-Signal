/**
 * Enemy traits as data (D-043): how `applyTraits` folds traits into any archetype. Pure config;
 * what the result does in combat and AI is tested with the enemies.
 */

import { describe, expect, it } from 'vitest';
import { ENEMY_MODIFIER_IDS, ENEMY_STATS, IMPLEMENTED_ENEMY_IDS } from './enemies';
import { applyTraits, ENEMY_TRAITS, normalizeTraits } from './traits';

const W = ENEMY_STATS.walker;

describe('traits: definitions', () => {
  it('there is exactly one definition per modifier id, keyed by its own id', () => {
    expect(Object.keys(ENEMY_TRAITS).sort()).toEqual([...ENEMY_MODIFIER_IDS].sort());
    for (const [key, trait] of Object.entries(ENEMY_TRAITS)) {
      expect(trait.id).toBe(key);
      expect(trait.purpose.length).toBeGreaterThan(10);
    }
  });

  it('every multiplier is positive and finite; armor and plate durability are positive', () => {
    for (const trait of Object.values(ENEMY_TRAITS)) {
      for (const m of [
        trait.healthMultiplier,
        trait.moveSpeedMultiplier,
        trait.attackDamageMultiplier,
        trait.staggerThresholdMultiplier,
        trait.threatCostMultiplier,
      ]) {
        if (m !== undefined) {
          expect(Number.isFinite(m) && m > 0, trait.id).toBe(true);
        }
      }
      for (const armor of Object.values(trait.zoneArmor ?? {})) {
        expect(armor).toBeGreaterThan(0);
      }
      for (const plate of trait.plates ?? []) {
        expect(plate.durability).toBeGreaterThan(0);
        expect(plate.zones.length).toBeGreaterThan(0);
      }
    }
  });

  it('every trait makes an enemy cost more threat (it is harder)', () => {
    for (const trait of Object.values(ENEMY_TRAITS)) {
      expect(trait.threatCostMultiplier ?? 1, trait.id).toBeGreaterThan(1);
    }
  });
});

describe('traits: normalizeTraits', () => {
  it('canonical order, each once', () => {
    expect(normalizeTraits(['elite', 'armored', 'elite', 'helmeted'])).toEqual([
      'armored',
      'helmeted',
      'elite',
    ]);
    expect(normalizeTraits([])).toEqual([]);
  });

  it('refuses unknown traits by name', () => {
    expect(() => normalizeTraits(['armored', 'shielded'])).toThrow(/Unknown trait "shielded"/);
  });
});

describe('traits: applyTraits', () => {
  it('no traits: the archetype unchanged, with empty trait data', () => {
    const c = applyTraits(W);
    expect(c.base).toBe(W);
    expect(c.traits).toEqual([]);
    expect(c.health).toBe(W.health);
    expect(c.moveSpeed).toBe(W.moveSpeed);
    expect(c.attackDamage).toBe(W.attackDamage);
    expect(c.staggerThreshold).toBe(W.staggerThreshold);
    expect(c.threatCost).toBe(W.threatCost);
    expect(c.zoneArmor).toEqual({});
    expect(c.plates).toEqual([]);
    expect(c.bonusDrops).toEqual([]);
    expect(c.rig).toBe(W.rig);
  });

  it('Armored: per-zone armor (none on the head), a little slower', () => {
    const c = applyTraits(W, ['armored']);
    expect(c.zoneArmor).toEqual(ENEMY_TRAITS.armored.zoneArmor);
    expect(c.zoneArmor.HEAD).toBeUndefined();
    expect(c.moveSpeed).toBeCloseTo(W.moveSpeed * 0.9, 10);
    expect(c.health).toBe(W.health);
    expect(c.armor).toBe(W.armor); // the archetype's own flat armor is untouched
  });

  it('Helmeted: one breakable plate over the head, stats unchanged', () => {
    const c = applyTraits(W, ['helmeted']);
    expect(c.plates).toEqual([
      { id: 'helmet', zones: ['HEAD'], durability: 50, staggerOnBreak: true },
    ]);
    expect(c.health).toBe(W.health);
    expect(c.moveSpeed).toBe(W.moveSpeed);
  });

  it('Elite: tougher, faster, harder-hitting, harder to stagger, with bonus drops', () => {
    const c = applyTraits(W, ['elite']);
    expect(c.health).toBeCloseTo(W.health * 1.6, 10);
    expect(c.moveSpeed).toBeCloseTo(W.moveSpeed * 1.1, 10);
    expect(c.attackDamage).toBeCloseTo(W.attackDamage * 1.3, 10);
    expect(c.staggerThreshold).toBeCloseTo(W.staggerThreshold * 1.5, 10);
    expect(c.threatCost).toBeCloseTo(W.threatCost * 2.5, 10);
    expect(c.bonusDrops).toEqual(['elite']);
  });

  it('composes: multipliers multiply, and the result is the same in any order', () => {
    const a = applyTraits(W, ['armored', 'helmeted', 'elite']);
    const b = applyTraits(W, ['elite', 'helmeted', 'armored', 'elite']);
    expect(b).toEqual(a);
    expect(a.traits).toEqual(['armored', 'helmeted', 'elite']);
    expect(a.moveSpeed).toBeCloseTo(W.moveSpeed * 0.9 * 1.1, 10);
    expect(a.threatCost).toBeCloseTo(W.threatCost * 1.5 * 1.3 * 2.5, 10);
    expect(a.plates.map((p) => p.id)).toEqual(['helmet']);
    expect(a.zoneArmor.TORSO).toBe(10);
  });

  it('composes overlays of the same kind: per-zone armor adds up, plates and drops collect', () => {
    const defs = {
      ...ENEMY_TRAITS,
      armored: { ...ENEMY_TRAITS.armored, bonusDrops: 'elite' as const },
      elite: {
        ...ENEMY_TRAITS.elite,
        zoneArmor: { TORSO: 5, HEAD: 3 },
        plates: [{ id: 'visor', zones: ['HEAD' as const], durability: 20, staggerOnBreak: false }],
      },
    };
    const c = applyTraits(W, ['elite', 'helmeted', 'armored'], defs);
    expect(c.zoneArmor).toEqual({ ...ENEMY_TRAITS.armored.zoneArmor, TORSO: 15, HEAD: 3 });
    expect(c.plates.map((p) => p.id)).toEqual(['helmet', 'visor']);
    expect(c.bonusDrops).toEqual(['elite', 'elite']);
  });

  it('works on every archetype without naming any: only the traited fields change', () => {
    for (const id of IMPLEMENTED_ENEMY_IDS) {
      const base = ENEMY_STATS[id];
      const c = applyTraits(base, ['armored', 'helmeted', 'elite']);
      expect(c.id).toBe(id);
      expect(c.behavior).toBe(base.behavior);
      expect(c.body).toBe(base.body);
      expect(c.attack).toBe(base.attack);
      expect(c.ability).toBe(base.ability);
      expect(c.health).toBeCloseTo(base.health * 1.6, 10);
    }
  });

  it('is pure: the archetype definition is never changed', () => {
    const before = JSON.stringify(ENEMY_STATS.tank);
    applyTraits(ENEMY_STATS.tank, ['armored', 'helmeted', 'elite']);
    expect(JSON.stringify(ENEMY_STATS.tank)).toBe(before);
    // Two results do not share mutable trait data.
    const x = applyTraits(W, ['armored']);
    const y = applyTraits(W, ['armored']);
    expect(x.zoneArmor).not.toBe(y.zoneArmor);
    expect(x.plates).not.toBe(y.plates);
  });
});
