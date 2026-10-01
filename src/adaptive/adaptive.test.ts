/**
 * The adaptive core (D-026, D-047), pure functions only: measuring a wave, the profile's maths,
 * the director's decisions and the composition they produce. Exact values where the maths is
 * exact; properties over many seeded behaviour sequences for the guardrails.
 */

import { describe, expect, it } from 'vitest';
import {
  ADAPTATION_GUARDRAILS,
  ADAPTATION_IDS,
  ADAPTATIONS,
  PROFILE_RULES,
  type SignalId,
} from '../config/adaptation';
import { WAVE_RULES } from '../config/waves';
import { FACILITY_SPAWN_POINTS } from '../world/levels/facility';
import { Rng } from '../utils/Rng';
import { boostedArchetypes, composeModifiers, regionsNear } from './compose';
import { decide, governorOn } from './director';
import { bestDwellArea, dwellCell, emptyTelemetry, measureWave } from './measure';
import { confidence, emptyProfile, foldEvidence, memoryOf, normalizeProfile } from './profile';
import {
  EMPTY_STATE,
  type ActiveAdaptation,
  type AdaptationState,
  type BehaviorProfile,
  type WaveEvidence,
} from './types';

const SAMPLE_SECONDS = 0.25;

/** Evidence for a wave: each signal as [score, weight]; a full positional weight by default. */
function evidence(
  wave: number,
  signals: Partial<Record<SignalId, readonly [number, number]>>,
  dwellCentroid: [number, number] | null = null,
): WaveEvidence {
  const out: Record<string, { score: number; weight: number }> = {
    elevation: { score: 0, weight: 1 },
  };
  for (const [id, [score, weight]] of Object.entries(signals)) {
    out[id] = { score, weight };
  }
  return { wave, signals: out, dwellCentroid };
}

/** Folds `waves` and runs the director after each, as the system does. */
function run(
  waves: readonly WaveEvidence[],
  start: { profile?: BehaviorProfile; state?: AdaptationState } = {},
) {
  let profile = start.profile ?? emptyProfile();
  let state = start.state ?? EMPTY_STATE;
  const outcomes = [];
  for (const e of waves) {
    profile = foldEvidence(profile, e);
    const outcome = decide(profile, state, e.wave + 1);
    state = outcome.state;
    outcomes.push(outcome);
  }
  return { profile, state, outcomes };
}

const steady = (from: number, to: number, signals: Parameters<typeof evidence>[1]) =>
  Array.from({ length: to - from + 1 }, (_, i) => evidence(from + i, signals));

describe('measuring a wave (D-047)', () => {
  it('high ground and dwell: shares of position samples; the best 9 × 9 m block', () => {
    const t = emptyTelemetry(6, null);
    t.samples = 200;
    t.elevated = 120;
    // 80 ground samples: 60 in one cell, 15 next to it, 5 far away.
    t.dwell[dwellCell(10, 10)] = 60;
    t.dwell[dwellCell(13, 10)] = 15;
    t.dwell[dwellCell(-20, -20)] = 5;
    const e = measureWave(t, { sampleSeconds: SAMPLE_SECONDS });
    expect(e.signals.elevation).toEqual({ score: 0.6, weight: 1 }); // 50 s ≥ 45 s: a full wave
    expect(e.signals.dwell?.score).toBeCloseTo(75 / 80, 10);
    expect(e.signals.dwell?.weight).toBeCloseTo((80 * SAMPLE_SECONDS) / 45, 10);
    expect(e.dwellCentroid?.[0]).toBeCloseTo((60 * 10.5 + 15 * 13.5) / 75, 10);
    expect(bestDwellArea({})).toBeNull();
  });

  it('range: shares of hits per target archetype; attribution counts boosted ones at ¼', () => {
    const t = emptyTelemetry(9, null);
    t.hits.walker = { total: 20, close: 15, long: 0 };
    t.hits.tank = { total: 20, close: 20, long: 0 };
    const plain = measureWave(t, { sampleSeconds: SAMPLE_SECONDS });
    expect(plain.signals.closeRange).toEqual({ score: 35 / 40, weight: 1 });
    const attributed = measureWave(t, {
      sampleSeconds: SAMPLE_SECONDS,
      boosted: new Map([['closeRange', new Set(['tank'])]]),
    });
    // Tank hits count ¼: (15 + 5) / (20 + 5).
    expect(attributed.signals.closeRange?.score).toBeCloseTo(20 / 25, 10);
    expect(attributed.signals.closeRange?.weight).toBeCloseTo(25 / 40, 10);
    // Other signals are untouched by that attribution.
    expect(attributed.signals.longRange).toEqual(plain.signals.longRange);
  });

  it('mobility: half sprinting, half kiting; attributed per nearest archetype', () => {
    const t = emptyTelemetry(9, null);
    t.moves.runner = { samples: 100, sprint: 100, kite: 100 };
    t.moves.walker = { samples: 100, sprint: 0, kite: 50 };
    expect(measureWave(t, { sampleSeconds: SAMPLE_SECONDS }).signals.mobility?.score).toBeCloseTo(
      0.5 * (100 / 200) + 0.5 * (150 / 200),
      10,
    );
    const boosted = measureWave(t, {
      sampleSeconds: SAMPLE_SECONDS,
      boosted: new Map([['mobility', new Set(['runner'])]]),
    });
    expect(boosted.signals.mobility?.score).toBeCloseTo(0.5 * (25 / 125) + 0.5 * (75 / 125), 10);
  });

  it('hit zones, accuracy, priority, neglect and strain', () => {
    const t = emptyTelemetry(9, null);
    t.shots = 40;
    t.shotsHit = 30;
    t.firearmHits = 30;
    t.headHits = 18;
    t.support.screamer = { spawned: 3, completed: 2 };
    t.damageTaken = 50;
    t.samples = 10;
    const e = measureWave(t, { sampleSeconds: SAMPLE_SECONDS });
    expect(e.signals.headshot).toEqual({ score: 0.6, weight: 1 });
    expect(e.signals.accuracy).toEqual({ score: 0.75, weight: 1 });
    expect(e.signals['neglect.screamer']?.score).toBeCloseTo(2 / 3, 10);
    expect(e.signals['priority.screamer']?.score).toBeCloseTo(1 / 3, 10);
    expect(e.signals['neglect.spitter']).toEqual({ score: 0, weight: 0 });
    expect(e.signals.strain).toEqual({ score: 0.5, weight: 1 });
  });

  it('weapon focus is no evidence with a single firearm (dormant in V1)', () => {
    const t = emptyTelemetry(9, null);
    t.focus.precision = 40;
    t.firearmsOwned = 1;
    expect(
      measureWave(t, { sampleSeconds: SAMPLE_SECONDS }).signals['weaponFocus.precision'],
    ).toEqual({ score: 1, weight: 0 });
    t.firearmsOwned = 2;
    expect(
      measureWave(t, { sampleSeconds: SAMPLE_SECONDS }).signals['weaponFocus.precision']?.weight,
    ).toBe(1);
  });

  it('a mutated wave counts less for what the mutation pushes the player into', () => {
    const plain = emptyTelemetry(9, null);
    plain.hits.walker = { total: 40, close: 0, long: 30 };
    plain.firearmHits = 30;
    plain.headHits = 20;
    const dark = {
      ...emptyTelemetry(9, 'BLACKOUT'),
      hits: plain.hits,
      firearmHits: 30,
      headHits: 20,
    };
    const a = measureWave(plain, { sampleSeconds: SAMPLE_SECONDS });
    const b = measureWave(dark, { sampleSeconds: SAMPLE_SECONDS });
    expect(b.signals.longRange?.score).toBe(a.signals.longRange?.score);
    expect(b.signals.longRange?.weight).toBeCloseTo(0.4, 10);
    expect(b.signals.headshot?.weight).toBeCloseTo(0.4, 10);
    expect(b.signals.closeRange?.weight).toBe(a.signals.closeRange?.weight);
  });
});

describe('the profile: memory, decay and confidence (exact)', () => {
  const fold = (...scores: [number, number][]) =>
    scores.reduce(
      (p, [score, weight], i) => foldEvidence(p, evidence(i + 1, { mobility: [score, weight] })),
      emptyProfile(),
    );

  it('one extreme wave: confidence 0.5, never enough to enter anything', () => {
    const m = memoryOf(fold([1, 1]), 'mobility');
    expect(m).toEqual({ mean: 1, mass: 1, above: 1 });
    expect(confidence(m)).toBe(0.5);
    for (const id of ADAPTATION_IDS) {
      expect(confidence(m)).toBeLessThan(ADAPTATIONS[id].confidence.enter);
    }
  });

  it('two consistent waves: mass 1.7, confidence 0.85', () => {
    const m = memoryOf(fold([0.8, 1], [0.8, 1]), 'mobility');
    expect(m.mass).toBeCloseTo(1.7, 12);
    expect(m.mean).toBeCloseTo(0.8, 12);
    expect(confidence(m)).toBeCloseTo(0.85, 12);
  });

  it('one high wave and one low: confidence at most 0.5 (no persistence)', () => {
    for (const order of [
      [
        [0.9, 1],
        [0.1, 1],
      ],
      [
        [0.1, 1],
        [0.9, 1],
      ],
    ] as [number, number][][]) {
      expect(confidence(memoryOf(fold(...order), 'mobility'))).toBeLessThanOrEqual(0.5);
    }
  });

  it('decay: old evidence shrinks by 0.7 a wave; a wave under the minimum weight is no evidence', () => {
    let p = fold([1, 1], [1, 1]);
    const before = memoryOf(p, 'mobility');
    p = foldEvidence(p, evidence(3, { mobility: [0, PROFILE_RULES.minWeight / 2] }));
    const after = memoryOf(p, 'mobility');
    expect(after.mass).toBeCloseTo(before.mass * PROFILE_RULES.decay, 12);
    expect(after.mean).toBeCloseTo(before.mean, 12); // decay alone does not move the mean
    // Behaviour that stops: confidence falls under every exit within three waves.
    for (let w = 4; w <= 6; w++) {
      p = foldEvidence(p, evidence(w, { mobility: [0.1, 1] }));
    }
    expect(confidence(memoryOf(p, 'mobility'))).toBeLessThan(
      ADAPTATIONS.SKIRMISHER.confidence.exit,
    );
  });

  it('counts fought waves and keeps the last real dwell centroid', () => {
    let p = foldEvidence(emptyProfile(), evidence(1, { dwell: [0.9, 1] }, [3, 4]));
    expect(p.wavesObserved).toBe(1);
    expect(p.dwellCentroid).toEqual([3, 4]);
    p = foldEvidence(p, { wave: 2, signals: {}, dwellCentroid: [9, 9] });
    expect(p.wavesObserved).toBe(1); // no fight: no positional evidence
    expect(p.dwellCentroid).toEqual([3, 4]);
  });

  it('normalizeProfile: unknown keys dropped, values clamped, missing ones empty (no migration)', () => {
    const p = normalizeProfile({
      v: 1,
      wavesObserved: 4.7,
      signals: { mobility: { mean: 2, mass: 99, above: 50 }, someFutureSignal: { mean: 1 } },
      extra: 'ignored',
    });
    expect(p.wavesObserved).toBe(4);
    expect(p.signals.mobility?.mean).toBe(1);
    expect(p.signals.mobility?.mass).toBeCloseTo(1 / (1 - PROFILE_RULES.decay), 12);
    expect(Object.keys(p.signals)).toEqual(['mobility']);
    expect(normalizeProfile(null)).toEqual(emptyProfile());
  });
});

describe('the director: entering, staying, escalating, fading (D-026)', () => {
  it('one wave of evidence never enters; two consecutive waves do, from wave 5 only', () => {
    expect(run([evidence(5, { mobility: [1, 1] })]).state.active).toEqual([]);
    const two = run(steady(5, 6, { mobility: [0.8, 1] }));
    expect(two.state.active).toEqual([
      { id: 'SKIRMISHER', key: 'default', level: 1, since: 7, levelSince: 7 },
    ]);
    expect(two.outcomes[1]?.changes).toEqual([
      {
        id: 'SKIRMISHER',
        key: 'default',
        kind: 'enter',
        text: ADAPTATIONS.SKIRMISHER.analysis.enter,
      },
    ]);
    // The same evidence on waves 2–3 decides for wave 4: too early (D-026).
    expect(run(steady(2, 3, { mobility: [0.8, 1] })).state.active).toEqual([]);
  });

  it('hysteresis: between exit and enter it stays; below exit it fades and rests', () => {
    const entered = run(steady(5, 6, { mobility: [0.8, 1] }));
    // Mean falls between the bands: still active.
    const held = run([evidence(7, { mobility: [0.35, 0.3] })], entered);
    expect(held.state.active.map((a) => a.id)).toEqual(['SKIRMISHER']);
    // Clearly stopped: fades within a few waves, then rests two waves.
    const stopped = run(steady(7, 10, { mobility: [0, 1] }), entered);
    const fadeAt = stopped.outcomes.findIndex((o) => o.changes.some((c) => c.kind === 'fade'));
    expect(fadeAt).toBeGreaterThanOrEqual(0);
    const fadedFor = stopped.outcomes[fadeAt]?.forWave ?? 0;
    expect(stopped.outcomes[fadeAt]?.state.restUntil.SKIRMISHER).toBe(
      fadedFor + ADAPTATIONS.SKIRMISHER.cooldownWaves,
    );
  });

  it('hysteresis, exactly: a mean between exit and enter keeps it, never starts it', () => {
    const between = {
      ...emptyProfile(),
      wavesObserved: 4,
      // Mean 0.4: under SKIRMISHER's enter (0.45), over its exit (0.3); confidence 0.75.
      signals: { mobility: { mean: 0.4, mass: 2, above: 1.5 } },
    };
    const active: AdaptationState = {
      active: [{ id: 'SKIRMISHER', key: 'default', level: 1, since: 8, levelSince: 8 }],
      restUntil: {},
    };
    expect(decide(between, active, 9).state.active.map((a) => a.id)).toEqual(['SKIRMISHER']);
    expect(decide(between, EMPTY_STATE, 9).state.active).toEqual([]);
    const below = { ...between, signals: { mobility: { mean: 0.29, mass: 2, above: 1.5 } } };
    expect(decide(below, active, 9).changes.map((c) => c.kind)).toEqual(['fade']);
  });

  it('rest: an adaptation cannot re-enter before its cooldown ends', () => {
    const rested = { active: [], restUntil: { SKIRMISHER: 9 } };
    const strong = run(steady(5, 7, { mobility: [0.9, 1] }), { state: rested });
    // Decisions for waves 6, 7 and 8 are inside the rest; 9 is not reached here.
    expect(strong.state.active).toEqual([]);
    const later = run(steady(5, 8, { mobility: [0.9, 1] }), { state: rested });
    expect(later.state.active.map((a) => a.id)).toEqual(['SKIRMISHER']);
  });

  it('escalates to level 2 after two waves at level 1, and is made to fade after four', () => {
    const r = run(steady(5, 16, { mobility: [0.9, 1] }));
    const kinds = r.outcomes.map((o) => `${o.forWave}:${o.changes.map((c) => c.kind).join(',')}`);
    expect(kinds).toContain('7:enter');
    expect(kinds).toContain('9:escalate');
    expect(kinds).toContain('11:rest'); // shaped waves 7–10: maxActiveWaves 4, then a rest
    expect(kinds).toContain('13:enter'); // rested for waves 11 and 12, the evidence still there
  });

  it('families exclude each other; at most two adaptations, chosen by priority', () => {
    const everything = steady(5, 8, {
      elevation: [0.9, 1],
      mobility: [0.9, 1],
      closeRange: [0.9, 1],
      headshot: [0.9, 1],
      accuracy: [0.9, 1],
    });
    const r = run(everything);
    const ids = r.state.active.map((a) => a.id);
    expect(ids).toHaveLength(ADAPTATION_GUARDRAILS.maxActiveAdaptations);
    expect(ids).toEqual(['HIGH_GROUND', 'CLOSE_QUARTERS']); // stance before range; one per family
    expect(new Set(ids.map((id) => ADAPTATIONS[id].family)).size).toBe(ids.length);
  });

  it('gates: ENTRENCHED needs the ground; HEADHUNTER needs accuracy', () => {
    expect(
      run(steady(5, 6, { dwell: [0.9, 1], elevation: [0.5, 1] })).state.active.map((a) => a.id),
    ).toEqual(['HIGH_GROUND']);
    expect(run(steady(5, 6, { dwell: [0.9, 1] })).state.active.map((a) => a.id)).toEqual([
      'ENTRENCHED',
    ]);
    expect(run(steady(5, 6, { headshot: [0.9, 1], accuracy: [0.2, 1] })).state.active).toEqual([]);
    expect(
      run(steady(5, 6, { headshot: [0.9, 1], accuracy: [0.6, 1] })).state.active.map((a) => a.id),
    ).toEqual(['HEADHUNTER']);
  });

  it('NEGLECT picks the ignored archetype and names it', () => {
    const r = run(steady(5, 6, { 'neglect.spitter': [0.9, 1], 'neglect.screamer': [0.65, 1] }));
    expect(r.state.active).toEqual([
      { id: 'NEGLECT', key: 'spitter', level: 1, since: 7, levelSince: 7 },
    ]);
    expect(r.outcomes[1]?.changes[0]?.text).toBe(
      'You let the Spitters do their work. More of them are coming.',
    );
  });

  it('the strain governor: nothing enters or escalates, level 2 drops to 1', () => {
    const strained = { strain: [0.8, 1] as const };
    const blocked = run(steady(5, 6, { mobility: [0.9, 1], ...strained }));
    expect(blocked.state.active).toEqual([]);
    expect(blocked.outcomes[1]?.governor).toBe(true);
    expect(blocked.outcomes[1]?.changes).toEqual([
      { id: 'governor', key: 'governor', kind: 'hold', text: ADAPTATION_GUARDRAILS.strain.text },
    ]);
    // At level 2 since wave 9 (shaped wave 7 onward); two strained waves switch the governor on.
    const atTwo = run(steady(5, 8, { mobility: [0.9, 1] }));
    expect(atTwo.state.active[0]?.level).toBe(2);
    const fresh = {
      ...atTwo.state,
      active: [{ id: 'SKIRMISHER', key: 'default', level: 2, since: 9, levelSince: 9 } as const],
    };
    const eased = run(steady(9, 10, { mobility: [0.9, 1], ...strained }), {
      profile: atTwo.profile,
      state: fresh,
    });
    expect(eased.state.active[0]?.level).toBe(1);
    expect(eased.outcomes.some((o) => o.changes.some((c) => c.kind === 'hold'))).toBe(true);
    expect(governorOn(eased.profile)).toBe(true);
  });

  it('the final wave gets nothing and changes nothing; dormant WEAPON_FOCUS never enters', () => {
    const r = run(steady(5, 18, { mobility: [0.9, 1] }));
    const finale = decide(r.profile, r.state, 20);
    expect(finale.state).toBe(r.state);
    expect(finale.changes).toEqual([]);
    expect(composeModifiers(r.state.active, { wave: 20 })).toEqual([]);
    expect(
      run(steady(5, 10, { 'weaponFocus.burst': [1, 1] })).state.active.map((a) => a.id),
    ).not.toContain('WEAPON_FOCUS');
  });
});

describe('composition (caps, unlocks, mutation ownership)', () => {
  const active = (id: ActiveAdaptation['id'], level: 1 | 2, key = 'default'): ActiveAdaptation => ({
    id,
    key,
    level,
    since: 5,
    levelSince: 5,
  });

  it('HIGH_GROUND: Runners and a flank bias before wave 8, then exactly the Climbers', () => {
    const before = composeModifiers([active('HIGH_GROUND', 1)], {
      wave: 7,
      dwellRegions: ['west'],
    });
    expect(before).toEqual([
      { source: 'adaptive', archetypeWeights: { runner: 1.25 }, spawnBias: ['west'] },
    ]);
    const after = composeModifiers([active('HIGH_GROUND', 2)], {
      wave: 8,
      dwellRegions: ['west', 'northwest', 'south'],
    });
    expect(after).toEqual([
      { source: 'adaptive', extraCounts: { climber: 2 }, spawnBias: ['west', 'northwest'] },
    ]);
  });

  it('weights multiply across adaptations and clamp; traits wait for their schedule and cap', () => {
    const both = composeModifiers([active('LONG_RANGE', 2), active('SKIRMISHER', 2)], { wave: 12 });
    expect(both[0]?.archetypeWeights?.runner).toBe(ADAPTATION_GUARDRAILS.caps.weight[1]); // 1.3 × 1.5
    expect(composeModifiers([active('HEADHUNTER', 2)], { wave: 7 })).toEqual([]); // Helmeted from 8
    const traits = composeModifiers([active('HEADHUNTER', 2), active('CLOSE_QUARTERS', 2)], {
      wave: 12,
    });
    const t = traits[0]?.traitChance ?? {};
    expect((t.armored ?? 0) + (t.helmeted ?? 0)).toBeCloseTo(
      ADAPTATION_GUARDRAILS.caps.traitTotal,
      10,
    );
    expect(t).not.toHaveProperty('elite');
  });

  it('never carries anything a mutation owns', () => {
    for (const id of ADAPTATION_IDS) {
      for (const v of ADAPTATIONS[id].variants) {
        for (const level of [1, 2] as const) {
          for (const m of composeModifiers([active(id, level, v.key)], {
            wave: 15,
            dwellRegions: ['west'],
          })) {
            expect(m.source).toBe('adaptive');
            for (const key of ['budgetMultiplier', 'eliteMaxBonus', 'eliteMinimum', 'surges']) {
              expect(m).not.toHaveProperty(key);
            }
            expect((m.extraCounts?.climber ?? 0) <= WAVE_RULES.extraArchetypeMax).toBe(true);
          }
        }
      }
    }
  });

  it('attribution map: each active adaptation’s signal and what it brought', () => {
    const map = boostedArchetypes(
      [active('SKIRMISHER', 1), active('NEGLECT', 1, 'screamer'), active('HIGH_GROUND', 1)],
      9,
    );
    expect(map.get('mobility')).toEqual(new Set(['runner']));
    expect(map.get('neglect.screamer')).toEqual(new Set(['screamer']));
    expect(map.get('elevation')).toEqual(new Set(['climber']));
  });

  it('regionsNear: the two regions closest to where the player dwells, never elevated points', () => {
    expect(regionsNear([-22, 1], FACILITY_SPAWN_POINTS)).toEqual(['west', 'northwest']);
    expect(regionsNear(null, FACILITY_SPAWN_POINTS)).toEqual([]);
  });
});

describe('guardrails over many behaviour sequences (properties)', () => {
  const SIGNALS: SignalId[] = [
    'elevation',
    'dwell',
    'mobility',
    'closeRange',
    'longRange',
    'headshot',
    'accuracy',
    'strain',
    'neglect.screamer',
    'neglect.spitter',
  ];

  /** A random but persistent player: each signal drifts, sometimes jumps. */
  function behaviour(seed: number, waves: number): WaveEvidence[] {
    const rng = new Rng(`adaptive-property:${seed}`);
    const level = new Map(SIGNALS.map((s) => [s, rng.next()]));
    const out: WaveEvidence[] = [];
    for (let w = 1; w <= waves; w++) {
      const signals: Partial<Record<SignalId, readonly [number, number]>> = {};
      for (const s of SIGNALS) {
        if (rng.chance(0.15)) {
          level.set(s, rng.next());
        }
        const v = Math.min(1, Math.max(0, (level.get(s) ?? 0) + rng.range(-0.15, 0.15)));
        signals[s] = [v, rng.range(0, 1)];
      }
      out.push(evidence(w, signals));
    }
    return out;
  }

  it('300 runs × 40 waves: ≤ 2 active, distinct families, level ≤ 2, timers respected', () => {
    for (let seed = 0; seed < 300; seed++) {
      const { outcomes } = run(behaviour(seed, 40));
      const since = new Map<string, number>();
      for (const o of outcomes) {
        const active = o.state.active;
        expect(active.length).toBeLessThanOrEqual(ADAPTATION_GUARDRAILS.maxActiveAdaptations);
        expect(new Set(active.map((a) => ADAPTATIONS[a.id].family)).size).toBe(active.length);
        for (const a of active) {
          expect(o.forWave).toBeGreaterThanOrEqual(ADAPTATION_GUARDRAILS.firstAdaptiveWave);
          if (o.forWave !== 20) {
            // (The finale changes nothing, so its state is the previous wave's, unaged.)
            expect(o.forWave - a.since).toBeLessThan(ADAPTATIONS[a.id].maxActiveWaves);
          }
          expect([1, 2]).toContain(a.level);
          expect(ADAPTATIONS[a.id].status).toBeUndefined();
          if (a.level === 2) {
            expect(a.levelSince - a.since).toBeGreaterThanOrEqual(
              ADAPTATION_GUARDRAILS.escalate.afterWaves,
            );
          }
          since.set(a.id, a.since);
        }
        for (const c of o.changes) {
          if (c.kind === 'enter') {
            expect(o.governor).toBe(false);
          }
        }
        if (o.forWave === 20) {
          expect(o.changes).toEqual([]);
        }
      }
    }
  });

  it('one extreme wave in otherwise ordinary play never makes the horde adapt', () => {
    for (let seed = 0; seed < 100; seed++) {
      const rng = new Rng(`spike:${seed}`);
      const signal = SIGNALS[rng.int(0, SIGNALS.length - 1)] ?? 'mobility';
      const waves = steady(1, 12, {});
      const spikeAt = rng.int(1, 12);
      waves[spikeAt - 1] = evidence(spikeAt, { [signal]: [1, 1], accuracy: [1, 1] });
      expect(run(waves).state.active, `${seed}: ${signal}@${spikeAt}`).toEqual([]);
    }
  });

  it('deterministic: the same evidence gives the same decisions, every time', () => {
    for (let seed = 0; seed < 50; seed++) {
      const seq = behaviour(seed, 30);
      expect(run(seq).outcomes).toEqual(run(seq).outcomes);
    }
  });

  it('anti-runaway: constant extreme play keeps cycling (fade and rest), never stacking', () => {
    const extreme = steady(1, 40, {
      elevation: [1, 1],
      closeRange: [1, 1],
      headshot: [1, 1],
      accuracy: [1, 1],
      'neglect.screamer': [1, 1],
    });
    const { outcomes } = run(extreme);
    const fades = outcomes.flatMap((o) => o.changes).filter((c) => c.kind === 'rest');
    expect(fades.length).toBeGreaterThan(4);
    for (const o of outcomes) {
      expect(o.state.active.length).toBeLessThanOrEqual(2);
    }
  });
});

describe('mutation ownership: an import boundary (D-024, D-045, D-047)', () => {
  // Every adaptive module and the adaptation data, as source text (not the tests, and not the
  // headless harness, which wires the whole game as main.ts does).
  const sources = {
    ...import.meta.glob<string>(['./*.ts', '!./*.test.ts', '!./testGame.ts'], {
      query: '?raw',
      import: 'default',
      eager: true,
    }),
    ...import.meta.glob<string>('../config/adaptation.ts', {
      query: '?raw',
      import: 'default',
      eager: true,
    }),
  };

  it('nothing adaptive imports the mutation system, its selector or its effects', () => {
    expect(Object.keys(sources).length).toBeGreaterThanOrEqual(8);
    for (const [file, text] of Object.entries(sources)) {
      const imports = [...text.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1] ?? '');
      expect(imports.length, file).toBeGreaterThan(0);
      for (const from of imports) {
        expect(from, `${file} imports ${from}`).not.toMatch(
          /(^|\/)signal\/|WaveMutation|SignalMutationSystem|config\/effects|config\/environment/,
        );
      }
    }
  });
});
