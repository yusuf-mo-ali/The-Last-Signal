/**
 * The player's view direction: yaw and pitch, driven by mouse motion (plan §8, D-038).
 *
 * Updated every render frame (not every fixed step), so aiming never waits for the simulation
 * tick. The fixed step reads `yaw` for the movement direction. Pure math: no browser, no three.js.
 *
 * Conventions: yaw 0 faces north (−z) and grows to the left (counter-clockwise seen from above),
 * matching three.js `rotation.y`. Pitch 0 is level, positive looks up.
 *
 * Recoil (D-040) is applied here too, so aim and camera always agree: a shot kicks the view up
 * (and a little sideways), and only that upward kick settles back over time. Aim the player adds
 * is never undone; pulling the mouse down against the kick counts as recovering it.
 */

const TAU = Math.PI * 2;

export interface LookSettings {
  /** Radians of rotation per pixel of mouse motion at sensitivity 1. */
  readonly radiansPerPixel: number;
  /** Player multiplier on `radiansPerPixel`. */
  readonly sensitivity: number;
  readonly invertY: boolean;
  /** Maximum up/down angle, in degrees (just under 90 to avoid the pole flip). */
  readonly pitchLimitDeg: number;
}

export class PlayerLook {
  /** Radians, wrapped to [-π, π). */
  yaw = 0;
  /** Radians, clamped to ±pitchLimit. */
  pitch = 0;
  /** Upward recoil kick not yet recovered, radians (≥ 0). */
  recoilPitch = 0;
  private settings: LookSettings;

  constructor(settings: LookSettings) {
    this.settings = validateLookSettings(settings);
  }

  get pitchLimit(): number {
    return (this.settings.pitchLimitDeg * Math.PI) / 180;
  }

  setSettings(settings: LookSettings): void {
    this.settings = validateLookSettings(settings);
    this.pitch = clamp(this.pitch, -this.pitchLimit, this.pitchLimit);
  }

  getSettings(): LookSettings {
    return this.settings;
  }

  /** Turns the view by a mouse motion in pixels (+x right, +y down, as the browser reports). */
  applyMouseDelta(dx: number, dy: number): void {
    const scale = this.settings.radiansPerPixel * this.settings.sensitivity;
    const vertical = this.settings.invertY ? dy : -dy;
    const before = this.pitch;
    this.setAngles(this.yaw - dx * scale, this.pitch + vertical * scale);
    const change = this.pitch - before;
    if (change < 0) {
      // The player pulled down against the kick: that much no longer needs recovering.
      this.recoilPitch = Math.max(0, this.recoilPitch + change);
    }
  }

  /** Kicks the view by a shot's recoil, in radians (+pitch up, +yaw left). */
  addRecoil(pitch: number, yaw: number): void {
    const before = this.pitch;
    this.setAngles(this.yaw + yaw, this.pitch + pitch);
    this.recoilPitch += Math.max(0, this.pitch - before); // only what the pitch clamp allowed
  }

  /** Settles up to `maxRadians` of outstanding upward kick back down. */
  recoverRecoil(maxRadians: number): void {
    const amount = Math.min(this.recoilPitch, Math.max(0, maxRadians));
    if (amount > 0) {
      this.recoilPitch -= amount;
      this.setAngles(this.yaw, this.pitch - amount);
    }
  }

  /** Forgets outstanding recoil (spawn, teleport). */
  resetRecoil(): void {
    this.recoilPitch = 0;
  }

  /** Sets the view directly (spawn, teleport); wraps yaw and clamps pitch. */
  setAngles(yaw: number, pitch = this.pitch): void {
    this.yaw = wrapAngle(yaw);
    this.pitch = clamp(pitch, -this.pitchLimit, this.pitchLimit);
  }
}

/** Wraps an angle to [-π, π). */
export function wrapAngle(angle: number): number {
  return ((((angle + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function validateLookSettings(settings: LookSettings): LookSettings {
  if (!(settings.radiansPerPixel > 0) || !(settings.sensitivity > 0)) {
    throw new RangeError('Look sensitivity must be positive');
  }
  if (!(settings.pitchLimitDeg > 0 && settings.pitchLimitDeg < 90)) {
    throw new RangeError('pitchLimitDeg must be in (0, 90)');
  }
  return settings;
}
