/**
 * Camera foundation. The renderer keeps the camera's aspect ratio in sync with the viewport;
 * the future `player/CameraController` will drive position, orientation, bob and FOV.
 */

import { PerspectiveCamera } from 'three';
import { ENGINE_CONFIG, type CameraConfig } from '../core/Config';

/** Overrides for `ENGINE_CONFIG.camera` (defaults documented there). */
export type CameraOptions = Partial<CameraConfig>;

export function createCamera(options: CameraOptions = {}): PerspectiveCamera {
  return new PerspectiveCamera(
    options.fov ?? ENGINE_CONFIG.camera.fov,
    1, // aspect: set by the Renderer from the real viewport before the first frame
    options.near ?? ENGINE_CONFIG.camera.near,
    options.far ?? ENGINE_CONFIG.camera.far,
  );
}
