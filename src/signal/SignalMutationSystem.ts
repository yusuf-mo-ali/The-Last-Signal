/**
 * Applies the wave's Signal Mutation and removes it again (D-024, D-045). It holds no rule of any
 * single mutation: it applies the mutation's effects (data, `config/mutations.ts`) through the
 * `EffectRouter` under the source id `mutation:<ID>`, at the right moments of the wave cycle:
 *
 *   WAVE_START  (waveStarting)  announce it; its environment overlay fades in over the intro
 *   WAVE_ACTIVE                 its stats, triggers and screen effects take hold
 *   WAVE_COMPLETE               everything is removed; the lighting fades back in the breather
 *   GAME_OVER                   stats, triggers and screen effects removed; the world freezes as it was
 *   VICTORY / MAIN_MENU / a new run                   everything removed at once
 *
 * Pausing changes nothing: no state hooks fire and no fixed steps run, so fades and bursts hold.
 * Composition effects (HIVE, BLOOD MOON) are not applied here: the wave generator already built
 * them into the wave.
 *
 * It also bridges enemy deaths to the trigger registry (`enemy:died`), and reports STATIC bursts.
 */

import { MUTATIONS, type MutationConfig, type MutationId } from '../config/mutations';
import { EventBus, type Unsubscribe } from '../core/EventBus';
import type { GameStateMachine } from '../core/GameState';
import type { EnemyManager } from '../enemies/EnemyManager';
import type { EffectRouter } from '../modifiers/EffectRouter';
import type { ScreenEffects } from '../modifiers/ScreenEffects';
import type { TriggerRegistry } from '../modifiers/TriggerRegistry';
import { Rng } from '../utils/Rng';
import type { WaveManager } from '../waves/WaveManager';
import { registerMutationActions } from './actions';
import type { MutationEvents, MutationRevertReason } from './events';

export interface SignalMutationSystemOptions {
  readonly state: GameStateMachine;
  readonly waves: WaveManager;
  readonly enemies: EnemyManager;
  readonly router: EffectRouter;
  readonly triggers: TriggerRegistry;
  readonly screen: ScreenEffects;
  readonly catalogue?: Readonly<Record<MutationId, MutationConfig>>;
}

/** Where the current mutation is in its wave. */
export type MutationPhase = 'none' | 'announced' | 'active' | 'lifted' | 'ended';

export interface MutationStatus {
  readonly wave: number;
  readonly id: MutationId | null;
  readonly name: string | null;
  readonly phase: MutationPhase;
}

const PREFIX = 'mutation:';
const sourceOf = (id: MutationId) => `${PREFIX}${id}`;

export class SignalMutationSystem {
  readonly events = new EventBus<MutationEvents>();
  private readonly options: SignalMutationSystemOptions;
  private readonly catalogue: Readonly<Record<MutationId, MutationConfig>>;
  private readonly unsubscribe: Unsubscribe[] = [];
  private current: { readonly wave: number; readonly id: MutationId } | null = null;
  private phase: MutationPhase = 'none';

  constructor(options: SignalMutationSystemOptions) {
    this.options = options;
    this.catalogue = options.catalogue ?? MUTATIONS;
  }

  get status(): MutationStatus {
    const id = this.current?.id ?? null;
    return {
      wave: this.current?.wave ?? 0,
      id,
      name: id ? this.catalogue[id].name : null,
      phase: this.phase,
    };
  }

  /** Starts following the wave cycle. Returns the detach function. */
  attach(): Unsubscribe {
    const { state, waves, enemies, triggers, screen } = this.options;
    this.unsubscribe.push(
      registerMutationActions(triggers, enemies),
      waves.events.on('waveStarting', ({ wave, definition }) => {
        this.announce(wave, definition.mutation);
      }),
      state.onEnter('WAVE_ACTIVE', () => {
        this.activate();
      }),
      state.onEnter('WAVE_COMPLETE', () => {
        this.lift('cleared');
      }),
      state.onEnter('GAME_OVER', () => {
        this.end('died', { keepEnvironment: true });
      }),
      state.onEnter('VICTORY', () => {
        this.end('ended', { keepEnvironment: false });
      }),
      state.onEnter('MAIN_MENU', () => {
        this.end('ended', { keepEnvironment: false });
      }),
      state.onEnter('PLAYING', () => {
        this.reset();
      }),
      enemies.events.on('died', (e) => {
        triggers.dispatch('enemy:died', { id: e.id, position: e.position });
      }),
      screen.onBurst((burst) => {
        const current = this.current;
        if (current && burst.sourceId === sourceOf(current.id)) {
          this.events.emit('staticBurst', {
            wave: current.wave,
            id: current.id,
            start: burst.start,
            until: burst.until,
            intensity: burst.intensity,
          });
        }
      }),
    );
    return () => {
      this.detach();
    };
  }

  detach(): void {
    for (const off of this.unsubscribe) {
      off();
    }
    this.unsubscribe.length = 0;
    this.options.router.removeAllWithPrefix(PREFIX, { immediate: true });
  }

  /** Debug: removes the current mutation's run-time effects now (its composition stays). */
  clear(): boolean {
    const current = this.current;
    if (!current || this.phase === 'none' || this.phase === 'ended') {
      return false;
    }
    this.options.router.remove(sourceOf(current.id));
    this.phase = 'ended';
    this.events.emit('mutationReverted', { ...current, reason: 'debug' });
    return true;
  }

  private announce(wave: number, id: MutationId | null): void {
    // A wave generated again (a debug jump) replaces whatever was announced.
    if (this.current && this.phase !== 'ended') {
      this.options.router.remove(sourceOf(this.current.id), { immediate: true });
      if (this.phase === 'announced' || this.phase === 'active') {
        this.events.emit('mutationReverted', { ...this.current, reason: 'replaced' });
      }
    }
    this.current = id ? { wave, id } : null;
    this.phase = id ? 'announced' : 'none';
    if (!id) {
      return;
    }
    const m = this.catalogue[id];
    this.options.router.apply(sourceOf(id), m.effects, { kinds: ['environment'] });
    this.events.emit('mutationAnnounced', {
      wave,
      id,
      name: m.name,
      rule: m.rule,
      hint: m.hint,
      accent: m.accent,
    });
  }

  private activate(): void {
    const current = this.current;
    if (!current || this.phase !== 'announced') {
      return;
    }
    this.options.router.apply(sourceOf(current.id), this.catalogue[current.id].effects, {
      kinds: ['stat', 'trigger', 'screen'],
      rng: new Rng(`${this.options.waves.seed}:mutation:${current.wave}:static`),
    });
    this.phase = 'active';
    this.events.emit('mutationApplied', current);
  }

  private lift(reason: MutationRevertReason): void {
    const current = this.current;
    if (!current || (this.phase !== 'announced' && this.phase !== 'active')) {
      return;
    }
    this.options.router.remove(sourceOf(current.id)); // the lighting fades back
    this.phase = 'lifted';
    this.events.emit('mutationReverted', { ...current, reason });
  }

  private end(reason: MutationRevertReason, options: { readonly keepEnvironment: boolean }): void {
    const current = this.current;
    if (!current || this.phase === 'none' || this.phase === 'ended') {
      return;
    }
    const wasLive = this.phase === 'announced' || this.phase === 'active';
    this.options.router.remove(sourceOf(current.id), {
      ...(options.keepEnvironment ? { kinds: ['stat', 'trigger', 'screen'] as const } : {}),
      immediate: true,
    });
    this.phase = 'ended';
    if (wasLive) {
      this.events.emit('mutationReverted', { ...current, reason });
    }
  }

  /** A new run: nothing of the last run's mutations remains. */
  private reset(): void {
    this.options.router.removeAllWithPrefix(PREFIX, { immediate: true });
    this.current = null;
    this.phase = 'none';
  }
}
