/**
 * Counts what the player does during one wave (D-047): the raw material of the behaviour profile.
 * Simulation only; every count happens on a fixed step or in an event raised on one, so the same
 * run gives the same counts at any frame rate.
 *
 * - **Position samples**, every `SIGNAL_MEASURE.sampleEvery` steps while wave enemies are alive:
 *   high ground, the dwell cell (on the ground), sprinting, kiting away from the nearest enemy.
 * - **Hits** on wave enemies (combat `damaged`): distance and archetype; firearm hits and their
 *   zone; the weapon's role.
 * - **Shots** (weapon `shot`): fired and hitting a wave enemy (accuracy).
 * - **Support abilities**: Screamers and Spitters spawned, and those that screamed or spat.
 * - **Damage taken**: amount, by source archetype, and the lowest health.
 *
 * Only wave enemies count (never training dummies); nothing counts outside `recording`.
 */

import type { Vector3 } from 'three';
import type { DamagedEvent } from '../combat/CombatSystem';
import {
  SIGNAL_MEASURE,
  SUPPORT_ARCHETYPES,
  WEAPON_FOCUS_ROLE,
  type SupportArchetype,
} from '../config/adaptation';
import type { EnemyArchetypeId } from '../config/enemies';
import type { MutationId } from '../config/mutations';
import { WEAPONS } from '../config/weapons';
import type { ShotResult } from '../weapons/types';
import type { LoadoutSnapshot } from '../weapons/WeaponManager';
import { dwellCell, emptyTelemetry } from './measure';
import { NO_ENEMY, type WaveTelemetry } from './types';

/** What a position sample reads from the player. */
export interface TelemetryPlayer {
  /** Feet. */
  readonly position: Vector3;
  readonly velocity: Vector3;
  readonly sprinting: boolean;
}

/** What a position sample reads about one living wave enemy. */
export interface TelemetryEnemy {
  readonly archetype: string;
  readonly position: Vector3;
}

/** Firearms in a loadout (the Primary and an unlocked Secondary), for weapon focus. */
export function firearmsOwned(loadout: LoadoutSnapshot): number {
  const ids = [loadout.primary, loadout.secondary === 'locked' ? null : loadout.secondary.weapon];
  return ids.filter((id) => id !== null && WEAPONS[id].kind === 'firearm').length;
}

const isSupport = (a: string): a is SupportArchetype =>
  (SUPPORT_ARCHETYPES as readonly string[]).includes(a);

export class BehaviorTelemetry {
  private current: WaveTelemetry = emptyTelemetry(0, null);
  /** Wave enemies of the current wave: id → archetype. */
  private readonly waveEnemies = new Map<string, string>();
  /** Support enemies that used their ability this wave. */
  private readonly completed = new Set<string>();
  private steps = 0;

  /** The telemetry gathered so far for the current wave. */
  get wave(): WaveTelemetry {
    return this.current;
  }

  /** A new wave: everything starts from zero. */
  begin(wave: number, mutation: MutationId | null): void {
    this.current = emptyTelemetry(wave, mutation);
    this.waveEnemies.clear();
    this.completed.clear();
    this.steps = 0;
  }

  isWaveEnemy(id: string): boolean {
    return this.waveEnemies.has(id);
  }

  enemySpawned(id: string, archetype: EnemyArchetypeId): void {
    this.waveEnemies.set(id, archetype);
    if (isSupport(archetype)) {
      this.current.support[archetype].spawned++;
    }
  }

  /** A Screamer screamed or a Spitter spat: it did what it came to do. */
  abilityUsed(id: string): void {
    const archetype = this.waveEnemies.get(id);
    if (!archetype || !isSupport(archetype) || this.completed.has(id)) {
      return;
    }
    this.completed.add(id);
    this.current.support[archetype].completed++;
  }

  /** A hit on something (combat `damaged`); counted only for wave enemies. */
  hit(event: DamagedEvent): void {
    const archetype = this.waveEnemies.get(event.targetId);
    // `direct` damage is not the player's weapon (debug kills, effects).
    if (!archetype || event.source === 'direct') {
      return;
    }
    const M = SIGNAL_MEASURE;
    const melee = event.source === 'melee';
    const distance = melee ? Math.min(event.distance, M.meleeDistance) : event.distance;
    const h = (this.current.hits[archetype] ??= { total: 0, close: 0, long: 0 });
    h.total++;
    if (distance <= M.closeDistance) {
      h.close++;
    }
    if (distance >= M.longDistance) {
      h.long++;
    }
    const weapon = event.weaponId ? WEAPONS[event.weaponId] : null;
    if (weapon?.kind === 'firearm' && !melee) {
      this.current.firearmHits++;
      if (event.zone === 'HEAD') {
        this.current.headHits++;
      }
    }
    if (event.weaponId) {
      this.current.focus[WEAPON_FOCUS_ROLE[event.weaponId]]++;
    }
  }

  /** A firearm shot (weapon `shot`): fired, and whether it hit a wave enemy. */
  shot(event: ShotResult): void {
    this.current.shots++;
    if (
      event.pellets.some((p) => p.hit?.kind === 'target' && this.waveEnemies.has(p.hit.targetId))
    ) {
      this.current.shotsHit++;
    }
  }

  /** Damage the player took (any source; `archetype` when an enemy dealt it). */
  damaged(amount: number, healthFraction: number, archetype: string | null): void {
    this.current.damageTaken += amount;
    this.current.lowestHealth = Math.min(this.current.lowestHealth, healthFraction);
    const key = archetype ?? 'other';
    this.current.damageBy[key] = (this.current.damageBy[key] ?? 0) + amount;
  }

  /**
   * One fixed step while the wave is being fought. Samples the player every `sampleEvery` steps
   * when at least one wave enemy is alive.
   */
  step(
    player: TelemetryPlayer,
    enemies: readonly TelemetryEnemy[],
    walkSpeed: number,
    firearmsOwned: number,
  ): void {
    this.steps++;
    if (this.steps % SIGNAL_MEASURE.sampleEvery !== 0 || enemies.length === 0) {
      return;
    }
    const t = this.current;
    const M = SIGNAL_MEASURE;
    const p = player.position;
    t.samples++;
    t.firearmsOwned = Math.max(t.firearmsOwned, firearmsOwned);
    if (p.y >= M.elevatedHeight) {
      t.elevated++;
    } else {
      const cell = dwellCell(p.x, p.z);
      t.dwell[cell] = (t.dwell[cell] ?? 0) + 1;
    }
    // The nearest wave enemy within kiting range (ties: the first in spawn order).
    let nearest: TelemetryEnemy | null = null;
    let nearestD: number = M.kiteRange;
    for (const e of enemies) {
      const d = Math.hypot(e.position.x - p.x, e.position.z - p.z);
      if (d < nearestD) {
        nearestD = d;
        nearest = e;
      }
    }
    const key = nearest ? nearest.archetype : NO_ENEMY;
    const m = (t.moves[key] ??= { samples: 0, sprint: 0, kite: 0 });
    m.samples++;
    if (player.sprinting) {
      m.sprint++;
    }
    const v = player.velocity;
    const speed = Math.hypot(v.x, v.z);
    if (nearest && speed >= M.kiteSpeedFactor * walkSpeed) {
      const away = v.x * (p.x - nearest.position.x) + v.z * (p.z - nearest.position.z);
      if (away > 0) {
        m.kite++;
      }
    }
  }
}
