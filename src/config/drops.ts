/**
 * Drops and pickups (plan §10 "Ammo drops", §18 Scavenger, D-041). Data only: what can drop, how
 * likely it is, and what a pickup gives. Any death can roll a drop table: training dummies now,
 * enemies later (an archetype names its table). The Scavenger upgrade will scale `chance`.
 */

export const PICKUP_IDS = ['ammo'] as const;
export type PickupId = (typeof PICKUP_IDS)[number];

export interface AmmoPickupDefinition {
  readonly kind: 'ammo';
  readonly id: PickupId;
  /**
   * Whole magazines added to the reserve of every carried firearm with limited reserve. A weapon
   * with unlimited reserve (the starter Pistol, D-039) takes nothing, and a pickup nobody needs
   * stays on the ground.
   */
  readonly magazines: number;
  /** Metres: how close the player must be (horizontally) to collect it. */
  readonly radius: number;
  /** Seconds before an uncollected pickup disappears. */
  readonly lifetime: number;
}

export type PickupDefinition = AmmoPickupDefinition;

export const PICKUPS: Readonly<Record<PickupId, PickupDefinition>> = {
  ammo: { kind: 'ammo', id: 'ammo', magazines: 1, radius: 1.1, lifetime: 30 },
};

export const DROP_TABLE_IDS = ['trainingDummy'] as const;
export type DropTableId = (typeof DROP_TABLE_IDS)[number];

/** Each entry is rolled independently; several can drop at once. */
export interface DropEntry {
  readonly pickup: PickupId;
  /** Probability in [0, 1]. */
  readonly chance: number;
}

export const DROP_TABLES: Readonly<Record<DropTableId, readonly DropEntry[]>> = {
  trainingDummy: [{ pickup: 'ammo', chance: 0.5 }],
};

export const PICKUP_RULES = {
  /** Pickups on the ground at once; the oldest is removed to make room. */
  maxActive: 16,
  /** Metres: how far above or below the player's feet a pickup can still be collected. */
  verticalReach: 1.5,
} as const;
