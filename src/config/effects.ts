/**
 * The effect vocabulary shared by upgrades, mutations, difficulty and adaptation (D-009, D-045).
 * Content refers to effects by data; the modifier runtime (`src/modifiers/`) interprets them:
 *
 * - `stat`: a sourced modifier on a named stat (`StatRegistry`), removed exactly by its source id.
 * - `trigger`: a named action run when an event fires (`TriggerRegistry`).
 * - `spawnRule`: how a wave is composed and paced; read by the wave generator when the wave is
 *   built (it never changes a wave already running).
 * - `environment`: a temporary lighting overlay on the base environment (D-028).
 * - `screen`: a presentation-only screen effect scheduled by the simulation.
 *
 * Every target and action a v1 mutation uses is registered by the runtime; the deferred mutations
 * (LOW GRAVITY, OVERLOAD) name targets that are not, so they cannot be applied by accident.
 */

import type { EnemyArchetypeId, EnemyModifierId } from './enemies';

export const EFFECT_KINDS = ['stat', 'trigger', 'spawnRule', 'environment', 'screen'] as const;
export type EffectKind = (typeof EFFECT_KINDS)[number];

export type StatOp = 'add' | 'mul' | 'override';

/** Stats effects may change. Registered at run time: the enemy ones (Phase 7). */
export const STAT_TARGETS = [
  'enemy.moveSpeed',
  'enemy.acceleration',
  // Declared for deferred content (LOW GRAVITY, OVERLOAD); not registered yet.
  'world.gravity',
  'weapon.recoil',
] as const;
export type StatTarget = (typeof STAT_TARGETS)[number];

/** Events triggers listen to. */
export const TRIGGER_EVENTS = ['enemy:died', 'weapon:shot'] as const;
export type TriggerEvent = (typeof TRIGGER_EVENTS)[number];

/** Named actions triggers run. `environmentPulse` is declared for OVERLOAD (deferred). */
export const TRIGGER_ACTIONS = ['deathCry', 'environmentPulse'] as const;
export type TriggerAction = (typeof TRIGGER_ACTIONS)[number];

/** Temporary environment overlays (D-028). */
export const ENVIRONMENT_OVERLAY_IDS = ['blackout', 'bloodMoon'] as const;
export type EnvironmentOverlayId = (typeof ENVIRONMENT_OVERLAY_IDS)[number];

/** How a wave's composition changes (merged into the generator's modifiers, clamped there). */
export interface MutationComposition {
  /** Budget scale (mutations only; clamped to `WAVE_RULES.modifierClamp.budget`). */
  readonly budgetMultiplier?: number;
  /** Added to per-enemy trait chances. */
  readonly traitChance?: Readonly<Partial<Record<EnemyModifierId, number>>>;
  /** Weight multipliers per archetype. */
  readonly archetypeWeights?: Readonly<Partial<Record<EnemyArchetypeId, number>>>;
  /** Raises the wave's Elite limit by this much (plus `eliteMaxBonusPerWaves` growth). */
  readonly eliteMaxBonus?: number;
  /** Extra Elite allowance every this many waves past `eliteMaxBonusFrom`. */
  readonly eliteMaxBonusEvery?: number;
  readonly eliteMaxBonusFrom?: number;
  /** At least this many Elites (when the budget allows). */
  readonly eliteMinimum?: number;
}

/** Extra spawn events: bigger groups announced a moment before they arrive. */
export interface SurgeRule {
  /** Fractions of the wave's queue spawned at which a surge starts (ascending, in (0, 1)). */
  readonly at: readonly number[];
  /** Enemies added to the wave's largest group size for a surge. */
  readonly extraGroupSize: number;
  /** Seconds between the warning and the surge arriving. */
  readonly warning: number;
}

/** STATIC's interference bursts (seconds; opacity 0–1). */
export interface StaticParams {
  readonly intervalMin: number;
  readonly intervalMax: number;
  readonly durationMin: number;
  readonly durationMax: number;
  /** Peak opacity of the interference layer. */
  readonly opacity: number;
  /** No burst in the first seconds of a wave. */
  readonly firstAfter: number;
}

export type Effect =
  /** Changes a named stat, e.g. `{ target: 'enemy.moveSpeed', op: 'mul', value: 1.2 }`. */
  | {
      readonly kind: 'stat';
      readonly target: StatTarget;
      readonly op: StatOp;
      readonly value: number;
    }
  /** Runs a named action when an event fires, e.g. a death cry on `enemy:died`. */
  | {
      readonly kind: 'trigger';
      readonly on: TriggerEvent;
      readonly action: TriggerAction;
      readonly params?: Readonly<Record<string, number>>;
    }
  /** Changes how the wave is composed and paced (read when the wave is generated). */
  | {
      readonly kind: 'spawnRule';
      readonly composition?: MutationComposition;
      readonly surges?: SurgeRule;
    }
  /** Applies an environment overlay (D-028): higher priority wins per channel. */
  | {
      readonly kind: 'environment';
      readonly overlay: EnvironmentOverlayId;
      readonly priority: number;
      /** Seconds to blend in and out (simulated time). */
      readonly fadeIn: number;
      readonly fadeOut: number;
    }
  /** A presentation-only screen effect, scheduled by the simulation. */
  | { readonly kind: 'screen'; readonly effect: 'static'; readonly params: StaticParams };

export type EffectOf<K extends EffectKind> = Extract<Effect, { kind: K }>;

/**
 * Hard limits on what any effect may do (D-045 guardrails). Checked on the data (config tests) and
 * again when an effect is applied, so a bad value can never make a wave impossible.
 */
export const EFFECT_CLAMPS = {
  /** Multiplier range for the enemy movement stats. */
  enemySpeedMultiplier: [0.5, 1.25],
  /**
   * An effect never pushes an enemy above this share of the player's sprint speed, unless the
   * enemy was already faster without it (then the effect adds nothing).
   */
  enemySpeedCapOfSprint: 0.9,
  /** Alarm actions (a death cry): reach, alert and haste limits. */
  alarm: { radius: 10, alertDuration: 8, hasteMultiplier: 1.25, hasteDuration: 3 },
  /** Environment overlays: fades within these many seconds. */
  fade: [0, 5],
  /** STATIC: at most this opaque, this long, this often; never flickering faster than 3 Hz. */
  static: { opacity: 0.35, durationMax: 0.8, intervalMin: 5, firstAfter: 2 },
} as const;
