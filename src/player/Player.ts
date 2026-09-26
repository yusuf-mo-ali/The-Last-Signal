/**
 * The player as a fixed-step system: reads the movement intent and advances the body, only while
 * a run is being played (plan §8, D-038). Owns the three player parts:
 * - `motor`: the collision capsule and movement (simulation),
 * - `look`: yaw and pitch, turned by the mouse every render frame,
 * - `controller`: actions → intent.
 *
 * The camera is not here: `CameraController` (presentation) follows the player, so the simulation
 * never depends on how, or whether, it is drawn.
 */

import { Vector3 } from 'three';
import { ENGINE_CONFIG } from '../core/Config';
import type { FixedUpdateSystem } from '../core/Game';
import { PLAYER_MOVEMENT, type PlayerMovementConfig } from '../config/player';
import type { CollisionWorld } from '../physics/CollisionWorld';
import type { LevelDefinition } from '../world/levels/types';
import { PlayerMotor, type MoveIntent } from './PlayerMotor';
import { PlayerLook, type LookSettings } from './PlayerLook';

export interface PlayerOptions {
  readonly world: CollisionWorld;
  readonly level: LevelDefinition;
  /** Where the intent comes from each step (a `PlayerController` in the game). */
  readonly intent: () => MoveIntent;
  /** Whether the player simulates this step (true while a run is being played). */
  readonly active: () => boolean;
  readonly movement?: PlayerMovementConfig;
  readonly look?: LookSettings;
}

export class Player implements FixedUpdateSystem {
  readonly motor: PlayerMotor;
  readonly look: PlayerLook;
  private readonly spawnYaw: number;
  private readonly intent: () => MoveIntent;
  private readonly active: () => boolean;

  constructor(options: PlayerOptions) {
    const [x, y, z] = options.level.spawn.position;
    this.motor = new PlayerMotor(options.world, options.movement ?? PLAYER_MOVEMENT, {
      position: new Vector3(x, y, z),
      killPlaneY: options.level.killPlaneY,
    });
    this.look = new PlayerLook(
      options.look ?? {
        radiansPerPixel: ENGINE_CONFIG.camera.radiansPerPixel,
        pitchLimitDeg: ENGINE_CONFIG.camera.pitchLimitDeg,
        sensitivity: ENGINE_CONFIG.view.sensitivity,
        invertY: ENGINE_CONFIG.view.invertY,
      },
    );
    this.spawnYaw = options.level.spawn.yaw;
    this.look.setAngles(this.spawnYaw, 0);
    this.intent = options.intent;
    this.active = options.active;
  }

  /** Back to the spawn point, facing the spawn direction (start of a run). */
  respawn(): void {
    this.motor.reset();
    this.look.setAngles(this.spawnYaw, 0);
    this.look.resetRecoil();
  }

  fixedUpdate(fixedDt: number): void {
    if (this.active()) {
      this.motor.step(this.intent(), this.look.yaw, fixedDt);
    } else {
      this.motor.hold();
    }
  }
}
