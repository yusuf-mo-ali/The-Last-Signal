/**
 * The adaptive system's data (D-047), kept apart by role:
 *
 * - `WaveTelemetry`: what was counted during one wave (raw, whole numbers and sums);
 * - `WaveEvidence`: what that wave says, signal by signal (score and weight, 0–1);
 * - `BehaviorProfile`: the decayed memory of every signal ("observed behaviour");
 * - `AdaptationState` / `AdaptationDecision`: what the horde does about it ("adaptation decision").
 *
 * Plain data: copyable, comparable, serialisable. `BehaviorProfile` is versioned and keyed by
 * signal id, so a later phase can store or seed it without a schema migration (unknown keys are
 * ignored, missing keys are empty memory).
 */

import type {
  AdaptationId,
  SignalId,
  SupportArchetype,
  WeaponFocusRole,
} from '../config/adaptation';
import type { MutationId } from '../config/mutations';

/** Bucket for position samples with no enemy near (mobility). */
export const NO_ENEMY = 'none';

/** Hits on one archetype, by range. */
export interface RangeHits {
  total: number;
  close: number;
  long: number;
}

/** Position samples while a given archetype was the nearest enemy (or `none`). */
export interface MoveSamples {
  samples: number;
  sprint: number;
  kite: number;
}

/** What one wave's fighting looked like (only counted while the wave is active). */
export interface WaveTelemetry {
  readonly wave: number;
  readonly mutation: MutationId | null;
  /** Position samples (`SIGNAL_MEASURE.sampleEvery` steps apart) while wave enemies were alive. */
  samples: number;
  /** Of those, with the feet on high ground. */
  elevated: number;
  /** Ground samples per dwell cell (`"x,z"` cell indices). */
  readonly dwell: Record<string, number>;
  /** Movement samples by the nearest enemy's archetype (`NO_ENEMY` when none within range). */
  readonly moves: Record<string, MoveSamples>;
  /** Damaging hits on wave enemies, by the target's archetype. */
  readonly hits: Record<string, RangeHits>;
  /** Firearm shots fired, and those that hit a wave enemy. */
  shots: number;
  shotsHit: number;
  /** Firearm hits on wave enemies, and those on the head. */
  firearmHits: number;
  headHits: number;
  /** Firearm hits by the weapon's role. */
  readonly focus: Record<WeaponFocusRole, number>;
  /** Most firearms owned at once during the wave. */
  firearmsOwned: number;
  /** Support enemies spawned this wave, and those that used their ability before dying. */
  readonly support: Record<SupportArchetype, { spawned: number; completed: number }>;
  damageTaken: number;
  /** Lowest health during the wave, as a fraction of the maximum. */
  lowestHealth: number;
  /** Damage taken by source archetype (or `other`). */
  readonly damageBy: Record<string, number>;
}

/** One signal's reading for one wave. */
export interface SignalReading {
  /** 0–1: how strongly the wave showed the behaviour. */
  readonly score: number;
  /** 0–1: how much evidence it carried (after mutation discounts and attribution). */
  readonly weight: number;
}

export interface WaveEvidence {
  readonly wave: number;
  readonly signals: Readonly<Partial<Record<SignalId, SignalReading>>>;
  /** Where the player dwelt most (x, z), when the wave had enough ground samples. */
  readonly dwellCentroid: readonly [number, number] | null;
}

/** A signal's decayed memory (confidence is derived: `adaptive/profile.ts`). */
export interface SignalMemory {
  /** Evidence-weighted mean score. */
  readonly mean: number;
  /** Decayed evidence. */
  readonly mass: number;
  /** Decayed evidence of waves at or above the signal's threshold. */
  readonly above: number;
}

export interface BehaviorProfile {
  readonly v: 1;
  /** Waves that carried positional evidence (a real fight). */
  readonly wavesObserved: number;
  readonly signals: Readonly<Partial<Record<SignalId, SignalMemory>>>;
  readonly dwellCentroid: readonly [number, number] | null;
}

export interface ActiveAdaptation {
  readonly id: AdaptationId;
  /** The variant that triggered it (`default`, an archetype for NEGLECT, a role for WEAPON_FOCUS). */
  readonly key: string;
  readonly level: 1 | 2;
  /** The first wave it shaped. */
  readonly since: number;
  /** The first wave at its current level. */
  readonly levelSince: number;
}

export interface AdaptationState {
  readonly active: readonly ActiveAdaptation[];
  /** It may enter again from this wave. */
  readonly restUntil: Readonly<Partial<Record<AdaptationId, number>>>;
}

export type AdaptationChangeKind = 'enter' | 'escalate' | 'fade' | 'hold';

export interface AdaptationChange {
  /** `governor`: the strain governor held the horde back (no adaptation of its own). */
  readonly id: AdaptationId | 'governor';
  readonly key: string;
  readonly kind: AdaptationChangeKind;
  /** The SIGNAL ANALYSIS line. */
  readonly text: string;
}

/** What `decide` concluded after a wave, for the next one. */
export interface AdaptationOutcome {
  /** The wave the decision shapes. */
  readonly forWave: number;
  readonly state: AdaptationState;
  readonly changes: readonly AdaptationChange[];
  /** The strain governor was on: nothing entered or escalated, level 2 dropped to 1. */
  readonly governor: boolean;
}

export const EMPTY_STATE: AdaptationState = { active: [], restUntil: {} };
