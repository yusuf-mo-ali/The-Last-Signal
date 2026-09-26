/**
 * Notifications from `EnemyManager` (D-015): for the views, feedback, audio, debug tools and
 * tests, and later waves, XP/Scrap, the adaptive profile and analytics.
 */

import type { AiState, EnemyArchetypeId } from '../config/enemies';
import type { Vec3Tuple } from '../weapons/types';

export type AttackMissReason = 'range' | 'height' | 'arc' | 'blocked' | 'dead';
export type AttackCancelReason = 'stagger' | 'death' | 'lostTarget';
export type TargetLossReason = 'dead' | 'range' | 'memory';

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
  /** The telegraph: a strike follows after `windup` seconds unless it is cancelled. */
  attackStarted: { readonly id: string; readonly targetId: string; readonly windup: number };
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
    readonly position: Vec3Tuple;
  };
  /** Removed from the world (body cleared, pool release). Exactly once per spawn. */
  despawned: { readonly id: string };
}
