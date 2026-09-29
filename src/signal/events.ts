/**
 * Notifications from the Signal Mutation system (D-015, D-045): for the HUD (announcement, badge,
 * "lifted"), the STATIC overlay, debug tools and tests, and later audio (Phase 11), analytics
 * (`mutation_triggered`) and the adaptive profile.
 */

import type { MutationId } from '../config/mutations';

export type MutationRevertReason = 'cleared' | 'died' | 'ended' | 'replaced' | 'debug';

export interface MutationEvents {
  /** The wave's mutation is announced (the wave's intro): what it is and what to do about it. */
  mutationAnnounced: {
    readonly wave: number;
    readonly id: MutationId;
    readonly name: string;
    readonly rule: string;
    readonly hint: string;
    readonly accent: string;
  };
  /** Its runtime effects took hold (the wave went active). */
  mutationApplied: { readonly wave: number; readonly id: MutationId };
  /** Its effects were removed (and its lighting is fading back). */
  mutationReverted: {
    readonly wave: number;
    readonly id: MutationId;
    readonly reason: MutationRevertReason;
  };
  /** A STATIC interference burst started. */
  staticBurst: {
    readonly wave: number;
    readonly id: MutationId;
    readonly start: number;
    readonly until: number;
    readonly intensity: number;
  };
}
