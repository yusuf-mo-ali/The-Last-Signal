/**
 * Turns level brushes into triangles (D-013). Pure math on three.js `Vector3`/`Triangle`, so it runs
 * in Node for collision and tests, and the render view builds its meshes from the same triangles.
 *
 * Every triangle faces outward from its solid. This matters: three.js `Octree` capsule tests are
 * one-sided (a capsule behind a face is ignored), so each face is oriented against its known
 * outward direction rather than trusting hand-ordered vertices.
 */

import { Triangle, Vector3 } from 'three';
import type { Brush, RiseDirection, SurfaceKind, Vec3 } from './types';

export type GeometryPurpose = 'collision' | 'render';

export interface SurfaceTriangles {
  readonly surface: SurfaceKind;
  readonly triangles: Triangle[];
}

const _n = new Vector3();

/** Adds a planar polygon (3 or 4 points, any order around the edge) facing `outward`. */
function addFace(out: Triangle[], points: readonly Vector3[], outward: Vector3): void {
  const [a, b, c, d] = points;
  if (!a || !b || !c) {
    return;
  }
  const flip = new Triangle(a, b, c).getNormal(_n).dot(outward) < 0;
  const push = (p: Vector3, q: Vector3, r: Vector3): void => {
    out.push(
      flip
        ? new Triangle(p.clone(), r.clone(), q.clone())
        : new Triangle(p.clone(), q.clone(), r.clone()),
    );
  };
  push(a, b, c);
  if (d) {
    push(a, c, d);
  }
}

const v = (x: number, y: number, z: number): Vector3 => new Vector3(x, y, z);

export function boxTriangles(min: Vec3, max: Vec3, out: Triangle[] = []): Triangle[] {
  const [x0, y0, z0] = min;
  const [x1, y1, z1] = max;
  addFace(out, [v(x0, y1, z0), v(x1, y1, z0), v(x1, y1, z1), v(x0, y1, z1)], v(0, 1, 0));
  addFace(out, [v(x0, y0, z0), v(x1, y0, z0), v(x1, y0, z1), v(x0, y0, z1)], v(0, -1, 0));
  addFace(out, [v(x1, y0, z0), v(x1, y1, z0), v(x1, y1, z1), v(x1, y0, z1)], v(1, 0, 0));
  addFace(out, [v(x0, y0, z0), v(x0, y1, z0), v(x0, y1, z1), v(x0, y0, z1)], v(-1, 0, 0));
  addFace(out, [v(x0, y0, z1), v(x1, y0, z1), v(x1, y1, z1), v(x0, y1, z1)], v(0, 0, 1));
  addFace(out, [v(x0, y0, z0), v(x1, y0, z0), v(x1, y1, z0), v(x0, y1, z0)], v(0, 0, -1));
  return out;
}

/**
 * A solid wedge rising toward `rise`. Built in a local frame (u = rise axis, w = across) and
 * mapped back, so all four directions share one implementation.
 */
export function rampTriangles(
  min: Vec3,
  max: Vec3,
  rise: RiseDirection,
  out: Triangle[] = [],
): Triangle[] {
  const [x0, y0, z0] = min;
  const [x1, y1, z1] = max;
  const alongX = rise === '+x' || rise === '-x';
  const positive = rise === '+x' || rise === '+z';
  // u runs from the low edge (0) to the high edge (1); w spans the width.
  const [uLow, uHigh] = alongX ? (positive ? [x0, x1] : [x1, x0]) : positive ? [z0, z1] : [z1, z0];
  const [w0, w1] = alongX ? [z0, z1] : [x0, x1];
  const p = (u: number, y: number, w: number): Vector3 => (alongX ? v(u, y, w) : v(w, y, u));
  const riseDir = alongX ? v(Math.sign(uHigh - uLow), 0, 0) : v(0, 0, Math.sign(uHigh - uLow));
  const length = Math.abs(uHigh - uLow);
  const height = y1 - y0;
  // Sloped top: normal leans back against the rise direction.
  const topNormal = riseDir
    .clone()
    .multiplyScalar(-height)
    .add(v(0, length, 0))
    .normalize();

  addFace(out, [p(uLow, y0, w0), p(uHigh, y1, w0), p(uHigh, y1, w1), p(uLow, y0, w1)], topNormal);
  addFace(out, [p(uLow, y0, w0), p(uHigh, y0, w0), p(uHigh, y0, w1), p(uLow, y0, w1)], v(0, -1, 0));
  addFace(out, [p(uHigh, y0, w0), p(uHigh, y1, w0), p(uHigh, y1, w1), p(uHigh, y0, w1)], riseDir);
  const side = alongX ? v(0, 0, 1) : v(1, 0, 0);
  addFace(out, [p(uLow, y0, w1), p(uHigh, y0, w1), p(uHigh, y1, w1)], side);
  addFace(out, [p(uLow, y0, w0), p(uHigh, y0, w0), p(uHigh, y1, w0)], side.clone().negate());
  return out;
}

/** The boxes that draw a staircase: step i spans the i-th slice and rises to (i+1)·stepHeight. */
export function stairBoxes(
  min: Vec3,
  max: Vec3,
  rise: RiseDirection,
  steps: number,
): [Vec3, Vec3][] {
  const [x0, y0, z0] = min;
  const [x1, y1, z1] = max;
  const boxes: [Vec3, Vec3][] = [];
  const stepHeight = (y1 - y0) / steps;
  for (let i = 0; i < steps; i++) {
    const t0 = i / steps;
    const top = y0 + stepHeight * (i + 1);
    switch (rise) {
      case '+x':
        boxes.push([
          [x0 + (x1 - x0) * t0, y0, z0],
          [x1, top, z1],
        ]);
        break;
      case '-x':
        boxes.push([
          [x0, y0, z0],
          [x1 - (x1 - x0) * t0, top, z1],
        ]);
        break;
      case '+z':
        boxes.push([
          [x0, y0, z0 + (z1 - z0) * t0],
          [x1, top, z1],
        ]);
        break;
      case '-z':
        boxes.push([
          [x0, y0, z0],
          [x1, top, z1 - (z1 - z0) * t0],
        ]);
        break;
    }
  }
  return boxes;
}

export function brushTriangles(
  brush: Brush,
  purpose: GeometryPurpose,
  out: Triangle[] = [],
): Triangle[] {
  switch (brush.kind) {
    case 'box':
      return boxTriangles(brush.min, brush.max, out);
    case 'ramp':
      return rampTriangles(brush.min, brush.max, brush.rise, out);
    case 'stairs':
      if (purpose === 'collision') {
        return rampTriangles(brush.min, brush.max, brush.rise, out);
      }
      for (const [min, max] of stairBoxes(brush.min, brush.max, brush.rise, brush.steps)) {
        boxTriangles(min, max, out);
      }
      return out;
  }
}

/** All triangles of a level for one purpose, grouped by surface (render meshes merge per group). */
export function levelTriangles(
  brushes: readonly Brush[],
  purpose: GeometryPurpose,
): SurfaceTriangles[] {
  const groups = new Map<SurfaceKind, Triangle[]>();
  for (const brush of brushes) {
    let list = groups.get(brush.surface);
    if (!list) {
      list = [];
      groups.set(brush.surface, list);
    }
    brushTriangles(brush, purpose, list);
  }
  return [...groups].map(([surface, triangles]) => ({ surface, triangles }));
}
