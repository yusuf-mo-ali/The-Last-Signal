import { describe, expect, it } from 'vitest';
import { FACILITY } from '../world/levels/facility';
import { ADAPTATION_GUARDRAILS, ADAPTIVE_METRICS } from './adaptation';
import { BOSS_IDS, BOSSES } from './bosses';
import { COMBAT_FEEDBACK, COMBAT_RULES, HUMANOID_RIG } from './combat';
import { DROP_TABLE_IDS, DROP_TABLES, PICKUP_IDS, PICKUP_RULES, PICKUPS } from './drops';
import { CURRENCIES, REWARD_SOURCES } from './economy';
import { EFFECT_KINDS } from './effects';
import {
  AI_STATES,
  DAMAGE_ZONES,
  DEFAULT_ZONE_MULTIPLIERS,
  ENEMY_ARCHETYPE_IDS,
  ENEMY_ARCHETYPES,
  ENEMY_MODIFIER_IDS,
} from './enemies';
import { MUTATION_IDS, MUTATIONS } from './mutations';
import { ENVIRONMENT_STATES, SIGNAL_PHASES } from './signal';
import { UPGRADE_CHOICES_PER_OFFER, UPGRADE_IDS, UPGRADE_TAGS, UPGRADES } from './upgrades';
import { TRAINING_DUMMIES, TRAINING_DUMMY_KINDS, TRAINING_RANGE } from './training';
import { DIFFICULTY_TIERS, FINAL_WAVE, MUTATION_FREE_WAVES } from './waves';
import {
  LOADOUT_CATEGORIES,
  PLANNED_WEAPON_IDS,
  STARTING_LOADOUT,
  WEAPON_IDS,
  WEAPON_ROLES,
  WEAPON_RULES,
  WEAPONS,
} from './weapons';

const unique = (items: readonly string[]) => new Set(items).size === items.length;

/** True if the inclusive ranges cover 1..last with no gap or overlap. */
function coversWaves(ranges: readonly { firstWave: number; lastWave: number }[], last: number) {
  let next = 1;
  for (const r of ranges) {
    if (r.firstWave !== next || r.lastWave < r.firstWave) {
      return false;
    }
    next = r.lastWave + 1;
  }
  return next === last + 1;
}

describe('gameplay config skeletons (plan §31)', () => {
  it('uses unique ids everywhere', () => {
    for (const ids of [
      WEAPON_IDS,
      ENEMY_ARCHETYPE_IDS,
      ENEMY_MODIFIER_IDS,
      DAMAGE_ZONES,
      AI_STATES,
      MUTATION_IDS,
      UPGRADE_IDS,
      UPGRADE_TAGS,
      BOSS_IDS,
      ADAPTIVE_METRICS,
      CURRENCIES,
      REWARD_SOURCES,
      ENVIRONMENT_STATES,
      EFFECT_KINDS,
    ]) {
      expect(unique(ids), ids.join()).toBe(true);
    }
  });

  it('weapons: the plan §9 weapons all have roles; Phase 2 implements Bare Hands and the Pistol', () => {
    expect(WEAPON_IDS).toEqual(['bareHands', 'pistol']);
    for (const id of ['pistol', 'assaultRifle', 'shotgun']) {
      expect(WEAPON_ROLES).toHaveProperty(id);
    }
    expect(Object.keys(WEAPON_ROLES).sort()).toEqual([...WEAPON_IDS, ...PLANNED_WEAPON_IDS].sort());
    expect(unique([...WEAPON_IDS, ...PLANNED_WEAPON_IDS])).toBe(true);
  });

  it('weapons: definitions match their ids, kinds and loadout categories (D-039)', () => {
    expect(LOADOUT_CATEGORIES).toEqual(['primary', 'secondary', 'melee']);
    for (const id of WEAPON_IDS) {
      const def = WEAPONS[id];
      expect(def.id).toBe(id);
      expect(def.fits.length).toBeGreaterThan(0);
      if (def.kind === 'melee') {
        expect(def.fits).toEqual(['melee']);
      } else {
        expect(def.fits).not.toContain('melee');
      }
      expect(WEAPON_ROLES[id].category).toBe(def.fits[0]);
    }
    expect(WEAPONS.pistol.fits).toEqual(['primary', 'secondary']);
    expect(STARTING_LOADOUT).toEqual({
      melee: 'bareHands',
      primary: 'pistol',
      secondary: 'locked',
    });
    expect(WEAPON_RULES.secondaryUnlockAfterWave).toBe(5);
  });

  it('weapons: the Pistol has sane Pass-1 values (GAME_DESIGN §5)', () => {
    const p = WEAPONS.pistol;
    expect(p.fireMode).toBe('semi');
    expect(p.reserveAmmo).toBe(Infinity); // D-039: unlimited reserve
    expect(p.pellets).toBe(1);
    expect(p.fireRate).toBeGreaterThan(0);
    expect(p.fireRate).toBeLessThanOrEqual(60);
    expect(p.magazineSize).toBeGreaterThanOrEqual(6);
    expect(p.falloff.start).toBeLessThan(p.falloff.end);
    expect(p.falloff.end).toBeLessThanOrEqual(p.range);
    expect(p.falloff.minFactor).toBeGreaterThan(0);
    expect(p.falloff.minFactor).toBeLessThanOrEqual(1);
    expect(p.spread.crouchMultiplier).toBeLessThan(1);
    expect(p.spread.movingMultiplier).toBeGreaterThan(1);
    expect(p.spread.airborneMultiplier).toBeGreaterThan(p.spread.movingMultiplier);
    expect(p.recoil.pitchVarianceDeg).toBeLessThan(p.recoil.pitchDeg);
    // The kick settles back within one shot interval: the Pistol stays a precision weapon.
    expect(
      (p.recoil.pitchDeg + p.recoil.pitchVarianceDeg) / p.recoil.recoveryDegPerSecond,
    ).toBeLessThanOrEqual(1 / p.fireRate + 1e-9);
    // Time-to-kill intent against a 100-health Walker: 4–5 body shots, 1–2 headshots.
    expect(Math.ceil(100 / p.damage)).toBeGreaterThanOrEqual(4);
    expect(Math.ceil(100 / p.damage)).toBeLessThanOrEqual(5);
    expect(Math.ceil(100 / (p.damage * p.headshotMultiplier))).toBeLessThanOrEqual(2);
  });

  it('enemies: plan damage zones and multipliers, five archetypes, four in v1', () => {
    expect(DEFAULT_ZONE_MULTIPLIERS).toEqual({
      HEAD: 2.5,
      TORSO: 1,
      ARM_LEFT: 0.65,
      ARM_RIGHT: 0.65,
      LEG_LEFT: 0.5,
      LEG_RIGHT: 0.5,
    });
    expect(AI_STATES).toEqual(['IDLE', 'PATROL', 'DETECT', 'CHASE', 'ATTACK', 'STAGGER', 'DEAD']);
    expect(ENEMY_ARCHETYPE_IDS).toHaveLength(5);
    expect(Object.values(ENEMY_ARCHETYPES).filter((a) => a.inV1)).toHaveLength(4);
  });

  it('waves: plan tiers cover waves 1–20 exactly; mutation-free start', () => {
    expect(FINAL_WAVE).toBe(20);
    expect(coversWaves(DIFFICULTY_TIERS, FINAL_WAVE)).toBe(true);
    expect(DIFFICULTY_TIERS.at(-1)?.id).toBe('boss');
    expect(MUTATION_FREE_WAVES).toBeLessThan(FINAL_WAVE);
  });

  it('mutations: the plan’s eight, six in v1, using known effect kinds', () => {
    expect(MUTATION_IDS).toHaveLength(8);
    expect(Object.keys(MUTATIONS).sort()).toEqual([...MUTATION_IDS].sort());
    expect(Object.values(MUTATIONS).filter((m) => m.inV1)).toHaveLength(6);
    for (const mutation of Object.values(MUTATIONS)) {
      expect(mutation.effectKinds.length).toBeGreaterThan(0);
      for (const kind of mutation.effectKinds) {
        expect(EFFECT_KINDS).toContain(kind);
      }
    }
  });

  it('upgrades: at least 12 usable upgrades with valid tags, plan names included', () => {
    const usable = Object.values(UPGRADES).filter((u) => !u.blocked);
    expect(usable.length).toBeGreaterThanOrEqual(12);
    expect(Object.keys(UPGRADES).sort()).toEqual([...UPGRADE_IDS].sort());
    for (const u of Object.values(UPGRADES)) {
      expect(u.tags.length).toBeGreaterThan(0);
      for (const tag of u.tags) {
        expect(UPGRADE_TAGS).toContain(tag);
      }
    }
    const planNames = Object.values(UPGRADES)
      .filter((u) => u.source === 'plan')
      .map((u) => u.name);
    expect(planNames).toEqual(
      expect.arrayContaining([
        'Gunner',
        'Executioner',
        'Adrenaline',
        'Scavenger',
        'Vampire',
        'Heavy Hands',
        'Technician',
      ]),
    );
    expect(UPGRADES.technician.blocked).toBe(true);
    expect(UPGRADE_CHOICES_PER_OFFER).toBe(3);
  });

  it('bosses: one boss in v1, at the final wave, with descending phase thresholds', () => {
    const v1 = BOSS_IDS.filter((id) => BOSSES[id].inV1);
    expect(v1).toEqual(['siren']);
    expect(BOSSES.siren.wave).toBe(FINAL_WAVE);
    const thresholds = BOSSES.siren.phases.map((p) => p.fromHealthFraction);
    expect(thresholds[0]).toBe(1);
    expect([...thresholds].sort((a, b) => b - a)).toEqual(thresholds);
  });

  it('signal: the plan’s five phases cover waves 1–20 with valid environments', () => {
    expect(SIGNAL_PHASES).toHaveLength(5);
    expect(coversWaves(SIGNAL_PHASES, FINAL_WAVE)).toBe(true);
    for (const phase of SIGNAL_PHASES) {
      expect(ENVIRONMENT_STATES).toContain(phase.baseEnvironment);
    }
  });

  it('adaptation and economy: plan metrics, two currencies, guardrails sane', () => {
    expect(ADAPTIVE_METRICS).toHaveLength(11);
    expect(CURRENCIES).toEqual(['xp', 'scrap']);
    expect(ADAPTATION_GUARDRAILS.firstAdaptiveWave).toBeGreaterThan(MUTATION_FREE_WAVES);
    expect(ADAPTATION_GUARDRAILS.maxActiveAdaptations).toBeGreaterThan(0);
  });
});

describe('combat data (Phase 3, D-041)', () => {
  it('rules: a positive damage floor and stagger window', () => {
    expect(COMBAT_RULES.minimumDamage).toBeGreaterThan(0);
    expect(COMBAT_RULES.staggerWindow).toBeGreaterThan(0);
  });

  it('the humanoid rig covers every damage zone with positive radii', () => {
    expect([...new Set(HUMANOID_RIG.shapes.map((s) => s.zone))].sort()).toEqual(
      [...DAMAGE_ZONES].sort(),
    );
    expect(HUMANOID_RIG.shapes.every((s) => s.radius > 0)).toBe(true);
  });

  it('feedback timings: a kill marker outlasts a headshot, which outlasts a hit', () => {
    expect(COMBAT_FEEDBACK.killMarkerTime).toBeGreaterThan(COMBAT_FEEDBACK.headshotMarkerTime);
    expect(COMBAT_FEEDBACK.headshotMarkerTime).toBeGreaterThan(COMBAT_FEEDBACK.hitMarkerTime);
    expect(COMBAT_FEEDBACK.maxDamageNumbers).toBeGreaterThan(0);
  });

  it('drops: every table names known pickups with probabilities in [0, 1]', () => {
    for (const id of DROP_TABLE_IDS) {
      for (const entry of DROP_TABLES[id]) {
        expect(PICKUP_IDS).toContain(entry.pickup);
        expect(entry.chance).toBeGreaterThanOrEqual(0);
        expect(entry.chance).toBeLessThanOrEqual(1);
      }
    }
    for (const id of PICKUP_IDS) {
      const p = PICKUPS[id];
      expect(p.id).toBe(id);
      expect(p.magazines).toBeGreaterThan(0);
      expect(p.radius).toBeGreaterThan(0);
      expect(p.lifetime).toBeGreaterThan(0);
    }
    expect(PICKUP_RULES.maxActive).toBeGreaterThan(0);
  });

  it('training dummies: a standard dummy stands in for a 100-health Walker; zoned is tougher', () => {
    for (const kind of TRAINING_DUMMY_KINDS) {
      const d = TRAINING_DUMMIES[kind];
      expect(d.kind).toBe(kind);
      expect(d.health).toBeGreaterThan(0);
      expect(d.respawnDelay).toBeGreaterThan(0);
      expect(d.drops === null || DROP_TABLE_IDS.includes(d.drops)).toBe(true);
    }
    expect(TRAINING_DUMMIES.standard.health).toBe(100);
    expect(TRAINING_DUMMIES.zoned.showZones).toBe(true);
    expect(TRAINING_DUMMIES.zoned.health).toBeGreaterThan(TRAINING_DUMMIES.standard.health);
  });

  it('the range has both kinds, each dummy on the level floor, facing the spawn', () => {
    const kinds = new Set(TRAINING_RANGE.dummies.map((d) => d.kind));
    expect([...kinds].sort()).toEqual([...TRAINING_DUMMY_KINDS].sort());
    for (const d of TRAINING_RANGE.dummies) {
      expect(d.position[1]).toBe(0);
      expect(d.yaw).toBeCloseTo(Math.PI, 12);
      expect(Math.abs(d.position[0])).toBeLessThan(20);
      expect(d.position[2]).toBeLessThan(FACILITY.spawn.position[2]);
    }
  });
});
