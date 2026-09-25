import { describe, expect, it } from 'vitest';
import { ADAPTATION_GUARDRAILS, ADAPTIVE_METRICS } from './adaptation';
import { BOSS_IDS, BOSSES } from './bosses';
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
import { DIFFICULTY_TIERS, FINAL_WAVE, MUTATION_FREE_WAVES } from './waves';
import { WEAPON_IDS, WEAPON_ROLES } from './weapons';

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

  it('weapons: the three initial weapons (plan §42) with design roles', () => {
    expect(WEAPON_IDS).toEqual(['pistol', 'assaultRifle', 'shotgun']);
    expect(Object.keys(WEAPON_ROLES).sort()).toEqual([...WEAPON_IDS].sort());
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
