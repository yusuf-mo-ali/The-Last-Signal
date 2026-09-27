/**
 * Training dummies (Phase 3, D-041): **temporary validation targets**, not enemies. They exist so
 * the combat pipeline (hitbox → damage → health → death → feedback → drops) can be tested and
 * felt before zombies exist. They use exactly what zombies will use: a hitbox rig, zone
 * multipliers, health, stagger and a drop table. They have no AI and never attack.
 *
 * The range is on in every build while there is nothing else to shoot; the wave phase turns it off
 * (`TRAINING_RANGE.enabled`), and the debug tools can still spawn dummies.
 */

import type { DamageZone, EnemyModifierId, ImplementedEnemyId } from './enemies';
import type { DropTableId } from './drops';

export const TRAINING_DUMMY_KINDS = ['standard', 'zoned'] as const;
export type TrainingDummyKind = (typeof TRAINING_DUMMY_KINDS)[number];

export interface TrainingDummyDefinition {
  readonly kind: TrainingDummyKind;
  readonly name: string;
  readonly health: number;
  /** Hitbox rig id (`HUMANOID_RIG` is the only rig so far). */
  readonly rig: 'humanoid';
  /** Overrides of the plan's zone multipliers; none, so dummies take damage like a baseline zombie. */
  readonly zoneMultipliers?: Partial<Record<DamageZone, number>>;
  readonly armor: number;
  readonly resistance: number;
  /** Damage within the stagger window that triggers a stagger reaction. */
  readonly staggerThreshold: number;
  /** Seconds a dead dummy stays down before it stands up again. */
  readonly respawnDelay: number;
  readonly drops: DropTableId | null;
  /** Draw each damage zone in its own colour (for checking which zone a hit landed in). */
  readonly showZones: boolean;
}

export const TRAINING_DUMMIES: Readonly<Record<TrainingDummyKind, TrainingDummyDefinition>> = {
  // Stands in for a wave-1 Walker (100 health is the Pass-1 placeholder, BALANCING §2).
  standard: {
    kind: 'standard',
    name: 'Training dummy',
    health: 100,
    rig: 'humanoid',
    armor: 0,
    resistance: 0,
    staggerThreshold: 40,
    respawnDelay: 3,
    drops: 'trainingDummy',
    showZones: false,
  },
  // Zones painted on, and tougher, so many hits can be placed and read before it falls.
  zoned: {
    kind: 'zoned',
    name: 'Zone dummy',
    health: 400,
    rig: 'humanoid',
    armor: 0,
    resistance: 0,
    staggerThreshold: 60,
    respawnDelay: 3,
    drops: null,
    showZones: true,
  },
};

export interface TrainingDummyPlacement {
  readonly kind: TrainingDummyKind;
  /** Feet position in the level. */
  readonly position: readonly [number, number, number];
  /** Facing (yaw 0 faces −z; π faces +z, towards the spawn). */
  readonly yaw: number;
}

export const TRAINING_RANGE: {
  readonly enabled: boolean;
  readonly dummies: readonly TrainingDummyPlacement[];
} = {
  enabled: true,
  // In the yard, facing the spawn (0, 0, 14). The first stands straight ahead of it, 6 m away.
  dummies: [
    { kind: 'standard', position: [0, 0, 8], yaw: Math.PI },
    { kind: 'zoned', position: [-3.5, 0, 9], yaw: Math.PI },
    { kind: 'standard', position: [3.5, 0, 9], yaw: Math.PI },
  ],
};

export interface TrainingEnemyPlacement {
  readonly archetype: ImplementedEnemyId;
  /** Feet position in the level. */
  readonly position: readonly [number, number, number];
  readonly yaw: number;
  /** Whether it wanders around its spawn point while idle (its archetype's patrol radius). */
  readonly patrol: boolean;
  readonly traits?: readonly EnemyModifierId[];
}

/**
 * Test encounter: one of each archetype placed around the yard so the enemy foundation can be
 * played and verified in every build before waves exist (D-042, D-043). Temporary, like the dummy
 * range: the wave system (Phase 6) replaces it (`enabled`).
 *
 * Every enemy stands beyond its own detection range (plus its patrol radius) from the spawn, so a
 * player standing at the spawn is never engaged:
 * - a Helmeted Walker and an Armored Tank stand guard 8 m to either side of the path north
 *   (14–15 m from the spawn); walking about 6 m forward brings them in;
 * - a Runner patrols the north-east yard;
 * - a Screamer waits north of the signal tower, out of sight of the spawn;
 * - an Elite Walker patrols the north-west yard.
 */
export const TRAINING_ENEMIES: {
  readonly enabled: boolean;
  /** Seconds after a placed enemy's body is removed before it appears again. */
  readonly respawnDelay: number;
  readonly placements: readonly TrainingEnemyPlacement[];
} = {
  enabled: true,
  respawnDelay: 10,
  placements: [
    {
      archetype: 'walker',
      position: [8, 0, 2],
      yaw: Math.PI / 2,
      patrol: false,
      traits: ['helmeted'],
    },
    {
      archetype: 'tank',
      position: [-8, 0, 1],
      yaw: -Math.PI / 2,
      patrol: false,
      traits: ['armored'],
    },
    { archetype: 'runner', position: [12, 0, -6], yaw: Math.PI / 2, patrol: true },
    { archetype: 'screamer', position: [0, 0, -9], yaw: Math.PI, patrol: false },
    { archetype: 'walker', position: [-14, 0, -9], yaw: Math.PI, patrol: true, traits: ['elite'] },
  ],
};
