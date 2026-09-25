import type { Triangle } from 'three';
import { Box3, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import {
  boxTriangles,
  brushTriangles,
  levelTriangles,
  rampTriangles,
  stairBoxes,
} from './geometry';
import type { Brush, RiseDirection, Vec3 } from './types';

const RISES: readonly RiseDirection[] = ['+x', '-x', '+z', '-z'];

function normal(t: Triangle): Vector3 {
  return t.getNormal(new Vector3());
}

function centroid(t: Triangle): Vector3 {
  return t.getMidpoint(new Vector3());
}

/** Every face of a convex solid points away from a point inside it. */
function expectOutward(triangles: readonly Triangle[], inside: Vector3): void {
  for (const t of triangles) {
    expect(t.getArea()).toBeGreaterThan(0);
    expect(normal(t).dot(centroid(t).sub(inside))).toBeGreaterThan(0);
  }
}

describe('boxTriangles', () => {
  it('builds 12 outward-facing triangles covering the box', () => {
    const tris = boxTriangles([0, 0, 0], [2, 1, 3]);
    expect(tris).toHaveLength(12);
    expectOutward(tris, new Vector3(1, 0.5, 1.5));
    const bounds = new Box3();
    for (const t of tris) {
      bounds.expandByPoint(t.a).expandByPoint(t.b).expandByPoint(t.c);
    }
    expect(bounds.min.toArray()).toEqual([0, 0, 0]);
    expect(bounds.max.toArray()).toEqual([2, 1, 3]);
    const area = tris.reduce((sum, t) => sum + t.getArea(), 0);
    expect(area).toBeCloseTo(2 * (2 * 1 + 2 * 3 + 1 * 3));
  });

  it('appends to an existing list', () => {
    const out = boxTriangles([0, 0, 0], [1, 1, 1]);
    boxTriangles([2, 0, 0], [3, 1, 1], out);
    expect(out).toHaveLength(24);
  });
});

describe('rampTriangles', () => {
  it.each(RISES)('builds an outward-facing wedge rising toward %s', (rise) => {
    const min: Vec3 = [0, 0, 0];
    const max: Vec3 = [4, 2, 4];
    const tris = rampTriangles(min, max, rise);
    expect(tris).toHaveLength(8); // top 2, bottom 2, back 2, sides 1 + 1
    // A point inside the wedge: low (y small) and toward the high edge.
    const axis = rise[1] === 'x' ? 'x' : 'z';
    const inside = new Vector3(2, 0.4, 2);
    inside[axis] = rise.startsWith('+') ? 3 : 1;
    expectOutward(tris, inside);
  });

  it('has a sloped top whose normal leans away from the rise', () => {
    const tris = rampTriangles([0, 0, 0], [4, 2, 1], '+x');
    const top = tris.map(normal).filter((n) => n.y > 0.1);
    expect(top).toHaveLength(2);
    for (const n of top) {
      expect(n.x).toBeLessThan(0);
      expect(n.y).toBeCloseTo(4 / Math.hypot(4, 2));
    }
  });
});

describe('stairBoxes', () => {
  it.each(RISES)('splits a staircase rising toward %s into equal steps', (rise) => {
    const boxes = stairBoxes([0, 0, 0], [2, 1, 4], rise, 4);
    expect(boxes).toHaveLength(4);
    boxes.forEach(([lo, hi], i) => {
      expect(lo[1]).toBe(0);
      expect(hi[1]).toBeCloseTo((i + 1) * 0.25);
      expect(hi[0] - lo[0]).toBeGreaterThan(0);
      expect(hi[2] - lo[2]).toBeGreaterThan(0);
    });
    // The highest step is the narrowest, and it sits at the high edge.
    const [lastLo, lastHi] = boxes[3] ?? [
      [0, 0, 0],
      [0, 0, 0],
    ];
    const edge = { '+x': lastHi[0], '-x': lastLo[0], '+z': lastHi[2], '-z': lastLo[2] }[rise];
    expect(edge).toBe({ '+x': 2, '-x': 0, '+z': 4, '-z': 0 }[rise]);
  });
});

describe('brushTriangles / levelTriangles', () => {
  const stairs: Brush = {
    kind: 'stairs',
    min: [0, 0, 0],
    max: [2, 1, 4],
    rise: '+z',
    steps: 5,
    surface: 'structure',
  };

  it('draws stairs as steps but collides with them as a smooth ramp', () => {
    expect(brushTriangles(stairs, 'render')).toHaveLength(5 * 12);
    expect(brushTriangles(stairs, 'collision')).toHaveLength(8);
  });

  it('groups triangles by surface, one group per kind', () => {
    const brushes: Brush[] = [
      { kind: 'box', min: [0, 0, 0], max: [1, 1, 1], surface: 'crate' },
      { kind: 'box', min: [2, 0, 0], max: [3, 1, 1], surface: 'crate' },
      { kind: 'ramp', min: [0, 0, 2], max: [1, 1, 3], rise: '+x', surface: 'metal' },
    ];
    const groups = levelTriangles(brushes, 'render');
    expect(groups.map((g) => [g.surface, g.triangles.length])).toEqual([
      ['crate', 24],
      ['metal', 8],
    ]);
  });
});
