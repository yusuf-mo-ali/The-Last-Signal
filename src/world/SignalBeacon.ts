/**
 * The signal beacon on top of the tower: turns at a constant rate. Placeholder for the signal
 * objective (plan §20), kept from the Phase 0 test scene as a visible check of the fixed-step
 * pipeline: the angle only changes inside `fixedUpdate`, and `WorldView` interpolates between
 * the previous and current step with the frame's `alpha`. Headless and browser-independent.
 */

import type { FixedUpdateSystem } from '../core/Game';

/** Radians per second. */
export const BEACON_ANGULAR_SPEED = Math.PI / 2;

export class SignalBeacon implements FixedUpdateSystem {
  /** Beacon angle after the latest fixed step, in radians. Grows without wrapping. */
  angle = 0;
  /** Beacon angle before the latest fixed step, for interpolation. */
  previousAngle = 0;
  /** Fixed steps simulated so far. */
  steps = 0;

  fixedUpdate(fixedDt: number): void {
    this.previousAngle = this.angle;
    this.angle += BEACON_ANGULAR_SPEED * fixedDt;
    this.steps++;
  }

  /** The beacon angle at a point `alpha` in [0, 1) between the previous and current step. */
  interpolatedAngle(alpha: number): number {
    return this.previousAngle + (this.angle - this.previousAngle) * alpha;
  }
}
