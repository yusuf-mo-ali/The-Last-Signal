/**
 * Applies and removes effects by source id (D-009): one entry point for mutations now, and for
 * upgrades and adaptive responses later. Each effect kind goes to its consumer:
 *
 *   stat        → StatRegistry          trigger → TriggerRegistry
 *   environment → Environment (overlay) screen  → ScreenEffects (seeded schedule)
 *   spawnRule   → nothing at run time: the wave generator reads it when the wave is built
 *
 * Application is atomic: every effect is validated first (registered stat targets and trigger
 * actions), so a source is either fully applied or not at all, and never half-applied. Values are
 * clamped again here (D-045 guardrails), whatever the data says.
 */

import { EFFECT_CLAMPS, type Effect, type EffectKind, type EffectOf } from '../config/effects';
import type { Rng } from '../utils/Rng';
import type { Environment } from '../world/Environment';
import type { ScreenEffects } from './ScreenEffects';
import type { StatRegistry } from './StatRegistry';
import type { TriggerParams, TriggerRegistry } from './TriggerRegistry';

export interface EffectTargets {
  readonly stats: StatRegistry;
  readonly triggers: TriggerRegistry;
  readonly environment: Environment;
  readonly screen: ScreenEffects;
}

export interface ApplyOptions {
  /** Only these kinds (a mutation applies its environment first, the rest when the wave starts). */
  readonly kinds?: readonly EffectKind[];
  /** The stream screen effects draw their schedule from. */
  readonly rng?: Rng;
}

export interface RemoveOptions {
  readonly kinds?: readonly EffectKind[];
  /** Environment overlays vanish at once instead of fading out. */
  readonly immediate?: boolean;
}

export class EffectRejectedError extends Error {
  constructor(sourceId: string, reason: string) {
    super(`Effects of "${sourceId}" rejected: ${reason}`);
    this.name = 'EffectRejectedError';
  }
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** A stat modifier's value within the guardrails for its target. */
function clampStat(effect: EffectOf<'stat'>): number {
  if (effect.target.startsWith('enemy.') && effect.op === 'mul') {
    const [lo, hi] = EFFECT_CLAMPS.enemySpeedMultiplier;
    return clamp(effect.value, lo, hi);
  }
  return effect.value;
}

/** An alarm action's params within the guardrails. */
function clampAlarmParams(params: TriggerParams | undefined): TriggerParams {
  const a = EFFECT_CLAMPS.alarm;
  const p = params ?? {};
  return {
    radius: clamp(p.radius ?? 0, 0, a.radius),
    alertDuration: clamp(p.alertDuration ?? 0, 0, a.alertDuration),
    hasteMultiplier: clamp(p.hasteMultiplier ?? 1, 1, a.hasteMultiplier),
    hasteDuration: clamp(p.hasteDuration ?? 0, 0, a.hasteDuration),
  };
}

export class EffectRouter {
  private readonly targets: EffectTargets;
  /** What each source applied, by kind (so removal can be partial). */
  private readonly applied = new Map<string, Set<EffectKind>>();

  constructor(targets: EffectTargets) {
    this.targets = targets;
  }

  /** Whether every effect could be applied (registered targets and actions). */
  check(effects: readonly Effect[]): { ok: true } | { ok: false; reason: string } {
    const { stats, triggers } = this.targets;
    for (const e of effects) {
      if (e.kind === 'stat' && !stats.isRegistered(e.target)) {
        return { ok: false, reason: `stat "${e.target}" is not registered` };
      }
      if (e.kind === 'trigger' && !triggers.isRegistered(e.action)) {
        return { ok: false, reason: `action "${e.action}" is not registered` };
      }
    }
    return { ok: true };
  }

  /** Applies `effects` for `sourceId` (all or nothing). Throws when one cannot be applied. */
  apply(sourceId: string, effects: readonly Effect[], options: ApplyOptions = {}): void {
    const chosen = options.kinds ? effects.filter((e) => options.kinds?.includes(e.kind)) : effects;
    const verdict = this.check(chosen);
    if (!verdict.ok) {
      throw new EffectRejectedError(sourceId, verdict.reason);
    }
    // Re-applying a kind replaces it (idempotent). An overlay is restarted in place instead, so
    // it continues from its current weight rather than snapping.
    this.remove(sourceId, {
      kinds: [...new Set(chosen.map((e) => e.kind))].filter((k) => k !== 'environment'),
      immediate: true,
    });
    const { stats, triggers, environment, screen } = this.targets;
    const kinds = this.applied.get(sourceId) ?? new Set<EffectKind>();
    for (const e of chosen) {
      switch (e.kind) {
        case 'stat':
          stats.add(sourceId, e.target, e.op, clampStat(e));
          break;
        case 'trigger':
          triggers.add(
            sourceId,
            e.on,
            e.action,
            e.action === 'deathCry' ? clampAlarmParams(e.params) : (e.params ?? {}),
          );
          break;
        case 'environment': {
          const [lo, hi] = EFFECT_CLAMPS.fade;
          environment.addOverlay(sourceId, e.overlay, {
            priority: e.priority,
            fadeIn: clamp(e.fadeIn, lo, hi),
            fadeOut: clamp(e.fadeOut, lo, hi),
          });
          break;
        }
        case 'screen':
          if (!options.rng) {
            throw new EffectRejectedError(sourceId, 'a screen effect needs an rng stream');
          }
          screen.startStatic(sourceId, e.params, options.rng);
          break;
        case 'spawnRule':
          // Read by the wave generator when the wave is built; nothing to run.
          break;
      }
      kinds.add(e.kind);
    }
    this.applied.set(sourceId, kinds);
  }

  /** Removes what `sourceId` applied (all kinds, or only `kinds`). */
  remove(sourceId: string, options: RemoveOptions = {}): void {
    const only = options.kinds;
    const has = (k: EffectKind) => !only || only.includes(k);
    const { stats, triggers, environment, screen } = this.targets;
    if (has('stat')) {
      stats.removeSource(sourceId);
    }
    if (has('trigger')) {
      triggers.removeSource(sourceId);
    }
    if (has('environment')) {
      environment.removeSource(sourceId, { immediate: options.immediate ?? false });
    }
    if (has('screen')) {
      screen.stop(sourceId);
    }
    const kinds = this.applied.get(sourceId);
    if (kinds) {
      for (const k of [...kinds]) {
        if (has(k)) {
          kinds.delete(k);
        }
      }
      if (kinds.size === 0) {
        this.applied.delete(sourceId);
      }
    }
  }

  /** Removes every source whose id starts with `prefix` (e.g. `mutation:`). */
  removeAllWithPrefix(prefix: string, options: RemoveOptions = {}): void {
    const ids = new Set([
      ...this.applied.keys(),
      ...this.targets.stats.sources(),
      ...this.targets.triggers.sources(),
      ...this.targets.environment.sources(),
      ...this.targets.screen.sources(),
    ]);
    for (const id of ids) {
      if (id.startsWith(prefix)) {
        this.remove(id, options);
      }
    }
  }

  /** Every source with something applied, by consumer (debug; leak checks in tests). */
  sources(): {
    readonly stats: string[];
    readonly triggers: string[];
    readonly environment: string[];
    readonly screen: string[];
  } {
    return {
      stats: this.targets.stats.sources(),
      triggers: this.targets.triggers.sources(),
      environment: this.targets.environment.sources(),
      screen: this.targets.screen.sources(),
    };
  }
}
