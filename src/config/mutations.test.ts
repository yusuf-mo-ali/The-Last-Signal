/**
 * The mutation catalogue as data (D-045): the approved v1 set (O-4), the deferred two kept but
 * unselectable, the Death Cry naming, and every effect inside the guardrails, so no mutation can
 * make a wave impossible through its data.
 */

import { describe, expect, it } from 'vitest';
import { EFFECT_CLAMPS, ENVIRONMENT_OVERLAY_IDS, type Effect } from './effects';
import { BASE_ENVIRONMENT, ENVIRONMENT_FLOORS, ENVIRONMENT_OVERLAYS } from './environment';
import {
  ENABLED_MUTATION_IDS,
  MUTATION_IDS,
  MUTATIONS,
  mutationEffectKinds,
  type MutationId,
} from './mutations';
import { DIFFICULTY_TIER_IDS, FINAL_WAVE, MUTATION_FREE_WAVES, WAVE_RULES } from './waves';

const clamp = WAVE_RULES.modifierClamp;

function checkEffect(id: MutationId, effect: Effect): void {
  const where = `${id} ${effect.kind}`;
  switch (effect.kind) {
    case 'stat':
      if (effect.target.startsWith('enemy.')) {
        expect(effect.op, where).toBe('mul');
        const [lo, hi] = EFFECT_CLAMPS.enemySpeedMultiplier;
        expect(effect.value, where).toBeGreaterThanOrEqual(lo);
        expect(effect.value, where).toBeLessThanOrEqual(hi);
      }
      break;
    case 'trigger':
      if (effect.action === 'deathCry') {
        const p = effect.params ?? {};
        const a = EFFECT_CLAMPS.alarm;
        expect(p.radius, where).toBeGreaterThan(0);
        expect(p.radius, where).toBeLessThanOrEqual(a.radius);
        expect(p.alertDuration, where).toBeLessThanOrEqual(a.alertDuration);
        expect(p.hasteMultiplier, where).toBeGreaterThanOrEqual(1);
        expect(p.hasteMultiplier, where).toBeLessThanOrEqual(a.hasteMultiplier);
        expect(p.hasteDuration, where).toBeLessThanOrEqual(a.hasteDuration);
      }
      break;
    case 'spawnRule': {
      const c = effect.composition;
      if (c?.budgetMultiplier !== undefined) {
        expect(c.budgetMultiplier, where).toBeGreaterThanOrEqual(clamp.budget[0]);
        expect(c.budgetMultiplier, where).toBeLessThanOrEqual(clamp.budget[1]);
      }
      for (const chance of Object.values(c?.traitChance ?? {})) {
        expect(Math.abs(chance), where).toBeLessThanOrEqual(clamp.traitChance);
      }
      expect(c?.eliteMaxBonus ?? 0, where).toBeLessThanOrEqual(clamp.eliteMaxBonus);
      expect(c?.eliteMinimum ?? 0, where).toBeLessThanOrEqual(clamp.eliteMinimum);
      const s = effect.surges;
      if (s) {
        expect(s.at.length, where).toBeLessThanOrEqual(clamp.surges.count);
        expect(s.at, where).toEqual([...s.at].sort((x, y) => x - y));
        expect(
          s.at.every((f) => f > 0 && f < 1),
          where,
        ).toBe(true);
        expect(s.extraGroupSize, where).toBeLessThanOrEqual(clamp.surges.extraGroupSize);
        expect(s.warning, where).toBeGreaterThanOrEqual(clamp.surges.warning[0]);
        expect(s.warning, where).toBeLessThanOrEqual(clamp.surges.warning[1]);
      }
      break;
    }
    case 'environment':
      expect(ENVIRONMENT_OVERLAY_IDS, where).toContain(effect.overlay);
      for (const fade of [effect.fadeIn, effect.fadeOut]) {
        expect(fade, where).toBeGreaterThanOrEqual(EFFECT_CLAMPS.fade[0]);
        expect(fade, where).toBeLessThanOrEqual(EFFECT_CLAMPS.fade[1]);
      }
      break;
    case 'screen': {
      const p = effect.params;
      const s = EFFECT_CLAMPS.static;
      expect(p.opacity, where).toBeGreaterThan(0);
      expect(p.opacity, where).toBeLessThanOrEqual(s.opacity);
      expect(p.durationMin, where).toBeGreaterThan(0);
      expect(p.durationMin, where).toBeLessThanOrEqual(p.durationMax);
      expect(p.durationMax, where).toBeLessThanOrEqual(s.durationMax);
      expect(p.intervalMin, where).toBeGreaterThanOrEqual(s.intervalMin);
      expect(p.intervalMin, where).toBeLessThanOrEqual(p.intervalMax);
      expect(p.firstAfter, where).toBeGreaterThanOrEqual(s.firstAfter);
      break;
    }
  }
}

describe('mutation catalogue (D-045)', () => {
  it('O-4: the six approved mutations are enabled; LOW GRAVITY and OVERLOAD are deferred', () => {
    expect([...ENABLED_MUTATION_IDS].sort()).toEqual(
      ['BLACKOUT', 'BLOOD_MOON', 'HIVE', 'HUNGER', 'SCREAM', 'STATIC'].sort(),
    );
    expect(MUTATIONS.LOW_GRAVITY.status).toBe('deferred');
    expect(MUTATIONS.OVERLOAD.status).toBe('deferred');
    for (const id of MUTATION_IDS) {
      expect(MUTATIONS[id].id).toBe(id);
    }
  });

  it('SCREAM is presented as Death Cry, never confusable with the Screamer', () => {
    expect(MUTATIONS.SCREAM.name).toBe('Death Cry');
    expect(MUTATIONS.SCREAM.name.toLowerCase()).not.toContain('scream');
    expect(MUTATIONS.SCREAM.effects).toEqual([
      expect.objectContaining({ kind: 'trigger', on: 'enemy:died', action: 'deathCry' }),
    ]);
  });

  it('deferred mutations stay representable as data (targets the runtime does not register)', () => {
    expect(MUTATIONS.LOW_GRAVITY.effects).toEqual([
      expect.objectContaining({ kind: 'stat', target: 'world.gravity' }),
    ]);
    expect(MUTATIONS.OVERLOAD.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'trigger', action: 'environmentPulse' }),
        expect.objectContaining({ kind: 'stat', target: 'weapon.recoil' }),
      ]),
    );
  });

  it('each v1 mutation uses the effect kinds of its design', () => {
    expect(mutationEffectKinds('BLACKOUT')).toEqual(['environment']);
    expect(mutationEffectKinds('HUNGER')).toEqual(['stat']);
    expect(mutationEffectKinds('STATIC')).toEqual(['screen']);
    expect(mutationEffectKinds('SCREAM')).toEqual(['trigger']);
    expect(mutationEffectKinds('HIVE')).toEqual(['spawnRule']);
    expect(mutationEffectKinds('BLOOD_MOON').sort()).toEqual(['environment', 'spawnRule']);
  });

  it('O-7: none before wave 4, none on the final wave; every v1 mutation can appear', () => {
    for (const id of MUTATION_IDS) {
      const m = MUTATIONS[id];
      expect(m.minWave, id).toBeGreaterThan(MUTATION_FREE_WAVES);
      expect(m.minWave, id).toBeLessThan(FINAL_WAVE);
      expect(m.weights.introduction, id).toBe(0);
      expect(m.weights.boss, id).toBe(0);
      for (const tier of DIFFICULTY_TIER_IDS) {
        expect(m.weights[tier], `${id} ${tier}`).toBeGreaterThanOrEqual(0);
      }
      expect(m.weights.complex, id).toBeGreaterThan(0);
    }
  });

  it('the two visibility mutations share a group (never back to back)', () => {
    expect(MUTATIONS.BLACKOUT.group).toBe('vision');
    expect(MUTATIONS.STATIC.group).toBe('vision');
    expect(ENABLED_MUTATION_IDS.filter((id) => MUTATIONS[id].group === 'vision').sort()).toEqual([
      'BLACKOUT',
      'STATIC',
    ]);
  });

  it('every effect is inside the guardrails', () => {
    for (const id of MUTATION_IDS) {
      for (const effect of MUTATIONS[id].effects) {
        checkEffect(id, effect);
      }
    }
  });

  it('every mutation tells the player what changed and what to do', () => {
    for (const id of MUTATION_IDS) {
      const m = MUTATIONS[id];
      expect(m.name.length, id).toBeGreaterThan(2);
      expect(m.rule.length, id).toBeGreaterThan(10);
      expect(m.hint.length, id).toBeGreaterThan(10);
      expect(m.accent, id).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});

describe('environment overlays (D-028, D-045)', () => {
  it('a blackout stays above the visibility floor and keeps enemies glowing', () => {
    const b = { ...BASE_ENVIRONMENT, ...ENVIRONMENT_OVERLAYS.blackout };
    expect(b.ambient).toBeGreaterThanOrEqual(ENVIRONMENT_FLOORS.ambientFloor);
    expect(b.ambient).toBeLessThan(ENVIRONMENT_FLOORS.darkBelow);
    expect(b.eyeshine).toBeGreaterThanOrEqual(ENVIRONMENT_FLOORS.eyeshineInDark);
    expect(b.emergency).toBe(1);
    expect(b.muzzleLight).toBe(1);
  });

  it('a blood moon only tints: no visibility loss', () => {
    const r = { ...BASE_ENVIRONMENT, ...ENVIRONMENT_OVERLAYS.bloodMoon };
    expect(r.ambient).toBeGreaterThanOrEqual(0.85);
    expect(r.sun).toBeGreaterThanOrEqual(0.8);
    expect(r.emergency).toBe(0);
  });

  it('the base environment is the unchanged normal look', () => {
    expect(BASE_ENVIRONMENT).toMatchObject({
      ambient: 1,
      sun: 1,
      tintAmount: 0,
      emergency: 0,
      eyeshine: 0,
      muzzleLight: 0,
    });
  });
});
