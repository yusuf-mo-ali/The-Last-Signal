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
        const f = EFFECT_CLAMPS.frenzy;
        if (p.frenzyDuration !== undefined) {
          expect(p.frenzyDuration, where).toBeLessThanOrEqual(f.duration);
          expect(p.frenzyCooldownScale, where).toBeGreaterThanOrEqual(f.cooldownScale);
          expect(p.frenzyCooldownScale, where).toBeLessThanOrEqual(1);
          expect(p.frenzyWindupScale, where).toBeGreaterThanOrEqual(f.windupScale);
          expect(p.frenzyWindupScale, where).toBeLessThanOrEqual(1);
          expect(p.frenzyTurnScale, where).toBeGreaterThanOrEqual(1);
          expect(p.frenzyTurnScale, where).toBeLessThanOrEqual(f.turnScale);
          expect(p.frenzyStaggerScale, where).toBeGreaterThanOrEqual(1);
          expect(p.frenzyStaggerScale, where).toBeLessThanOrEqual(f.staggerScale);
        }
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
      const g = p.glitch;
      if (g) {
        expect(g.tearBands, where).toBeGreaterThanOrEqual(1);
        expect(g.tearBands, where).toBeLessThanOrEqual(s.tearBands);
        expect(g.maxShift, where).toBeLessThanOrEqual(s.maxShift);
        expect(g.chroma, where).toBeLessThanOrEqual(s.chroma);
        expect(g.ghost, where).toBeLessThanOrEqual(s.ghost);
        expect(g.desync, where).toBeLessThanOrEqual(s.desync);
        expect(g.stepRate, where).toBeGreaterThan(0);
        expect(g.stepRate, where).toBeLessThanOrEqual(s.stepRate);
      }
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

  it('STATIC is presented as Signal Glitch and distorts the 3D image, not only the screen', () => {
    expect(MUTATIONS.STATIC.name).toBe('Signal Glitch');
    const screen = MUTATIONS.STATIC.effects.find((e) => e.kind === 'screen');
    expect(screen?.params.glitch).toBeDefined();
    expect(screen?.params.glitch?.desync).toBeGreaterThan(0);
  });

  it('DEATH CRY frenzies those who hear it, without reinforcements (D-046)', () => {
    const cry = MUTATIONS.SCREAM.effects[0];
    expect(cry?.kind === 'trigger' && cry.params?.frenzyDuration).toBeGreaterThan(0);
  });

  it('BLOOD MOON is guaranteed once on waves 9–12; no other mutation has a guarantee', () => {
    expect(MUTATIONS.BLOOD_MOON.minWave).toBe(9);
    expect(MUTATIONS.BLOOD_MOON.guarantee).toEqual({ by: 12 });
    for (const id of MUTATION_IDS) {
      const g = MUTATIONS[id].guarantee;
      if (g) {
        expect(g.by, id).toBeGreaterThanOrEqual(MUTATIONS[id].minWave);
        expect(g.by, id).toBeLessThan(FINAL_WAVE);
      } else {
        expect(id).not.toBe('BLOOD_MOON');
      }
    }
    expect(MUTATION_IDS.filter((id) => MUTATIONS[id].guarantee)).toEqual(['BLOOD_MOON']);
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
  it('a blackout is dark, above the floor, with glowing eyes on silhouettes (D-046)', () => {
    const b = { ...BASE_ENVIRONMENT, ...ENVIRONMENT_OVERLAYS.blackout };
    expect(b.ambient).toBeGreaterThanOrEqual(ENVIRONMENT_FLOORS.ambientFloor);
    expect(b.ambient).toBeLessThanOrEqual(0.15);
    expect(b.sun).toBeLessThanOrEqual(0.05);
    expect(b.eyeGlow).toBeGreaterThanOrEqual(ENVIRONMENT_FLOORS.eyeGlowInDark);
    expect(b.proximity).toBeGreaterThanOrEqual(ENVIRONMENT_FLOORS.proximityInDark);
    expect(b.silhouette).toBeGreaterThan(0.5);
    expect(b.silhouette).toBeLessThanOrEqual(1);
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
      eyeGlow: 0,
      silhouette: 0,
      proximity: 0,
      muzzleLight: 0,
    });
  });
});
