/**
 * Per-run tallies (D-044): the wave reached and what happened in the run, for the game-over and
 * victory screens (GAME_DESIGN §16) and, later, XP/Scrap rewards (Phase 9) and analytics. Filled
 * by the wave runtime from the enemy, combat and player-health events; reset for every run.
 */

import type { EnemyArchetypeId } from '../config/enemies';

export interface RunStatsSnapshot {
  /** The wave in progress (or last reached). */
  readonly waveReached: number;
  readonly wavesCleared: number;
  readonly kills: number;
  readonly killsByArchetype: Readonly<Partial<Record<EnemyArchetypeId, number>>>;
  readonly eliteKills: number;
  readonly headshots: number;
  readonly damageTaken: number;
  /** Seconds each cleared wave took (from `WAVE_ACTIVE` to its last kill). */
  readonly waveTimes: readonly number[];
  /** Groups spawned with the view rule relaxed. */
  readonly relaxedSpawns: number;
  /** Stragglers moved to fresh spawn points. */
  readonly stragglersMoved: number;
}

export class RunStats {
  waveReached = 0;
  wavesCleared = 0;
  kills = 0;
  killsByArchetype: Partial<Record<EnemyArchetypeId, number>> = {};
  eliteKills = 0;
  headshots = 0;
  damageTaken = 0;
  readonly waveTimes: number[] = [];
  relaxedSpawns = 0;
  stragglersMoved = 0;

  reset(): void {
    this.waveReached = 0;
    this.wavesCleared = 0;
    this.kills = 0;
    this.killsByArchetype = {};
    this.eliteKills = 0;
    this.headshots = 0;
    this.damageTaken = 0;
    this.waveTimes.length = 0;
    this.relaxedSpawns = 0;
    this.stragglersMoved = 0;
  }

  recordKill(archetype: EnemyArchetypeId, elite: boolean): void {
    this.kills++;
    this.killsByArchetype[archetype] = (this.killsByArchetype[archetype] ?? 0) + 1;
    if (elite) {
      this.eliteKills++;
    }
  }

  snapshot(): RunStatsSnapshot {
    return {
      waveReached: this.waveReached,
      wavesCleared: this.wavesCleared,
      kills: this.kills,
      killsByArchetype: { ...this.killsByArchetype },
      eliteKills: this.eliteKills,
      headshots: this.headshots,
      damageTaken: this.damageTaken,
      waveTimes: [...this.waveTimes],
      relaxedSpawns: this.relaxedSpawns,
      stragglersMoved: this.stragglersMoved,
    };
  }
}
