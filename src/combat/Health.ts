/**
 * Reusable health (D-041): current and maximum health, damage, healing and death. Owned by
 * whatever can be hurt: training dummies now, zombies, bosses and (with enemy attacks, Phase 4)
 * the player. It knows nothing about zones, weapons or events; the combat system adds those.
 *
 * Rules:
 * - Health stays within [0, max]. Reaching 0 is death, and death happens once.
 * - A dead owner ignores damage and healing until `revive` (respawning dummies, pooled enemies).
 * - Unusable amounts (zero, negative, NaN, infinite healing) change nothing.
 */

/** Health below this counts as zero, so floating-point dust never leaves a target at 1e-15 HP. */
const DEATH_EPSILON = 1e-9;

export interface HealthOptions {
  readonly max: number;
  /** Starting health; defaults to `max`. Clamped to (0, max]. */
  readonly start?: number;
}

export interface DamageOutcome {
  /** Health actually removed (at most what was left). */
  readonly applied: number;
  /** Damage beyond what was needed to kill. */
  readonly overkill: number;
  /** True only for the hit that killed. */
  readonly killed: boolean;
  /** True when nothing happened because the owner was already dead or the amount was unusable. */
  readonly ignored: boolean;
}

const IGNORED: DamageOutcome = Object.freeze({
  applied: 0,
  overkill: 0,
  killed: false,
  ignored: true,
});

export class Health {
  private maxValue: number;
  private currentValue: number;
  private dead = false;

  constructor(options: HealthOptions) {
    if (!Number.isFinite(options.max) || options.max <= 0) {
      throw new RangeError('Health max must be a positive finite number');
    }
    this.maxValue = options.max;
    this.currentValue = this.startValue(options.start);
  }

  get current(): number {
    return this.currentValue;
  }

  get max(): number {
    return this.maxValue;
  }

  get isDead(): boolean {
    return this.dead;
  }

  get isAlive(): boolean {
    return !this.dead;
  }

  /** 0–1. */
  get fraction(): number {
    return this.currentValue / this.maxValue;
  }

  damage(amount: number): DamageOutcome {
    if (this.dead || !(amount > 0) || Number.isNaN(amount)) {
      return IGNORED;
    }
    const applied = Math.min(amount, this.currentValue);
    this.currentValue -= applied;
    if (this.currentValue > DEATH_EPSILON) {
      return { applied, overkill: 0, killed: false, ignored: false };
    }
    this.currentValue = 0;
    this.dead = true;
    return { applied, overkill: amount - applied, killed: true, ignored: false };
  }

  /** Restores health up to the maximum. Returns how much was restored (0 while dead). */
  heal(amount: number): number {
    if (this.dead || !(amount > 0) || !Number.isFinite(amount)) {
      return 0;
    }
    const restored = Math.min(amount, this.maxValue - this.currentValue);
    this.currentValue += restored;
    return restored;
  }

  /** Brings the owner back to life with `health` (default: full). */
  revive(health?: number): void {
    this.dead = false;
    this.currentValue = this.startValue(health);
  }

  /**
   * Changes the maximum (upgrades, difficulty scaling). Current health keeps its fraction when
   * `keepFraction` is set, otherwise it is only clamped to the new maximum.
   */
  setMax(max: number, keepFraction = false): void {
    if (!Number.isFinite(max) || max <= 0) {
      throw new RangeError('Health max must be a positive finite number');
    }
    const fraction = this.fraction;
    this.maxValue = max;
    if (!this.dead) {
      this.currentValue = keepFraction ? max * fraction : Math.min(this.currentValue, max);
    }
  }

  private startValue(start: number | undefined): number {
    if (start === undefined || !Number.isFinite(start)) {
      return this.maxValue;
    }
    return Math.min(this.maxValue, Math.max(DEATH_EPSILON * 2, start));
  }
}
