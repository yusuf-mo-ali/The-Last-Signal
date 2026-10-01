/**
 * Notifications from the wave runtime (D-015, D-044): for the HUD, prompts, debug tools and tests,
 * and later XP/Scrap (Phase 9), the adaptive profile (Phase 8), mutations (Phase 7), audio and
 * analytics. The runtime itself never depends on who listens.
 */

import type { EnemyModifierId, ImplementedEnemyId } from '../config/enemies';
import type { SpawnRegionId, WaveDefinition } from '../config/waves';
import type { RunStatsSnapshot } from './RunStats';

export interface WaveEvents {
  /** `WAVE_START`: the wave is generated and announced; spawning starts after the intro. */
  waveStarting: { readonly wave: number; readonly definition: WaveDefinition };
  /** `WAVE_ACTIVE`: spawning begins; the player can be hurt (D-029). */
  waveStarted: { readonly wave: number };
  enemySpawned: {
    readonly wave: number;
    readonly id: string;
    readonly archetype: ImplementedEnemyId;
    readonly traits: readonly EnemyModifierId[];
    readonly spawnPointId: string;
    /** Spawned with the view rule relaxed (no fair point for a while). */
    readonly relaxed: boolean;
  };
  /** A due group could not spawn yet. */
  spawnDeferred: { readonly wave: number; readonly reason: 'noPoint' };
  /** Remaining = queued + alive wave enemies (the HUD's "LEFT"). */
  waveProgress: {
    readonly wave: number;
    readonly remaining: number;
    readonly alive: number;
    readonly queued: number;
  };
  /** `WAVE_COMPLETE`: every wave enemy is dead. */
  waveCompleted: {
    readonly wave: number;
    /** Seconds from `WAVE_ACTIVE` to the last kill. */
    readonly duration: number;
    readonly kills: number;
    readonly finale: boolean;
    readonly stats: RunStatsSnapshot;
  };
  /** The final wave was cleared (not in endless mode): `VICTORY`. */
  runVictory: { readonly wave: number; readonly stats: RunStatsSnapshot };
  /** Wave enemies that stopped making progress were moved to fresh spawn points. */
  stragglers: { readonly wave: number; readonly ids: readonly string[] };
  /** An alarm pulled queued spawns forward, toward it (no extra budget). */
  reinforcementsPulled: {
    readonly wave: number;
    readonly alarmSourceId: string;
    readonly count: number;
  };
  /** A surge (D-045, e.g. HIVE) is coming: from this region, in `arrivesIn` seconds. */
  surgeWarning: {
    readonly wave: number;
    readonly index: number;
    readonly region: SpawnRegionId;
    readonly pointId: string;
    /** Up to this many (never more than the room under the wave's cap when it arrives). */
    readonly size: number;
    readonly arrivesIn: number;
  };
  /** The surge arrived. */
  surgeSpawned: {
    readonly wave: number;
    readonly index: number;
    readonly region: SpawnRegionId;
    readonly pointId: string;
    readonly count: number;
  };
}
