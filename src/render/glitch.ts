/**
 * Signal Glitch maths (D-046), pure and testable: which glitch a frame shows for the current STATIC
 * burst. `GlitchPass` draws it; `EnemyView` lags enemies by it.
 *
 * - Strength follows the burst's envelope (the same rise and fade as the grain layer).
 * - The tear pattern changes in steps: at most `stepRate` (≤ 3) times a second, so nothing flickers
 *   faster than the photosensitivity guideline allows. With reduced motion, one still pattern
 *   per burst, no tears, no afterimage: only a slight colour split.
 * - Bands come from a seeded stream per burst and step: the same burst looks the same every time.
 */

import type { GlitchParams } from '../config/effects';
import { burstEnvelope, type ScreenBurst } from '../modifiers/ScreenEffects';
import { Rng } from '../utils/Rng';

/** The clear centre around the crosshair (fractions of the smaller screen side, like `vmin`). */
export const GLITCH_CLEAR = { inner: 0.1, outer: 0.22 } as const;

export interface TearBand {
  /** Where the band sits, 0 (bottom) – 1 (top) of the screen. */
  readonly center: number;
  /** Half its height, as a fraction of the screen height. */
  readonly halfHeight: number;
  /** Its sideways shift, −1 – 1 of `maxShift`. */
  readonly shift: number;
}

export interface GlitchFrame {
  readonly active: boolean;
  /** 0–1: how strong the glitch is now. */
  readonly envelope: number;
  /** Which tear pattern shows (changes at most `stepRate` times a second). */
  readonly step: number;
  /** When the burst started (identifies it). */
  readonly burstStart: number;
  readonly params: GlitchParams;
  readonly bands: readonly TearBand[];
  readonly reducedMotion: boolean;
}

const NO_PARAMS: GlitchParams = {
  tearBands: 0,
  maxShift: 0,
  chroma: 0,
  ghost: 0,
  desync: 0,
  stepRate: 1,
};

export const IDLE_GLITCH: GlitchFrame = {
  active: false,
  envelope: 0,
  step: 0,
  burstStart: 0,
  params: NO_PARAMS,
  bands: [],
  reducedMotion: false,
};

/** The tear bands of one step of one burst (seeded: the same inputs give the same bands). */
export function tearBands(burstStart: number, step: number, count: number): TearBand[] {
  const rng = new Rng(`glitch:${burstStart.toFixed(4)}:${step}`);
  const bands: TearBand[] = [];
  for (let i = 0; i < count; i++) {
    bands.push({
      center: rng.range(0.05, 0.95),
      halfHeight: rng.range(0.015, 0.06),
      shift: rng.range(-1, 1),
    });
  }
  return bands;
}

let cachedKey = '';
let cachedBands: readonly TearBand[] = [];

/**
 * The glitch for `burst` at sim time `now` (`IDLE_GLITCH` when there is none, or it carries no
 * glitch params).
 */
export function glitchFrame(
  burst: ScreenBurst | null,
  now: number,
  reducedMotion = false,
): GlitchFrame {
  const params = burst?.glitch;
  const envelope = burstEnvelope(burst, now);
  if (!burst || !params || envelope <= 0) {
    return IDLE_GLITCH;
  }
  const step = reducedMotion ? 0 : Math.floor((now - burst.start) * params.stepRate);
  const count = reducedMotion ? 0 : params.tearBands;
  const key = `${burst.start}:${step}:${count}`;
  if (key !== cachedKey) {
    cachedKey = key;
    cachedBands = tearBands(burst.start, step, count);
  }
  return {
    active: true,
    envelope,
    step,
    burstStart: burst.start,
    params: reducedMotion ? { ...params, maxShift: 0, ghost: 0, desync: 0 } : params,
    bands: cachedBands,
    reducedMotion,
  };
}

/**
 * How much of the glitch reaches a pixel `distance` px from the screen centre, on a screen whose
 * smaller side is `minSide` px: none in the clear centre, all of it beyond `GLITCH_CLEAR.outer`.
 * (The shader computes the same.)
 */
export function glitchMask(distance: number, minSide: number): number {
  const inner = GLITCH_CLEAR.inner * minSide;
  const outer = GLITCH_CLEAR.outer * minSide;
  const t = Math.min(1, Math.max(0, (distance - inner) / (outer - inner)));
  return t * t * (3 - 2 * t);
}
