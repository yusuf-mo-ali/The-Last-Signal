/**
 * The adaptive vocabulary as data (D-026, D-047): every adaptation is well formed, stays inside the
 * guardrails and the generator's own clamps, and can never reach for what a mutation owns.
 */

import { describe, expect, it } from 'vitest';
import {
  ADAPTATION_FAMILIES,
  ADAPTATION_GUARDRAILS,
  ADAPTATION_IDS,
  ADAPTATIONS,
  ADAPTIVE_METRICS,
  MUTATION_DISCOUNT,
  PLAN_METRIC_SIGNALS,
  PROFILE_RULES,
  SIGNAL_IDS,
  signalFamily,
  type AdaptiveResponse,
} from './adaptation';
import { DEFAULT_ROSTER, IMPLEMENTED_ENEMY_IDS } from './enemies';
import { ENABLED_MUTATION_IDS } from './mutations';
import { WAVE_RULES } from './waves';

const responses = (): [string, AdaptiveResponse][] =>
  ADAPTATION_IDS.flatMap((id) =>
    ADAPTATIONS[id].variants.flatMap((v) =>
      v.levels.flatMap((r, i): [string, AdaptiveResponse][] => {
        const label = `${id}/${v.key}/L${i + 1}`;
        return r.extra?.fallback
          ? [
              [label, r],
              [`${label} fallback`, r.extra.fallback],
            ]
          : [[label, r]];
      }),
    ),
  );

describe('adaptation data (D-047)', () => {
  it('every plan metric maps to a measured signal family', () => {
    for (const metric of ADAPTIVE_METRICS) {
      const family = PLAN_METRIC_SIGNALS[metric];
      expect(
        SIGNAL_IDS.some((s) => signalFamily(s) === family),
        metric,
      ).toBe(true);
    }
  });

  it('every adaptation is keyed by its id, in a known family, with real signals', () => {
    for (const id of ADAPTATION_IDS) {
      const a = ADAPTATIONS[id];
      expect(a.id).toBe(id);
      expect(ADAPTATION_FAMILIES).toContain(a.family);
      expect(a.variants.length).toBeGreaterThan(0);
      expect(new Set(a.variants.map((v) => v.key)).size).toBe(a.variants.length);
      for (const v of a.variants) {
        expect(SIGNAL_IDS, `${id}/${v.key}`).toContain(v.signal);
        expect(v.signal.startsWith('strain'), 'strain is the governor, not a trigger').toBe(false);
      }
      if (a.gate) {
        expect(SIGNAL_IDS).toContain(a.gate.signal);
      }
    }
    expect(new Set(ADAPTATION_IDS.map((id) => ADAPTATIONS[id].priority)).size).toBe(
      ADAPTATION_IDS.length,
    );
  });

  it('hysteresis: every exit sits below its enter, for the signal and the confidence', () => {
    for (const id of ADAPTATION_IDS) {
      const { threshold, confidence } = ADAPTATIONS[id];
      expect(threshold.exit, id).toBeLessThan(threshold.enter);
      expect(confidence.exit, id).toBeLessThan(confidence.enter);
      expect(threshold.enter).toBeLessThanOrEqual(1);
      expect(confidence.enter).toBeLessThanOrEqual(1);
    }
  });

  it('one wave of perfect evidence never reaches any confidence to enter (≥ 2 waves needed)', () => {
    // A single full wave: mass 1, persistence 1 ⇒ confidence 1 / massFull.
    const oneWave = 1 / PROFILE_RULES.massFull;
    for (const id of ADAPTATION_IDS) {
      expect(oneWave, id).toBeLessThan(ADAPTATIONS[id].confidence.enter);
    }
    expect(ADAPTATION_GUARDRAILS.minWavesOfEvidence).toBeGreaterThanOrEqual(2);
  });

  it('timers: rest after ending, a forced fade, never before wave 5', () => {
    for (const id of ADAPTATION_IDS) {
      const a = ADAPTATIONS[id];
      expect(a.cooldownWaves, id).toBeGreaterThanOrEqual(1);
      expect(a.maxActiveWaves, id).toBeGreaterThanOrEqual(2);
      expect(a.firstWave, id).toBeGreaterThanOrEqual(ADAPTATION_GUARDRAILS.firstAdaptiveWave);
    }
    expect(ADAPTATION_GUARDRAILS.firstAdaptiveWave).toBe(5);
    expect(ADAPTATION_GUARDRAILS.maxActiveAdaptations).toBe(2);
  });

  it('every response stays inside the adaptive caps and the generator’s clamps', () => {
    const [lo, hi] = ADAPTATION_GUARDRAILS.caps.weight;
    expect(lo).toBeGreaterThanOrEqual(WAVE_RULES.modifierClamp.weight[0]);
    expect(hi).toBeLessThanOrEqual(WAVE_RULES.modifierClamp.weight[1]);
    expect(ADAPTATION_GUARDRAILS.caps.traitTotal).toBeLessThanOrEqual(
      WAVE_RULES.modifierClamp.traitChance,
    );
    for (const [label, r] of responses()) {
      for (const [a, w] of Object.entries(r.archetypeWeights ?? {})) {
        expect(DEFAULT_ROSTER, `${label}: ${a} is a roster archetype`).toContain(a);
        expect(w, label).toBeGreaterThanOrEqual(lo);
        expect(w, label).toBeLessThanOrEqual(hi);
      }
      if (r.subjectWeight !== undefined) {
        expect(r.subjectWeight).toBeLessThanOrEqual(hi);
      }
      const traits = Object.values(r.traitChance ?? {}).reduce((sum, v) => sum + v, 0);
      expect(traits, label).toBeLessThanOrEqual(ADAPTATION_GUARDRAILS.caps.traitTotal);
      expect(
        Object.keys(r.traitChance ?? {}).every((t) => t !== 'elite'),
        label,
      ).toBe(true);
      if (r.extra) {
        expect(IMPLEMENTED_ENEMY_IDS).toContain(r.extra.archetype);
        expect(DEFAULT_ROSTER).not.toContain(r.extra.archetype);
        expect(WAVE_RULES.adaptiveUnlocks[r.extra.archetype]).toBeDefined();
        expect(r.extra.count).toBeLessThanOrEqual(WAVE_RULES.extraArchetypeMax);
      }
      // Nothing a mutation owns (D-045), by construction of the type and checked here.
      for (const key of ['budgetMultiplier', 'eliteMaxBonus', 'eliteMinimum', 'surges']) {
        expect(r, label).not.toHaveProperty(key);
      }
    }
  });

  it('level 2 never asks for less than level 1 (escalation only escalates)', () => {
    for (const id of ADAPTATION_IDS) {
      for (const v of ADAPTATIONS[id].variants) {
        const [l1, l2] = v.levels;
        for (const [a, w] of Object.entries(l1.archetypeWeights ?? {})) {
          expect(
            l2.archetypeWeights?.[a as keyof typeof l2.archetypeWeights] ?? 1,
            `${id} ${a}`,
          ).toBeGreaterThanOrEqual(w);
        }
        expect(l2.subjectWeight ?? 1).toBeGreaterThanOrEqual(l1.subjectWeight ?? 1);
        expect(l2.extra?.count ?? 0).toBeGreaterThanOrEqual(l1.extra?.count ?? 0);
      }
    }
  });

  it('mutation discounts only shrink evidence, and name only enabled mutations', () => {
    for (const [mutation, discounts] of Object.entries(MUTATION_DISCOUNT)) {
      expect(ENABLED_MUTATION_IDS).toContain(mutation);
      for (const d of Object.values(discounts)) {
        expect(d).toBeGreaterThan(0);
        expect(d).toBeLessThan(1);
      }
    }
  });

  it('WEAPON_FOCUS is dormant while only one firearm exists; everything else is live', () => {
    expect(ADAPTATIONS.WEAPON_FOCUS.status).toBe('dormant');
    for (const id of ADAPTATION_IDS.filter((x) => x !== 'WEAPON_FOCUS')) {
      expect(ADAPTATIONS[id].status, id).toBeUndefined();
    }
  });

  it('every analysis line is written, and the climber response says so', () => {
    for (const id of ADAPTATION_IDS) {
      const { analysis } = ADAPTATIONS[id];
      for (const line of [analysis.enter, analysis.escalate, analysis.fade]) {
        expect(line.length, id).toBeGreaterThan(10);
      }
    }
    expect(ADAPTATIONS.HIGH_GROUND.analysis.enter).toMatch(/Climbers/);
  });
});
