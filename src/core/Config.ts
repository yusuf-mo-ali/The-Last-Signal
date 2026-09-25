/**
 * Engine and application configuration (D-010, D-035): the single source of every engine default.
 * Loop, render, camera, input-hardening and debug values live here and nowhere else; systems take
 * them as constructor defaults so tests can still override them.
 *
 * Gameplay content and balance values do NOT belong here: they live in `src/config/` (plan §31).
 * This module is simulation-layer code: plain data, no browser APIs.
 */

export interface LoopConfig {
  /** Simulation step in seconds (D-004). */
  readonly fixedDt: number;
  /** Largest frame time accepted, in seconds; longer frames are clamped (tab switches, hitches). */
  readonly maxFrameDt: number;
  /** Most fixed steps per frame; any further backlog is dropped. */
  readonly maxStepsPerFrame: number;
}

export interface RenderConfig {
  /** Cap on the device pixel ratio (ARCHITECTURE.md §8). */
  readonly maxPixelRatio: number;
  /** Resolution multiplier (1 = native). */
  readonly renderScale: number;
  /** MSAA on the default framebuffer. */
  readonly antialias: boolean;
  /** Shadow map on (at most 2 shadow casters, D-022). */
  readonly shadows: boolean;
  /** After a WebGL context loss, how long to wait for the browser to restore it before offering a reload. */
  readonly contextRestoreTimeoutMs: number;
}

export interface CameraConfig {
  /** Vertical field of view in degrees (60° ≈ 90° horizontal at 16:9). */
  readonly fov: number;
  /** Near plane in metres. */
  readonly near: number;
  /** Far plane in metres. */
  readonly far: number;
}

export interface InputConfig {
  /** Mouse-move events larger than this (CSS px, either axis) are dropped as glitches (D-017). */
  readonly maxMotionPerEvent: number;
  /** How long the event-only pointer-lock API may take to answer, in ms. */
  readonly pointerLockTimeoutMs: number;
}

export interface DebugConfig {
  /** Frames kept by the frame-time recorder. */
  readonly frameSampleSize: number;
  /** How often the overlay text is refreshed, in ms. */
  readonly overlayRefreshMs: number;
  /** Physical key that toggles the overlay in development builds. */
  readonly overlayToggleKey: string;
}

export interface ErrorConfig {
  /** Error reports kept in memory for the error screen and debug tools. */
  readonly maxReports: number;
  /** Longest error message shown to the player. */
  readonly maxMessageLength: number;
}

export interface EngineConfig {
  readonly loop: LoopConfig;
  readonly render: RenderConfig;
  readonly camera: CameraConfig;
  readonly input: InputConfig;
  readonly debug: DebugConfig;
  readonly errors: ErrorConfig;
}

export const ENGINE_CONFIG: EngineConfig = deepFreeze({
  loop: {
    fixedDt: 1 / 60,
    maxFrameDt: 0.25,
    maxStepsPerFrame: 5,
  },
  render: {
    maxPixelRatio: 2,
    renderScale: 1,
    antialias: true,
    shadows: true,
    contextRestoreTimeoutMs: 10_000,
  },
  camera: {
    fov: 60,
    near: 0.05,
    far: 500,
  },
  input: {
    maxMotionPerEvent: 1500,
    pointerLockTimeoutMs: 1000,
  },
  debug: {
    frameSampleSize: 120,
    overlayRefreshMs: 250,
    overlayToggleKey: 'Backquote',
  },
  errors: {
    maxReports: 20,
    maxMessageLength: 300,
  },
} satisfies EngineConfig);

/** Freezes an object and everything reachable from it, so shared config cannot be mutated. */
export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
  }
  return value;
}
