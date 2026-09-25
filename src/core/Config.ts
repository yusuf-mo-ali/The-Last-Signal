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
  /** After a WebGL context loss, how long to wait for the browser to restore it before offering a reload. */
  readonly contextRestoreTimeoutMs: number;
}

/**
 * GPU-heavy rendering parameters for one quality preset (D-037, ARCHITECTURE §7.18). Rendering code
 * reads these from the active profile, never from constants. Phase 1 defines only the values it
 * renders; later phases add lighting, particle, post-processing and texture fields.
 */
export interface GraphicsQualityProfile {
  /** Resolution multiplier (1 = native). Applied live. */
  readonly renderScale: number;
  /** Cap on the device pixel ratio. Applied live. */
  readonly maxPixelRatio: number;
  /** MSAA on the default framebuffer. Needs a new WebGL context (applied at load). */
  readonly antialias: boolean;
  /** Real-time shadows. Applied at load (shader programs change). */
  readonly shadows: {
    readonly enabled: boolean;
    /** Shadow map resolution per caster, in texels. */
    readonly mapSize: number;
    /** Most shadow-casting lights (D-022 budget, per preset). */
    readonly maxCasters: number;
  };
}

export const GRAPHICS_PRESET_IDS = ['low', 'medium', 'high', 'ultra'] as const;
export type GraphicsPresetId = (typeof GRAPHICS_PRESET_IDS)[number];

export interface GraphicsConfig {
  /** Preset used when nothing else selects one (the settings system arrives later). */
  readonly defaultPreset: GraphicsPresetId;
  readonly presets: Readonly<Record<GraphicsPresetId, GraphicsQualityProfile>>;
}

export interface CameraConfig {
  /** Near plane in metres; small so a weapon view model can sit close to the eye later. */
  readonly near: number;
  /** Far plane in metres. */
  readonly far: number;
  /** Camera turn per CSS pixel of mouse motion at sensitivity 1, in radians. */
  readonly radiansPerPixel: number;
  /** Largest look angle above or below the horizon, in degrees (just short of vertical). */
  readonly pitchLimitDeg: number;
  /** Subtle view bob while moving on the ground (cosmetic, presentation only). */
  readonly headBob: {
    /** Vertical bob at walking speed, in metres (one bump per step). */
    readonly verticalAmplitude: number;
    /** Side-to-side sway at walking speed, in metres (one cycle per two steps). */
    readonly lateralAmplitude: number;
    /** Distance covered by one full cycle (two steps), in metres. */
    readonly strideLength: number;
    /** Largest amplitude multiplier (reached when sprinting). */
    readonly maxIntensity: number;
    /** How quickly the bob fades in and out, per second. */
    readonly response: number;
  };
}

/** Player-adjustable view settings and their defaults (persisted by the settings system later). */
export interface ViewSettings {
  /** Vertical field of view in degrees (60° ≈ 90° horizontal at 16:9). */
  readonly fov: number;
  /** Mouse sensitivity multiplier (1 = `camera.radiansPerPixel`). */
  readonly sensitivity: number;
  readonly invertY: boolean;
  readonly headBob: boolean;
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
  readonly graphics: GraphicsConfig;
  readonly camera: CameraConfig;
  readonly view: ViewSettings;
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
    contextRestoreTimeoutMs: 10_000,
  },
  graphics: {
    // Starting points from D-037, to be set by measurement on the reference machines.
    defaultPreset: 'high',
    presets: {
      low: {
        renderScale: 1,
        maxPixelRatio: 1,
        antialias: false,
        shadows: { enabled: true, mapSize: 1024, maxCasters: 1 },
      },
      medium: {
        renderScale: 1,
        maxPixelRatio: 1,
        antialias: true,
        shadows: { enabled: true, mapSize: 2048, maxCasters: 1 },
      },
      high: {
        renderScale: 1,
        maxPixelRatio: 1.5,
        antialias: true,
        shadows: { enabled: true, mapSize: 2048, maxCasters: 2 },
      },
      ultra: {
        renderScale: 1,
        maxPixelRatio: 2,
        antialias: true,
        shadows: { enabled: true, mapSize: 4096, maxCasters: 2 },
      },
    },
  },
  camera: {
    near: 0.05,
    far: 500,
    radiansPerPixel: 0.0022,
    pitchLimitDeg: 89,
    headBob: {
      verticalAmplitude: 0.03,
      lateralAmplitude: 0.015,
      strideLength: 4,
      maxIntensity: 1.4,
      response: 10,
    },
  },
  view: {
    fov: 60,
    sensitivity: 1,
    invertY: false,
    headBob: true,
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

/** Parses a preset id (e.g. from `?quality=`); anything unrecognised returns `null`. */
export function parseGraphicsPreset(value: string | null | undefined): GraphicsPresetId | null {
  const id = value?.trim().toLowerCase();
  return (GRAPHICS_PRESET_IDS as readonly string[]).includes(id ?? '')
    ? (id as GraphicsPresetId)
    : null;
}
