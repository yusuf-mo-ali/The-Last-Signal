/**
 * The player's health (plan §5 `PlayerHealth`, GAME_DESIGN §4.2, D-042), built on the Phase 3
 * `Health` rather than a second health system:
 * - configurable maximum, current health, damage, healing, death once, reset for a new run;
 * - damage is ignored while `canBeDamaged()` says no: D-029, only during WAVE_ACTIVE and BOSS
 *   (the composition root supplies the rule), and never in god mode (debug);
 * - `events` are the hooks the HUD, screen effects, audio and the game-over flow listen to.
 *
 * Browser-independent.
 */

import { Health } from '../combat/Health';
import { PLAYER_HEALTH, type PlayerHealthConfig } from '../config/player';
import { EventBus } from '../core/EventBus';
import type { Vec3Tuple } from '../weapons/types';

/** Who or what hurt the player. */
export type PlayerDamageSource =
  | { readonly kind: 'enemy'; readonly id: string; readonly archetype: string }
  | { readonly kind: 'debug' };

export interface PlayerDamage {
  readonly amount: number;
  readonly source: PlayerDamageSource;
  /** Unit direction the hit travelled in (attacker → player), if it had one. */
  readonly direction?: Vec3Tuple;
}

export interface PlayerHealthEvents {
  damaged: {
    readonly amount: number;
    readonly health: number;
    readonly max: number;
    readonly source: PlayerDamageSource;
    readonly direction: Vec3Tuple | null;
    readonly killed: boolean;
  };
  /** Once per death. */
  died: { readonly source: PlayerDamageSource };
  healed: { readonly amount: number; readonly health: number; readonly max: number };
  /** A new run (or a debug reset): full health, alive. */
  reset: { readonly health: number; readonly max: number };
}

export interface PlayerHealthOptions {
  readonly config?: PlayerHealthConfig;
  /** Whether the player can be hurt right now (D-029). Default: always. */
  readonly canBeDamaged?: () => boolean;
}

export class PlayerHealth {
  readonly events = new EventBus<PlayerHealthEvents>();
  readonly health: Health;
  /** Debug: damage is ignored. */
  godMode = false;
  private readonly canBeDamaged: () => boolean;

  constructor(options: PlayerHealthOptions = {}) {
    this.health = new Health({ max: (options.config ?? PLAYER_HEALTH).max });
    this.canBeDamaged = options.canBeDamaged ?? (() => true);
  }

  get current(): number {
    return this.health.current;
  }

  get max(): number {
    return this.health.max;
  }

  get isDead(): boolean {
    return this.health.isDead;
  }

  /** Whether damage would be applied right now. */
  get vulnerable(): boolean {
    return !this.godMode && !this.health.isDead && this.canBeDamaged();
  }

  /** Applies damage if the player can be hurt. Returns the health removed. */
  damage(damage: PlayerDamage): number {
    if (!this.vulnerable) {
      return 0;
    }
    const outcome = this.health.damage(damage.amount);
    if (outcome.ignored) {
      return 0;
    }
    this.events.emit('damaged', {
      amount: outcome.applied,
      health: this.health.current,
      max: this.health.max,
      source: damage.source,
      direction: damage.direction ?? null,
      killed: outcome.killed,
    });
    if (outcome.killed) {
      this.events.emit('died', { source: damage.source });
    }
    return outcome.applied;
  }

  /** Restores health (never while dead). Returns the amount restored. */
  heal(amount: number): number {
    const restored = this.health.heal(amount);
    if (restored > 0) {
      this.events.emit('healed', {
        amount: restored,
        health: this.health.current,
        max: this.health.max,
      });
    }
    return restored;
  }

  /** Full health and alive: the start of a run. */
  reset(): void {
    this.health.revive();
    this.events.emit('reset', { health: this.health.current, max: this.health.max });
  }
}
