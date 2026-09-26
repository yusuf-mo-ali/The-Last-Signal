/**
 * First-person camera (presentation, D-003, D-038). Follows the player without the player knowing
 * about it: each render frame it places the camera at the interpolated eye position, adds the
 * head bob, and turns it to the current look angles.
 *
 * - Position is interpolated between the last two fixed steps with the frame's `alpha`, so motion
 *   is smooth at any refresh rate.
 * - Orientation is *not* interpolated: `PlayerLook` is updated every frame from the mouse, so the
 *   view responds with no simulation-tick delay.
 */

import type { PerspectiveCamera } from 'three';
import type { ViewSettings } from '../core/Config';
import { ENGINE_CONFIG } from '../core/Config';
import { HeadBob } from './HeadBob';
import type { Player } from './Player';

export class CameraController {
  readonly camera: PerspectiveCamera;
  readonly bob = new HeadBob(ENGINE_CONFIG.camera.headBob);
  private readonly player: Player;
  private settings: ViewSettings;

  constructor(camera: PerspectiveCamera, player: Player, settings: ViewSettings) {
    this.camera = camera;
    this.player = player;
    this.camera.rotation.order = 'YXZ'; // yaw, then pitch: no roll creeps in
    this.settings = settings;
    this.applySettings(settings);
  }

  getSettings(): ViewSettings {
    return this.settings;
  }

  /** Applies FOV and head-bob settings. (Sensitivity and invert-Y belong to `PlayerLook`.) */
  applySettings(settings: ViewSettings): void {
    this.settings = settings;
    this.bob.enabled = settings.headBob;
    if (this.camera.fov !== settings.fov) {
      this.camera.fov = settings.fov;
      this.camera.updateProjectionMatrix();
    }
  }

  /**
   * @param alpha interpolation factor from the fixed-step clock
   * @param dt simulated seconds this frame (0 while paused, so the bob holds still)
   */
  update(alpha: number, dt: number): void {
    const { motor, look } = this.player;
    const { camera } = this;
    const bob = this.bob.update(dt, motor.horizontalSpeed, motor.config.walkSpeed, motor.grounded);
    const prev = motor.previousPosition;
    const curr = motor.position;
    const eye = motor.previousEyeHeight + (motor.eyeHeight - motor.previousEyeHeight) * alpha;
    const yaw = look.yaw;
    // Right of the view direction: (cos yaw, 0, -sin yaw).
    camera.position.set(
      prev.x + (curr.x - prev.x) * alpha + Math.cos(yaw) * bob.lateral,
      prev.y + (curr.y - prev.y) * alpha + eye + bob.vertical,
      prev.z + (curr.z - prev.z) * alpha - Math.sin(yaw) * bob.lateral,
    );
    camera.rotation.set(look.pitch, yaw, 0);
  }
}
