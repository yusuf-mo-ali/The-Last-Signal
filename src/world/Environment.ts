/**
 * The environment state (D-028, D-045): a base (the normal look until signal progression sets
 * one, Phase 12) plus temporary overlays from the wave's mutation (BLACKOUT, BLOOD MOON) and, later,
 * dynamic events. Each overlay has a priority and fades in and out in simulated time, so it holds
 * still while the game is paused and is identical at any frame rate.
 *
 * `resolve()` blends everything into the channels the lighting reads: channel by channel, overlays
 * are applied in priority order (the highest last, so it wins once fully faded in). The
 * visibility floors are applied after blending, whatever the overlays say: the fill light never
 * drops below its floor, and in the dark enemy eyes always glow and close enemies are lifted.
 *
 * Simulation only: no three.js lights here; `render/LightingController` applies the channels.
 */

import type { EnvironmentOverlayId } from '../config/effects';
import {
  BASE_ENVIRONMENT,
  ENVIRONMENT_FLOORS,
  ENVIRONMENT_OVERLAYS,
  type EnvironmentChannels,
  type Rgb,
} from '../config/environment';
import type { FixedUpdateSystem } from '../core/Game';

interface Overlay {
  readonly sourceId: string;
  readonly id: EnvironmentOverlayId;
  readonly priority: number;
  readonly fadeIn: number;
  readonly fadeOut: number;
  readonly addedAt: number;
  /** Set when removal started (fading out). */
  removedAt: number | null;
  /** Weight when removal started. */
  weightAtRemoval: number;
}

export interface OverlayStatus {
  readonly sourceId: string;
  readonly overlay: EnvironmentOverlayId;
  readonly priority: number;
  readonly weight: number;
  readonly fading: 'in' | 'out' | 'none';
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

const NUMERIC_CHANNELS = [
  'ambient',
  'sun',
  'tintAmount',
  'emergency',
  'eyeGlow',
  'silhouette',
  'proximity',
  'muzzleLight',
] as const satisfies readonly (keyof EnvironmentChannels)[];

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerpRgb = (out: [number, number, number], a: Rgb, b: Rgb, t: number) => {
  out[0] = lerp(a[0], b[0], t);
  out[1] = lerp(a[1], b[1], t);
  out[2] = lerp(a[2], b[2], t);
};

export class Environment implements FixedUpdateSystem {
  private now = 0;
  private overlays: Overlay[] = [];
  private base: EnvironmentChannels = BASE_ENVIRONMENT;
  private readonly resolved: Mutable<EnvironmentChannels> & {
    tint: [number, number, number];
    fog: [number, number, number];
  } = {
    ...BASE_ENVIRONMENT,
    tint: [...BASE_ENVIRONMENT.tint],
    fog: [...BASE_ENVIRONMENT.fog],
  };

  /** Simulated seconds this environment has run (fades are measured in it). */
  get time(): number {
    return this.now;
  }

  fixedUpdate(dt: number): void {
    this.now += dt;
    // Forget overlays that have finished fading out.
    this.overlays = this.overlays.filter((o) => o.removedAt === null || this.weight(o) > 0);
  }

  /** Sets the base environment (signal progression, Phase 12). */
  setBase(channels: EnvironmentChannels): void {
    this.base = channels;
  }

  /** Adds (or restarts) the overlay owned by `sourceId`. */
  addOverlay(
    sourceId: string,
    id: EnvironmentOverlayId,
    options: { readonly priority: number; readonly fadeIn: number; readonly fadeOut: number },
  ): void {
    const existing = this.overlays.find((o) => o.sourceId === sourceId && o.id === id);
    const startWeight = existing ? this.weight(existing) : 0;
    this.overlays = this.overlays.filter((o) => !(o.sourceId === sourceId && o.id === id));
    const fadeIn = Math.max(0, options.fadeIn);
    this.overlays.push({
      sourceId,
      id,
      priority: options.priority,
      fadeIn,
      fadeOut: Math.max(0, options.fadeOut),
      // Continue from where a restarted overlay was, rather than snapping back to dark.
      addedAt: this.now - startWeight * fadeIn,
      removedAt: null,
      weightAtRemoval: 0,
    });
    this.overlays.sort((a, b) => a.priority - b.priority);
  }

  /** Starts fading out everything `sourceId` added (at once with `immediate`). */
  removeSource(sourceId: string, options: { readonly immediate?: boolean } = {}): number {
    let count = 0;
    for (const o of this.overlays) {
      if (o.sourceId !== sourceId || o.removedAt !== null) {
        continue;
      }
      count++;
      o.weightAtRemoval = this.weight(o);
      o.removedAt = this.now;
    }
    if (options.immediate) {
      this.overlays = this.overlays.filter((o) => o.sourceId !== sourceId);
    }
    return count;
  }

  /** Removes every overlay whose source starts with `prefix`. */
  removeSourcesWithPrefix(prefix: string, options: { readonly immediate?: boolean } = {}): number {
    let count = 0;
    for (const id of new Set(this.overlays.map((o) => o.sourceId))) {
      if (id.startsWith(prefix)) {
        count += this.removeSource(id, options);
      }
    }
    return count;
  }

  /** Removes every overlay at once (a new run). */
  clear(): void {
    this.overlays = [];
  }

  /** Source ids with an overlay still active or fading out. */
  sources(): string[] {
    return [...new Set(this.overlays.map((o) => o.sourceId))];
  }

  status(): OverlayStatus[] {
    return this.overlays.map((o) => ({
      sourceId: o.sourceId,
      overlay: o.id,
      priority: o.priority,
      weight: this.weight(o),
      fading:
        o.removedAt !== null ? 'out' : this.now - o.addedAt < o.fadeIn ? 'in' : ('none' as const),
    }));
  }

  /**
   * The blended channels now. The returned object is reused between calls: read it, don't keep
   * it.
   */
  resolve(): EnvironmentChannels {
    const r = this.resolved;
    const b = this.base;
    for (const key of NUMERIC_CHANNELS) {
      r[key] = b[key];
    }
    lerpRgb(r.tint, b.tint, b.tint, 0);
    lerpRgb(r.fog, b.fog, b.fog, 0);
    for (const o of this.overlays) {
      const w = this.weight(o);
      if (w <= 0) {
        continue;
      }
      const c = ENVIRONMENT_OVERLAYS[o.id];
      for (const key of NUMERIC_CHANNELS) {
        const v = c[key];
        if (v !== undefined) {
          r[key] = lerp(r[key], v, w);
        }
      }
      if (c.tint) {
        lerpRgb(r.tint, r.tint, c.tint, w);
      }
      if (c.fog) {
        lerpRgb(r.fog, r.fog, c.fog, w);
      }
    }
    // Visibility guardrails (D-045), whatever the overlays asked for.
    const f = ENVIRONMENT_FLOORS;
    r.ambient = Math.max(f.ambientFloor, r.ambient);
    if (r.ambient < f.darkBelow) {
      // The darker it is, the more the floor applies (full floor at the ambient floor).
      const dark = (f.darkBelow - r.ambient) / (f.darkBelow - f.ambientFloor);
      const scale = Math.min(1, dark);
      r.eyeGlow = Math.max(r.eyeGlow, f.eyeGlowInDark * scale);
      r.proximity = Math.max(r.proximity, f.proximityInDark * scale);
    }
    return r;
  }

  private weight(o: Overlay): number {
    if (o.removedAt !== null) {
      if (o.fadeOut <= 0) {
        return 0;
      }
      return Math.max(0, o.weightAtRemoval * (1 - (this.now - o.removedAt) / o.fadeOut));
    }
    if (o.fadeIn <= 0) {
      return 1;
    }
    return Math.min(1, Math.max(0, (this.now - o.addedAt) / o.fadeIn));
  }
}
