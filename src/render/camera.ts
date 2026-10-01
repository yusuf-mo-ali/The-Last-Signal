/**
 * Camera foundation. The renderer keeps the camera's aspect ratio in sync with the viewport;
 * `player/CameraController` drives its position, orientation, bob and FOV each frame.
 */

import { PerspectiveCamera } from 'three';
import { ENGINE_CONFIG } from '../core/Config';

/** Overrides for the camera defaults (`ENGINE_CONFIG.view.fov`, `ENGINE_CONFIG.camera`). */
export interface CameraOptions {
  /** Vertical field of view in degrees. */
  readonly fov?: number;
  readonly near?: number;
  readonly far?: number;
}

export function createCamera(options: CameraOptions = {}): PerspectiveCamera {
  return new PerspectiveCamera(
    options.fov ?? ENGINE_CONFIG.view.fov,
    1, // aspect: set by the Renderer from the real viewport before the first frame
    options.near ?? ENGINE_CONFIG.camera.near,
    options.far ?? ENGINE_CONFIG.camera.far,
  );
}
