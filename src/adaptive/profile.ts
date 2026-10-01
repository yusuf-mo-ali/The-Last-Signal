/**
 * The behaviour profile (D-047): every signal's decayed memory, and how confident it is. Pure.
 *
 *   w       = the wave's weight (< `minWeight`: no evidence, memory only decays)
 *   mass    = w + decay × mass'
 *   mean    = (w × score + decay × mass' × mean') / mass
 *   above   = w × [score ≥ threshold] + decay × above'
 *   confidence = min(1, mass / massFull) × above / mass
 *
 * Confidence needs both enough evidence (mass) and persistence (most of it above the threshold):
 * one extreme wave gives at most 1 / massFull = 0.5, never enough to enter an adaptation; two
 * consistent waves give 0.85; a high wave and a low one stay at or under 0.5. Old evidence fades
 * geometrically (`decay` per wave), so changing how you play shows within two or three waves.
 */

import {
  ADAPTATION_GUARDRAILS,
  ADAPTATION_IDS,
  ADAPTATIONS,
  PROFILE_RULES,
  SIGNAL_IDS,
  type SignalId,
} from '../config/adaptation';
import type { BehaviorProfile, SignalMemory, WaveEvidence } from './types';

export const EMPTY_MEMORY: SignalMemory = { mean: 0, mass: 0, above: 0 };

export function emptyProfile(): BehaviorProfile {
  return { v: 1, wavesObserved: 0, signals: {}, dwellCentroid: null };
}

/**
 * The score at or above which a wave counts as persistent evidence for `signal`: the lowest enter
 * threshold of an adaptation it triggers (a gate's bound, the governor's for strain; 0.5 otherwise).
 */
export function persistenceThreshold(signal: SignalId): number {
  if (signal === 'strain') {
    return ADAPTATION_GUARDRAILS.strain.threshold;
  }
  let threshold = Number.POSITIVE_INFINITY;
  for (const id of ADAPTATION_IDS) {
    const a = ADAPTATIONS[id];
    if (a.variants.some((v) => v.signal === signal)) {
      threshold = Math.min(threshold, a.threshold.enter);
    }
    if (a.gate?.signal === signal && a.gate.min !== undefined) {
      threshold = Math.min(threshold, a.gate.min);
    }
  }
  return Number.isFinite(threshold) ? threshold : 0.5;
}

const THRESHOLDS = new Map<SignalId, number>(SIGNAL_IDS.map((s) => [s, persistenceThreshold(s)]));

export function memoryOf(profile: BehaviorProfile, signal: SignalId): SignalMemory {
  return profile.signals[signal] ?? EMPTY_MEMORY;
}

/** 0–1: enough evidence × how persistent it was. */
export function confidence(memory: SignalMemory): number {
  if (memory.mass <= 0) {
    return 0;
  }
  return Math.min(1, memory.mass / PROFILE_RULES.massFull) * (memory.above / memory.mass);
}

/** The profile after one more wave of evidence. */
export function foldEvidence(profile: BehaviorProfile, evidence: WaveEvidence): BehaviorProfile {
  const { decay, minWeight } = PROFILE_RULES;
  const signals: Partial<Record<SignalId, SignalMemory>> = {};
  for (const signal of SIGNAL_IDS) {
    const before = memoryOf(profile, signal);
    const reading = evidence.signals[signal];
    const w = reading && reading.weight >= minWeight ? reading.weight : 0;
    const keptMass = decay * before.mass;
    const mass = w + keptMass;
    const mean = mass > 0 ? (w * (reading?.score ?? 0) + keptMass * before.mean) / mass : 0;
    const hit = reading && reading.score >= (THRESHOLDS.get(signal) ?? 0.5) ? w : 0;
    signals[signal] = { mean, mass, above: hit + decay * before.above };
  }
  const elevation = evidence.signals.elevation;
  const fought = elevation !== undefined && elevation.weight >= minWeight;
  const dwell = evidence.signals.dwell;
  return {
    v: 1,
    wavesObserved: profile.wavesObserved + (fought ? 1 : 0),
    signals,
    dwellCentroid:
      dwell && dwell.weight >= minWeight && evidence.dwellCentroid
        ? evidence.dwellCentroid
        : profile.dwellCentroid,
  };
}

/**
 * A profile read from elsewhere (a future save or prior, D-047): unknown signals dropped, missing
 * ones empty, values clamped. No schema migration is ever needed to add a signal.
 */
export function normalizeProfile(raw: unknown): BehaviorProfile {
  const out = emptyProfile();
  if (typeof raw !== 'object' || raw === null) {
    return out;
  }
  const r = raw as { wavesObserved?: unknown; signals?: unknown };
  const signals: Partial<Record<SignalId, SignalMemory>> = {};
  const source = (typeof r.signals === 'object' && r.signals !== null ? r.signals : {}) as Record<
    string,
    unknown
  >;
  for (const signal of SIGNAL_IDS) {
    const m = source[signal] as Partial<SignalMemory> | undefined;
    if (!m) {
      continue;
    }
    const num = (v: unknown, lo: number, hi: number) =>
      typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : 0;
    const mass = num(m.mass, 0, 1 / (1 - PROFILE_RULES.decay));
    signals[signal] = { mean: num(m.mean, 0, 1), mass, above: num(m.above, 0, mass) };
  }
  return {
    ...out,
    wavesObserved:
      typeof r.wavesObserved === 'number' ? Math.max(0, Math.floor(r.wavesObserved)) : 0,
    signals,
  };
}
