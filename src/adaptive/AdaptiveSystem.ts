/**
 * The adaptive system's lifecycle (D-026, D-047): it watches, then adapts, only between waves.
 *
 *   PLAYING (a new run)   everything is forgotten (the profile, the adaptations, the rest timers)
 *   WAVE_START            this wave's telemetry starts (its mutation noted, for discounts)
 *   WAVE_ACTIVE           counting: samples, hits, shots, abilities, damage (`BehaviorTelemetry`)
 *   waveCompleted         measure → fold into the profile → decide → compose: the next wave's
 *                         modifiers are frozen here and the `adaptationDecided` event explains them
 *   WAVE_START (next)     the generator reads the frozen modifiers (`modifiers()`), once
 *
 * Nothing changes during a wave, and nothing marks an adapted enemy: the player learns what
 * changed between waves (SIGNAL ANALYSIS). It never selects, removes or changes a mutation (it does
 * not import the mutation system); it only reads which mutation a wave had, to discount evidence.
 * Deterministic: fixed steps and events only, no randomness.
 */

import type { CombatEvents } from '../combat/CombatSystem';
import { SIGNAL_MEASURE, type AdaptationId } from '../config/adaptation';
import type { CompositionModifier } from '../config/waves';
import { EventBus, type Unsubscribe } from '../core/EventBus';
import type { FixedUpdateSystem } from '../core/Game';
import type { GameStateMachine } from '../core/GameState';
import type { EnemyEvents } from '../enemies/events';
import type { PlayerHealthEvents } from '../player/PlayerHealth';
import type { WaveEvents } from '../waves/events';
import type { WeaponEvents } from '../weapons/types';
import type { SpawnPointDefinition } from '../world/levels/types';
import { BehaviorTelemetry, type TelemetryEnemy, type TelemetryPlayer } from './BehaviorTelemetry';
import { boostedArchetypes, composeModifiers, regionsNear } from './compose';
import { decide } from './director';
import { measureWave } from './measure';
import { emptyProfile, foldEvidence } from './profile';
import {
  EMPTY_STATE,
  type ActiveAdaptation,
  type AdaptationChange,
  type AdaptationState,
  type BehaviorProfile,
  type WaveEvidence,
  type WaveTelemetry,
} from './types';

export interface AdaptiveEvents {
  /** After a wave: what the horde does for the next one, and why (SIGNAL ANALYSIS). */
  adaptationDecided: {
    readonly wave: number;
    readonly forWave: number;
    readonly changes: readonly AdaptationChange[];
    readonly active: readonly ActiveAdaptation[];
    readonly governor: boolean;
  };
  /** A new run: nothing is remembered. */
  adaptationReset: undefined;
}

/** A living enemy, as the system reads it. */
interface LiveEnemy {
  readonly id: string;
  readonly alive: boolean;
  readonly archetype: { readonly id: string };
  readonly motor: { readonly position: TelemetryEnemy['position'] };
}

export interface AdaptiveSystemOptions {
  readonly state: GameStateMachine;
  readonly waves: { readonly events: EventBus<WaveEvents> };
  readonly enemies: {
    readonly events: EventBus<EnemyEvents>;
    readonly enemies: readonly LiveEnemy[];
  };
  readonly combat: EventBus<CombatEvents>;
  readonly player: EventBus<PlayerHealthEvents>;
  /** Weapon events (shots for accuracy); optional in tests that apply hits directly. */
  readonly weapons?: EventBus<WeaponEvents>;
  /** The player's body for position samples (null: no sample). */
  readonly body: () => TelemetryPlayer | null;
  readonly walkSpeed: number;
  /** Firearms the player owns right now (weapon focus needs a choice). */
  readonly firearmsOwned?: () => number;
  /** The level's spawn points (spawn bias toward where the player dwells). */
  readonly spawnPoints: readonly SpawnPointDefinition[];
  /** Seconds per fixed step. */
  readonly fixedDt: number;
}

/** Read-only view for debug tools and tests. */
export interface AdaptiveSnapshot {
  readonly enabled: boolean;
  readonly profile: BehaviorProfile;
  readonly state: AdaptationState;
  readonly modifiers: readonly CompositionModifier[];
  readonly lastEvidence: WaveEvidence | null;
  readonly telemetry: WaveTelemetry;
  /** Every adaptation that entered this run, in order (end screens). */
  readonly history: readonly AdaptationId[];
}

export class AdaptiveSystem implements FixedUpdateSystem {
  readonly events = new EventBus<AdaptiveEvents>();
  private readonly options: AdaptiveSystemOptions;
  private readonly telemetry = new BehaviorTelemetry();
  private profile: BehaviorProfile = emptyProfile();
  private adaptation: AdaptationState = EMPTY_STATE;
  private frozen: readonly CompositionModifier[] = [];
  private lastEvidence: WaveEvidence | null = null;
  private history: AdaptationId[] = [];
  private enabled = true;
  private readonly scratch: TelemetryEnemy[] = [];

  constructor(options: AdaptiveSystemOptions) {
    this.options = options;
  }

  /** The next wave's adaptive modifiers: frozen when the last wave ended (WaveManager reads them). */
  modifiers(): readonly CompositionModifier[] {
    return this.enabled ? this.frozen : [];
  }

  get snapshot(): AdaptiveSnapshot {
    return {
      enabled: this.enabled,
      profile: this.profile,
      state: this.adaptation,
      modifiers: this.modifiers(),
      lastEvidence: this.lastEvidence,
      telemetry: this.telemetry.wave,
      history: [...this.history],
    };
  }

  attach(): Unsubscribe {
    const { state, waves, enemies, combat, player, weapons } = this.options;
    const offs: Unsubscribe[] = [
      state.onEnter('PLAYING', () => {
        this.reset();
      }),
      waves.events.on('waveStarting', ({ wave, definition }) => {
        this.telemetry.begin(wave, definition.mutation);
      }),
      waves.events.on('enemySpawned', ({ id, archetype }) => {
        this.telemetry.enemySpawned(id, archetype);
      }),
      waves.events.on('waveCompleted', ({ wave }) => {
        this.conclude(wave);
      }),
      enemies.events.on('alarm', (e) => {
        // A Screamer's completed scream (a death cry is not an ability anyone chose to let happen).
        if (e.kind === 'scream' && this.recording()) {
          this.telemetry.abilityUsed(e.sourceId);
        }
      }),
      enemies.events.on('spat', (e) => {
        if (this.recording()) {
          this.telemetry.abilityUsed(e.id);
        }
      }),
      combat.on('damaged', (e) => {
        if (this.recording()) {
          this.telemetry.hit(e);
        }
      }),
      player.on('damaged', (e) => {
        if (this.recording()) {
          this.telemetry.damaged(
            e.amount,
            e.max > 0 ? e.health / e.max : 0,
            e.source.kind === 'enemy' ? e.source.archetype : null,
          );
        }
      }),
    ];
    if (weapons) {
      offs.push(
        weapons.on('shot', (e) => {
          if (this.recording()) {
            this.telemetry.shot(e);
          }
        }),
      );
    }
    return () => {
      for (const off of offs) {
        off();
      }
    };
  }

  fixedUpdate(): void {
    if (!this.recording()) {
      return;
    }
    const body = this.options.body();
    if (!body) {
      return;
    }
    const list = this.scratch;
    list.length = 0;
    for (const e of this.options.enemies.enemies) {
      if (e.alive && this.telemetry.isWaveEnemy(e.id)) {
        list.push({ archetype: e.archetype.id, position: e.motor.position });
      }
    }
    this.telemetry.step(body, list, this.options.walkSpeed, this.options.firearmsOwned?.() ?? 1);
  }

  /** Forget everything (a new run). */
  reset(): void {
    this.profile = emptyProfile();
    this.adaptation = EMPTY_STATE;
    this.frozen = [];
    this.lastEvidence = null;
    this.history = [];
    this.telemetry.begin(0, null);
    this.events.emit('adaptationReset', undefined);
  }

  /** Turn adaptation on or off (debug). Off: no modifiers reach the waves; watching continues. */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * Debug: put `id` active at `level` for the next wave (as if the director had decided it).
   * Bypasses the evidence, never the composition caps or the generator's rules.
   */
  force(id: AdaptationId, level: 1 | 2, key: string, nextWave: number): void {
    const others = this.adaptation.active.filter((a) => a.id !== id);
    this.adaptation = {
      ...this.adaptation,
      active: [...others, { id, key, level, since: nextWave, levelSince: nextWave }],
    };
    this.refreeze(nextWave);
  }

  /** Debug: no active adaptation, no rest timers (the profile is kept). */
  clear(nextWave: number): void {
    this.adaptation = EMPTY_STATE;
    this.refreeze(nextWave);
  }

  /**
   * Debug and E2E: fold synthetic evidence for `waves` waves ending at `wave`, then decide for the
   * next wave exactly as after a real one (the same event, the same analysis).
   */
  feed(evidence: (wave: number) => WaveEvidence, wave: number, waves: number): void {
    for (let i = waves - 1; i >= 0; i--) {
      this.profile = foldEvidence(this.profile, evidence(wave - i));
    }
    this.decideFor(wave);
  }

  private recording(): boolean {
    const { state } = this.options;
    return state.isIn('WAVE_ACTIVE') || state.isIn('BOSS');
  }

  private conclude(wave: number): void {
    const evidence = measureWave(this.telemetry.wave, {
      sampleSeconds: this.options.fixedDt * SIGNAL_MEASURE.sampleEvery,
      boosted: boostedArchetypes(this.adaptation.active, wave),
    });
    this.lastEvidence = evidence;
    this.profile = foldEvidence(this.profile, evidence);
    this.decideFor(wave);
  }

  private decideFor(wave: number): void {
    const outcome = decide(this.profile, this.adaptation, wave + 1);
    this.adaptation = outcome.state;
    for (const c of outcome.changes) {
      if (c.kind === 'enter' && c.id !== 'governor') {
        this.history.push(c.id);
      }
    }
    this.refreeze(wave + 1);
    this.events.emit('adaptationDecided', {
      wave,
      forWave: outcome.forWave,
      changes: outcome.changes,
      active: outcome.state.active,
      governor: outcome.governor,
    });
  }

  private refreeze(nextWave: number): void {
    this.frozen = composeModifiers(this.adaptation.active, {
      wave: nextWave,
      dwellRegions: regionsNear(this.profile.dwellCentroid, this.options.spawnPoints),
    });
  }
}
