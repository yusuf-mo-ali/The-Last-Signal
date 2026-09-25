/**
 * Player movement tuning (plan §8, GAME_DESIGN §4.2). Gameplay data only: changing a value here
 * never requires editing movement code (plan §31). Values are Pass-1 starting points for feel;
 * tuning changes are logged in BALANCING.md.
 *
 * Units: metres, seconds, metres/second, metres/second².
 */

export interface PlayerMovementConfig {
  /** Collision capsule radius. */
  readonly radius: number;
  /** Capsule height standing / crouched, feet to top of head. */
  readonly standHeight: number;
  readonly crouchHeight: number;
  /** Eye height above the feet, standing / crouched. */
  readonly standEyeHeight: number;
  readonly crouchEyeHeight: number;
  /** How fast the eye moves between standing and crouched heights (per second, exponential). */
  readonly eyeHeightResponse: number;

  /** Top speed walking; sprint and crouch are multipliers of it. */
  readonly walkSpeed: number;
  readonly sprintMultiplier: number;
  readonly crouchMultiplier: number;
  /** Acceleration toward the wished velocity on the ground, and braking when there is no input. */
  readonly groundAcceleration: number;
  readonly groundDeceleration: number;
  /** Acceleration toward the wished velocity in the air (limited air control, momentum kept). */
  readonly airAcceleration: number;

  readonly gravity: number;
  /** Peak jump height of the feet; the jump speed is derived from it and `gravity`. */
  readonly jumpHeight: number;
  /** A jump pressed this long after walking off an edge still counts (forgiveness). */
  readonly coyoteTime: number;
  /** A jump pressed this long before landing triggers on landing (forgiveness). */
  readonly jumpBufferTime: number;
  readonly maxFallSpeed: number;

  /** Surfaces whose normal has at least this upward component are walkable ground (~49°). */
  readonly walkableNormalY: number;
  /** While grounded, stick to ground that drops by up to this much per step (ramps, stairs). */
  readonly groundSnapDistance: number;
}

export const PLAYER_MOVEMENT: PlayerMovementConfig = {
  radius: 0.35,
  standHeight: 1.8,
  crouchHeight: 1.1,
  standEyeHeight: 1.62,
  crouchEyeHeight: 0.95,
  eyeHeightResponse: 14,

  walkSpeed: 5,
  sprintMultiplier: 1.5,
  crouchMultiplier: 0.5,
  groundAcceleration: 50,
  groundDeceleration: 40,
  airAcceleration: 12,

  gravity: 22,
  jumpHeight: 1.15,
  coyoteTime: 0.1,
  jumpBufferTime: 0.12,
  maxFallSpeed: 40,

  walkableNormalY: 0.65,
  groundSnapDistance: 0.35,
};

/** Launch speed that reaches `jumpHeight` under `gravity`. */
export function jumpSpeed(config: PlayerMovementConfig): number {
  return Math.sqrt(2 * config.gravity * config.jumpHeight);
}
