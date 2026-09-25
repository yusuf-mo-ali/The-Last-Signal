/**
 * Camera foundation. The renderer keeps the camera's aspect ratio in sync with the viewport;
 * the future `player/CameraController` will drive position, orientation, bob and FOV.
 */

import { PerspectiveCamera } from 'three';

export interface CameraOptions {
  /** Vertical field of view in degrees. 60° is about 90° horizontal at 16:9. */
  readonly fov?: number;
  /** Near plane in metres; small so a weapon view model can sit close to the eye later. */
  readonly near?: number;
  /** Far plane in metres; the facility is about 60 × 60 m (GAME_DESIGN §12.1). */
  readonly far?: number;
}

export const CAMERA_DEFAULTS = {
  fov: 60,
  near: 0.05,
  far: 500,
} as const satisfies Required<CameraOptions>;

export function createCamera(options: CameraOptions = {}): PerspectiveCamera {
  return new PerspectiveCamera(
    options.fov ?? CAMERA_DEFAULTS.fov,
    1, // aspect: set by the Renderer from the real viewport before the first frame
    options.near ?? CAMERA_DEFAULTS.near,
    options.far ?? CAMERA_DEFAULTS.far,
  );
}
