/**
 * Simulation half of the Phase 0 test scene: a signal beacon that turns at a constant rate.
 *
 * It exists to prove the fixed-step pipeline end to end. The angle only changes inside
 * `fixedUpdate`, and the view (`TestSceneView`) interpolates between the previous and current
 * step with the frame's `alpha`. Headless and browser-independent; replaced by the real World
 * in Phase 1.
 */

import type { FixedUpdateSystem } from '../core/Game';

/** Radians per second. */
export const BEACON_ANGULAR_SPEED = Math.PI / 2;

export class TestScene implements FixedUpdateSystem {
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
