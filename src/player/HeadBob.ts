/**
 * Subtle view bob while walking (plan §8, GAME_DESIGN §4.2). Presentation-only feel: it offsets
 * the camera, never the collision capsule or aim logic. Pure math, updated once per render frame.
 *
 * The bob follows distance travelled, not time, so its rhythm matches the footfall at any speed.
 * Its strength eases in and out, so it is zero while standing still, airborne or disabled.
 */

export interface HeadBobConfig {
  /** Peak vertical offset at walking speed, metres. */
  readonly verticalAmplitude: number;
  /** Peak sideways sway at walking speed, metres. */
  readonly lateralAmplitude: number;
  /** Metres per full left-right cycle (two footfalls). */
  readonly strideLength: number;
  /** Strength cap as a multiple of the walking-speed amplitude (sprinting bobs a little more). */
  readonly maxIntensity: number;
  /** How quickly the strength eases toward its target, per second. */
  readonly response: number;
}

export interface HeadBobOffset {
  /** Metres up. */
  vertical: number;
  /** Metres to the right of the view direction. */
  lateral: number;
}

/** Below this horizontal speed (m/s) the player counts as standing still. */
const STILL_SPEED = 0.2;

export class HeadBob {
  enabled = true;
  /** Cycle phase in radians; advances with distance travelled. */
  phase = 0;
  /** Current strength, 0 (none) to `maxIntensity`. */
  intensity = 0;
  readonly offset: HeadBobOffset = { vertical: 0, lateral: 0 };
  private readonly config: HeadBobConfig;

  constructor(config: HeadBobConfig) {
    this.config = config;
  }

  /**
   * Advances the bob by one render frame.
   * @param speed horizontal speed, m/s
   * @param referenceSpeed speed that gives intensity 1 (walking speed)
   * @param grounded whether the feet are on the ground
   */
  update(dt: number, speed: number, referenceSpeed: number, grounded: boolean): HeadBobOffset {
    const { config } = this;
    if (!this.enabled) {
      this.reset();
      return this.offset;
    }
    const moving = grounded && speed > STILL_SPEED;
    const target = moving ? Math.min(speed / referenceSpeed, config.maxIntensity) : 0;
    const blend = 1 - Math.exp(-config.response * Math.max(0, dt));
    this.intensity += (target - this.intensity) * blend;
    if (moving) {
      this.phase =
        (this.phase + ((speed * dt) / config.strideLength) * Math.PI * 2) % (Math.PI * 2);
    }
    // Two vertical dips per cycle (one per footfall), one sideways sway.
    this.offset.vertical = Math.sin(this.phase * 2) * config.verticalAmplitude * this.intensity;
    this.offset.lateral = Math.sin(this.phase) * config.lateralAmplitude * this.intensity;
    return this.offset;
  }

  reset(): void {
    this.phase = 0;
    this.intensity = 0;
    this.offset.vertical = 0;
    this.offset.lateral = 0;
  }
}
