/**
 * Notifications from `EnemyManager` (D-015): for the views, feedback, audio, debug tools and
 * tests, and later waves, XP/Scrap, the adaptive profile and analytics.
 */

import type { AiState, EnemyArchetypeId, EnemyModifierId } from '../config/enemies';
import type { Vec3Tuple } from '../weapons/types';

export type AttackMissReason = 'range' | 'height' | 'arc' | 'blocked' | 'dead';
export type AttackCancelReason = 'stagger' | 'death' | 'lostTarget';
export type TargetLossReason = 'dead' | 'range' | 'memory';
/** What an attack does at the end of its wind-up: a melee strike, or a scream (an alarm). */
export type AttackKind = 'strike' | 'scream';

/**
 * How an alarm was raised (D-043, D-045):
 * - `scream`: a Screamer's telegraphed scream; it calls reinforcements (the wave pulls its next
 *   group forward) and shakes the screen;
 * - `deathCry`: the DEATH CRY mutation (id SCREAM): a dying enemy's short cry; smaller and briefer,
 *   and it never calls reinforcements.
 */
export type AlarmKind = 'scream' | 'deathCry';

/**
 * Something raised the alarm (D-043): a disturbance that tells whoever hears it where a target
 * is. Generic on purpose: listeners never need to know what raised it. The response (nearby
 * enemies told and hastened) is in `EnemyManager`; waves, audio, effects and the adaptive profile
 * can listen too, telling kinds apart by `kind` and `reinforcements`.
 */
export interface AlarmEvent {
  /** Who raised it (an enemy id). */
  readonly sourceId: string;
  /** How it was raised. */
  readonly kind: AlarmKind;
  /** Whether it calls the horde in (the wave runtime pulls its next group forward). */
  readonly reinforcements: boolean;
  /** Where it came from (feet) and how far it carries, metres. */
  readonly position: Vec3Tuple;
  readonly radius: number;
  /** What it is about: the target the source was after, if any. */
  readonly targetId: string | null;
  readonly targetPosition: Vec3Tuple | null;
  /** Seconds listeners are told about the target for. */
  readonly alertDuration: number;
  /** A speed boost for those who hear it, if any. */
  readonly haste: { readonly multiplier: number; readonly duration: number } | null;
  /** Sim time it was raised. */
  readonly time: number;
}

export interface EnemyEvents {
  spawned: {
    readonly id: string;
    readonly archetype: EnemyArchetypeId;
    readonly position: Vec3Tuple;
  };
  stateChanged: { readonly id: string; readonly from: AiState; readonly to: AiState };
  targetAcquired: {
    readonly id: string;
    readonly targetId: string;
    /** True when told about the target (damage, alert) rather than seeing it. */
    readonly alerted: boolean;
  };
  targetLost: { readonly id: string; readonly targetId: string; readonly reason: TargetLossReason };
  /** The telegraph: a strike (or a scream) follows after `windup` seconds unless it is cancelled. */
  attackStarted: {
    readonly id: string;
    readonly targetId: string;
    readonly windup: number;
    readonly kind: AttackKind;
  };
  attackHit: {
    readonly id: string;
    readonly targetId: string;
    /** Health the target lost (0 if it could not be hurt right now). */
    readonly amount: number;
    readonly damage: number;
  };
  attackMissed: {
    readonly id: string;
    readonly targetId: string;
    readonly reason: AttackMissReason;
  };
  attackCancelled: { readonly id: string; readonly reason: AttackCancelReason };
  staggered: { readonly id: string };
  died: {
    readonly id: string;
    readonly archetype: EnemyArchetypeId;
    /** Its traits (rewards and stats: an Elite kill, D-044). */
    readonly traits: readonly EnemyModifierId[];
    readonly position: Vec3Tuple;
  };
  /** Removed from the world (body cleared, pool release). Exactly once per spawn. */
  despawned: { readonly id: string };
  alarm: AlarmEvent;
  /** Sped up by an alarm (or anything else), until sim time `until`. */
  hasted: { readonly id: string; readonly multiplier: number; readonly until: number };
  traitsChanged: { readonly id: string; readonly traits: readonly EnemyModifierId[] };
}
