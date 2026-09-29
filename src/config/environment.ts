/**
 * Environment channels and overlays (D-028, D-045). The simulation resolves the base environment
 * plus the active overlays (highest priority wins per channel, blended by each overlay's fade) into
 * these channels; the lighting controller turns them into light intensities and colours. Lights
 * are never added or removed at run time (D-022), so no channel can cause a shader recompile.
 *
 * Every channel is a plain number or an RGB triple (0–1), so blending is a lerp.
 */

import type { EnvironmentOverlayId } from './effects';

export type Rgb = readonly [number, number, number];

export interface EnvironmentChannels {
  /** Multiplier on the hemisphere (fill) light. */
  readonly ambient: number;
  /** Multiplier on the sun. */
  readonly sun: number;
  /** Colour the lights are tinted toward, and how far (0 = untinted). */
  readonly tint: Rgb;
  readonly tintAmount: number;
  /** Fog and sky colour. */
  readonly fog: Rgb;
  /** Emergency fixtures: 0 = off (normal), 1 = full red emergency lighting. */
  readonly emergency: number;
  /** Baseline glow of enemy bodies in their eye colour (readable silhouettes in the dark). */
  readonly eyeshine: number;
  /** How strongly the muzzle flash lights its surroundings (0 = the unlit flash only). */
  readonly muzzleLight: number;
}

/** The normal look (the Phase 1–6 lighting, unchanged). */
export const BASE_ENVIRONMENT: EnvironmentChannels = {
  ambient: 1,
  sun: 1,
  tint: [1, 1, 1],
  tintAmount: 0,
  fog: [11 / 255, 14 / 255, 18 / 255], // 0x0b0e12, the Phase 1 background
  emergency: 0,
  eyeshine: 0,
  muzzleLight: 0,
};

/** Overlays: only the channels they set change. Pass-1 values; BALANCING §2.15. */
export const ENVIRONMENT_OVERLAYS: Readonly<
  Record<EnvironmentOverlayId, Partial<EnvironmentChannels>>
> = {
  // Lights fail: a cold, dark facility lit by red emergency fixtures and gunfire. Fog distances
  // are untouched; enemies keep a faint glow so a silhouette always reads.
  blackout: {
    ambient: 0.3,
    sun: 0.12,
    tint: [0.55, 0.62, 0.85],
    tintAmount: 0.5,
    fog: [0.015, 0.018, 0.028],
    emergency: 1,
    eyeshine: 0.14,
    muzzleLight: 1,
  },
  // A red sky: tint only, no visibility loss.
  bloodMoon: {
    ambient: 0.9,
    sun: 0.85,
    tint: [1, 0.36, 0.3],
    tintAmount: 0.45,
    fog: [0.16, 0.03, 0.03],
  },
};

/**
 * Visibility guardrails (D-045): whatever overlays are active, the fill light never drops below
 * `ambientFloor`, and whenever it is below `darkBelow` enemies glow at least `eyeshineInDark`.
 */
export const ENVIRONMENT_FLOORS = {
  ambientFloor: 0.25,
  darkBelow: 0.6,
  eyeshineInDark: 0.1,
} as const;

/** How the lighting controller renders the channels (presentation values). */
export const LIGHTING = {
  /** Emergency fixtures at `emergency = 1`: colour, intensity and reach. */
  emergency: { color: 0xff3322, intensity: 14, distance: 13, decay: 1.6 },
  /** The fixture lamp's own glow (a small emissive box) at full emergency. */
  emergencyLampGlow: 2.2,
  /** Muzzle light at `muzzleLight = 1`, while the flash shows. */
  muzzle: { color: 0xffc27a, intensity: 9, distance: 14, decay: 1.5 },
} as const;
