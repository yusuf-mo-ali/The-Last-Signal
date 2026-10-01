/**
 * An enemy's body is the same kinematic capsule as the player's (`PlayerMotor`, D-006, D-042):
 * wall collision and sliding, ground snapping on stairs and ramps, gravity, a kill-plane safety
 * net. This maps an archetype to the motor's movement settings; enemies never crouch, sprint or
 * jump, so those settings are neutral.
 */

import type { EnemyArchetypeConfig } from '../config/enemies';
import { PLAYER_MOVEMENT, type PlayerMovementConfig } from '../config/player';

export function enemyMovementConfig(config: EnemyArchetypeConfig): PlayerMovementConfig {
  const { body } = config;
  return {
    ...PLAYER_MOVEMENT,
    radius: body.radius,
    standHeight: body.height,
    crouchHeight: body.height,
    standEyeHeight: body.eyeHeight,
    crouchEyeHeight: body.eyeHeight,
    walkSpeed: config.moveSpeed,
    sprintMultiplier: 1,
    crouchMultiplier: 1,
    groundAcceleration: config.acceleration,
    groundDeceleration: config.acceleration * 1.5,
    airAcceleration: 0,
    jumpHeight: 0,
  };
}
