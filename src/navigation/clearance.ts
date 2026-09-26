/**
 * Room for a standing body (D-042): does an upright cylinder (`radius`, `height`) with its feet at
 * a point overlap any solid part of the level above step height? Spawn validation.
 *
 * It reads the level's brush data instead of the collision triangles, so a body entirely inside a
 * brush (which touches none of its faces, e.g. in the middle of the signal tower) still counts as
 * blocked. Boxes block wherever they rise more than a step above the feet; ramps and stairs only
 * where their surface under the body does. Pure data, no allocation.
 */

import type { Brush, RampBrush, StairsBrush } from '../world/levels/types';

export interface BodyShape {
  readonly radius: number;
  readonly height: number;
}

/** True if nothing in `brushes` intrudes into a body standing with its feet at (x, y, z). */
export function bodyFits(
  brushes: readonly Brush[],
  x: number,
  y: number,
  z: number,
  body: BodyShape,
  stepHeight: number,
): boolean {
  for (const brush of brushes) {
    if (intrudes(brush, x, y, z, body, stepHeight)) {
      return false;
    }
  }
  return true;
}

function intrudes(
  brush: Brush,
  x: number,
  y: number,
  z: number,
  body: BodyShape,
  stepHeight: number,
): boolean {
  const [x0, y0, z0] = brush.min;
  const [x1, y1, z1] = brush.max;
  // Entirely below step height (the floor, a kerb) or above the head (a roof): no.
  if (y1 <= y + stepHeight || y0 >= y + body.height) {
    return false;
  }
  // The body's footprint must overlap the brush's.
  const dx = x - Math.min(Math.max(x, x0), x1);
  const dz = z - Math.min(Math.max(z, z0), z1);
  if (dx * dx + dz * dz >= body.radius * body.radius) {
    return false;
  }
  return brush.kind === 'box' || surfaceUnder(brush, x, z, body.radius) > y + stepHeight;
}

/** The highest point of a ramp's (or staircase's) surface under a body of `radius` at (x, z). */
function surfaceUnder(
  brush: RampBrush | StairsBrush,
  x: number,
  z: number,
  radius: number,
): number {
  const [x0, y0, z0] = brush.min;
  const [x1, y1, z1] = brush.max;
  let u: number;
  switch (brush.rise) {
    case '+x':
      u = (Math.min(x + radius, x1) - x0) / (x1 - x0);
      break;
    case '-x':
      u = (x1 - Math.max(x - radius, x0)) / (x1 - x0);
      break;
    case '+z':
      u = (Math.min(z + radius, z1) - z0) / (z1 - z0);
      break;
    case '-z':
      u = (z1 - Math.max(z - radius, z0)) / (z1 - z0);
      break;
  }
  return y0 + Math.min(1, Math.max(0, u)) * (y1 - y0);
}
