/**
 * Screen effects scheduled by the simulation (D-009 `screen`, D-045): STATIC's interference
 * bursts. The schedule is seeded and measured in simulated time, so it is identical for the same
 * seed at any frame rate and holds still while paused; the presentation (`ui/StaticOverlay`) only
 * draws the current burst. Nothing here changes gameplay.
 *
 * Guardrails (clamped whatever the data says): at most `EFFECT_CLAMPS.static.opacity` opaque,
 * `durationMax` long, `intervalMin` apart, and never in the first `firstAfter` seconds.
 */

import { EFFECT_CLAMPS, type GlitchParams, type StaticParams } from '../config/effects';
import type { FixedUpdateSystem } from '../core/Game';
import type { Rng } from '../utils/Rng';

export interface ScreenBurst {
  readonly sourceId: string;
  readonly start: number;
  readonly until: number;
  /** Peak opacity (0–1). */
  readonly intensity: number;
  /** How it distorts the 3D image (clamped), or null for the grain layer only. */
  readonly glitch: GlitchParams | null;
}

interface ActiveStatic {
  readonly params: StaticParams;
  readonly rng: Rng;
  nextAt: number;
  burst: ScreenBurst | null;
  bursts: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Glitch params with every guardrail applied (D-046). */
export function clampGlitchParams(g: GlitchParams): GlitchParams {
  const c = EFFECT_CLAMPS.static;
  return {
    tearBands: clamp(Math.round(g.tearBands), 1, c.tearBands),
    maxShift: clamp(g.maxShift, 0, c.maxShift),
    chroma: clamp(g.chroma, 0, c.chroma),
    ghost: clamp(g.ghost, 0, c.ghost),
    desync: clamp(g.desync, 0, c.desync),
    stepRate: clamp(g.stepRate, 0.5, c.stepRate),
  };
}

/** The params with every guardrail applied. */
export function clampStaticParams(p: StaticParams): StaticParams {
  const c = EFFECT_CLAMPS.static;
  const durationMax = Math.min(c.durationMax, Math.max(0.05, p.durationMax));
  const intervalMin = Math.max(c.intervalMin, p.intervalMin);
  return {
    opacity: Math.min(c.opacity, Math.max(0, p.opacity)),
    durationMin: Math.min(durationMax, Math.max(0.05, p.durationMin)),
    durationMax,
    intervalMin,
    intervalMax: Math.max(intervalMin, p.intervalMax),
    firstAfter: Math.max(c.firstAfter, p.firstAfter),
    ...(p.glitch ? { glitch: clampGlitchParams(p.glitch) } : {}),
  };
}

export class ScreenEffects implements FixedUpdateSystem {
  private now = 0;
  private readonly active = new Map<string, ActiveStatic>();
  private readonly listeners = new Set<(burst: ScreenBurst) => void>();

  get time(): number {
    return this.now;
  }

  /** Called when a burst starts. Returns the unsubscribe function. */
  onBurst(listener: (burst: ScreenBurst) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Starts STATIC for `sourceId`, drawing its schedule from `rng`. */
  startStatic(sourceId: string, params: StaticParams, rng: Rng): void {
    const p = clampStaticParams(params);
    this.active.set(sourceId, {
      params: p,
      rng,
      nextAt: this.now + p.firstAfter + rng.range(0, p.intervalMax - p.intervalMin),
      burst: null,
      bursts: 0,
    });
  }

  stop(sourceId: string): boolean {
    return this.active.delete(sourceId);
  }

  stopWithPrefix(prefix: string): number {
    let n = 0;
    for (const id of [...this.active.keys()]) {
      if (id.startsWith(prefix)) {
        this.active.delete(id);
        n++;
      }
    }
    return n;
  }

  clear(): void {
    this.active.clear();
  }

  sources(): string[] {
    return [...this.active.keys()];
  }

  /** Debug: start a burst now for `sourceId` (or the first active source). */
  force(sourceId?: string): ScreenBurst | null {
    const id = sourceId ?? this.active.keys().next().value;
    const s = id === undefined ? undefined : this.active.get(id);
    if (!s || id === undefined) {
      return null;
    }
    return this.begin(id, s);
  }

  /** The burst showing now (the strongest, if several), or null. */
  get burst(): ScreenBurst | null {
    let best: ScreenBurst | null = null;
    for (const s of this.active.values()) {
      if (s.burst && this.now < s.burst.until && (!best || s.burst.intensity > best.intensity)) {
        best = s.burst;
      }
    }
    return best;
  }

  /** Seconds until the next burst of any source (null when none is scheduled). */
  get nextIn(): number | null {
    let next: number | null = null;
    for (const s of this.active.values()) {
      next = next === null ? s.nextAt : Math.min(next, s.nextAt);
    }
    return next === null ? null : Math.max(0, next - this.now);
  }

  /** Bursts started so far per source (tests, debug). */
  count(sourceId: string): number {
    return this.active.get(sourceId)?.bursts ?? 0;
  }

  fixedUpdate(dt: number): void {
    this.now += dt;
    for (const [id, s] of this.active) {
      if (s.burst && this.now >= s.burst.until) {
        s.burst = null;
      }
      if (!s.burst && this.now >= s.nextAt - 1e-9) {
        this.begin(id, s);
      }
    }
  }

  private begin(sourceId: string, s: ActiveStatic): ScreenBurst {
    const p = s.params;
    const duration = s.rng.range(p.durationMin, p.durationMax);
    const burst: ScreenBurst = {
      sourceId,
      start: this.now,
      until: this.now + duration,
      intensity: p.opacity,
      glitch: p.glitch ?? null,
    };
    s.burst = burst;
    s.bursts++;
    s.nextAt = burst.until + s.rng.range(p.intervalMin, p.intervalMax);
    for (const listener of this.listeners) {
      listener(burst);
    }
    return burst;
  }
}
