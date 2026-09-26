/**
 * The Phase 4 test encounter (D-042): places the configured Walkers when a run starts and puts
 * each one back a while after its body is removed. Temporary validation content, like the dummy
 * range: it is not a wave spawner (no budget, pacing or difficulty), and the wave system
 * (Phase 6) replaces it. It uses only `EnemyManager.spawn`, the same entry point waves will use.
 */

import { TRAINING_ENEMIES, type TrainingEnemyPlacement } from '../config/training';
import type { FixedUpdateSystem } from '../core/Game';
import type { EnemyManager } from './EnemyManager';

export interface TrainingEncounterOptions {
  readonly enemies: EnemyManager;
  /** Whether time passes for respawns (true while a run is being played). */
  readonly active: () => boolean;
  readonly placements?: readonly TrainingEnemyPlacement[];
  readonly respawnDelay?: number;
}

interface Slot {
  readonly placement: TrainingEnemyPlacement;
  /** The enemy standing in for this placement, or null while it waits to reappear. */
  enemyId: string | null;
  /** Seconds until it reappears (while `enemyId` is null). */
  wait: number;
}

export class TrainingEncounter implements FixedUpdateSystem {
  private readonly enemies: EnemyManager;
  private readonly active: () => boolean;
  private readonly placements: readonly TrainingEnemyPlacement[];
  private readonly respawnDelay: number;
  private slots: Slot[] = [];
  private readonly unsubscribe: () => void;

  constructor(options: TrainingEncounterOptions) {
    this.enemies = options.enemies;
    this.active = options.active;
    this.placements =
      options.placements ?? (TRAINING_ENEMIES.enabled ? TRAINING_ENEMIES.placements : []);
    this.respawnDelay = options.respawnDelay ?? TRAINING_ENEMIES.respawnDelay;
    this.unsubscribe = this.enemies.events.on('despawned', ({ id }) => {
      for (const slot of this.slots) {
        if (slot.enemyId === id) {
          slot.enemyId = null;
          slot.wait = this.respawnDelay;
        }
      }
    });
  }

  /** Enemies of this encounter currently in the world (tests, debug). */
  get placed(): readonly (string | null)[] {
    return this.slots.map((slot) => slot.enemyId);
  }

  /** Places every configured enemy (a new run; the manager has just been cleared). */
  reset(): void {
    this.slots = this.placements.map((placement) => ({ placement, enemyId: null, wait: 0 }));
    for (const slot of this.slots) {
      this.place(slot);
    }
  }

  /** Stops managing its enemies (they stay until the manager clears them). */
  clear(): void {
    this.slots = [];
  }

  fixedUpdate(dt: number): void {
    if (!this.active()) {
      return;
    }
    for (const slot of this.slots) {
      if (slot.enemyId !== null) {
        continue;
      }
      slot.wait -= dt;
      if (slot.wait <= 1e-9) {
        this.place(slot);
      }
    }
  }

  dispose(): void {
    this.unsubscribe();
    this.slots = [];
  }

  private place(slot: Slot): void {
    const { archetype, position, yaw, patrol } = slot.placement;
    const enemy = this.enemies.spawn(archetype, position, { yaw, patrol });
    slot.enemyId = enemy?.id ?? null;
    slot.wait = enemy ? 0 : this.respawnDelay; // at the cap: try again later
  }
}
