import { describe, expect, it } from 'vitest';
import { ENEMY_RULES, ENEMY_STATS } from '../config/enemies';
import { TRAINING_ENEMIES } from '../config/training';
import { FACILITY, FACILITY_NAVIGATION } from '../world/levels/facility';
import type { Brush, RiseDirection } from '../world/levels/types';
import { bodyFits } from './clearance';

const BODY = { radius: 0.35, height: 1.8 };
const STEP = 0.5;
const box = (min: [number, number, number], max: [number, number, number]): Brush => ({
  kind: 'box',
  min,
  max,
  surface: 'structure',
});
const fits = (brushes: Brush[], x: number, y: number, z: number) =>
  bodyFits(brushes, x, y, z, BODY, STEP);

describe('bodyFits: boxes', () => {
  const crate = [box([0, 0, 0], [2, 1, 2])];

  it('blocks a body whose footprint overlaps a box, free once it is a radius away', () => {
    expect(fits(crate, 1, 0, 1)).toBe(false); // centre inside
    expect(fits(crate, 2.3, 0, 1)).toBe(false); // edge overlap (0.3 < radius)
    expect(fits(crate, 2.36, 0, 1)).toBe(true);
    expect(fits(crate, -0.36, 0, 1)).toBe(true);
    // Corner: diagonal distance decides, not the bounding square.
    expect(fits(crate, 2.3, 0, 2.3)).toBe(true); // 0.42 from the corner
    expect(fits(crate, 2.2, 0, 2.2)).toBe(false); // 0.28 from the corner
  });

  it('a body entirely inside a large brush is blocked (it touches none of its faces)', () => {
    const tower = [box([-1.2, 0, -1.2], [1.2, 7, 1.2])];
    expect(fits(tower, 0, 0, 0)).toBe(false);
    expect(fits(tower, 0.65, 0, 0.6)).toBe(false);
  });

  it('ignores what is below step height, on top of which it can stand', () => {
    const kerb = [box([0, 0, 0], [2, 0.4, 2])];
    expect(fits(kerb, 1, 0, 1)).toBe(true); // a step it walks up
    expect(fits(crate, 1, 1, 1)).toBe(true); // standing on the crate
    expect(fits(crate, 1, 0.6, 1)).toBe(true); // a step below its top
    expect(fits(crate, 1, 0.4, 1)).toBe(false); // more than a step below its top
  });

  it('ignores a roof above the head, but not a ceiling lower than the body', () => {
    const roof = [box([0, 4, 0], [2, 4.3, 2])];
    const duct = [box([0, 1.25, 0], [2, 3, 2])];
    expect(fits(roof, 1, 0, 1)).toBe(true);
    expect(fits(duct, 1, 0, 1)).toBe(false);
    expect(bodyFits(duct, 1, 0, 1, { radius: 0.35, height: 1.2 }, STEP)).toBe(true); // a crawler
  });
});

describe('bodyFits: ramps and stairs (the surface under the body decides)', () => {
  // Rises 2 m over 8 m (14°): 0.25 m per metre.
  const ramps: Record<RiseDirection, Brush> = {
    '+x': { kind: 'ramp', min: [0, 0, 0], max: [8, 2, 4], rise: '+x', surface: 'structure' },
    '-x': { kind: 'ramp', min: [0, 0, 0], max: [8, 2, 4], rise: '-x', surface: 'structure' },
    '+z': { kind: 'ramp', min: [0, 0, 0], max: [4, 2, 8], rise: '+z', surface: 'structure' },
    '-z': {
      kind: 'stairs',
      min: [0, 0, 0],
      max: [4, 2, 8],
      rise: '-z',
      steps: 8,
      surface: 'structure',
    },
  };
  /** The point `u` (0 low edge, 1 high edge) along each ramp's slope, mid-width. */
  const at = (rise: RiseDirection, u: number): [number, number] => {
    switch (rise) {
      case '+x':
        return [u * 8, 2];
      case '-x':
        return [8 - u * 8, 2];
      case '+z':
        return [2, u * 8];
      case '-z':
        return [2, 8 - u * 8];
    }
  };

  for (const rise of ['+x', '-x', '+z', '-z'] as const) {
    it(`rise ${rise}: fits standing on the slope, not at floor level under its high part`, () => {
      const brushes = [ramps[rise]];
      const [lowX, lowZ] = at(rise, 0.25); // surface 0.5 m
      const [highX, highZ] = at(rise, 0.75); // surface 1.5 m
      expect(fits(brushes, lowX, 0.5, lowZ)).toBe(true);
      expect(fits(brushes, highX, 1.5, highZ)).toBe(true);
      expect(fits(brushes, lowX, 0, lowZ)).toBe(false); // 0.5 + 0.35 × 0.25 above a step
      expect(fits(brushes, highX, 0, highZ)).toBe(false);
      const [footX, footZ] = at(rise, 0.05); // surface 0.1 m: within a step
      expect(fits(brushes, footX, 0, footZ)).toBe(true);
    });
  }
});

describe('the facility', () => {
  const walker = ENEMY_STATS.walker.body;
  const fitsWalker = (x: number, y: number, z: number) =>
    bodyFits(FACILITY.brushes, x, y, z, walker, ENEMY_RULES.maxRise);

  it('every route node has room for a Walker', () => {
    for (const node of FACILITY_NAVIGATION.nodes) {
      expect(fitsWalker(...node.position), node.id).toBe(true);
    }
  });

  it('the test encounter places every Walker where it fits, and the player spawn is clear', () => {
    for (const placement of TRAINING_ENEMIES.placements) {
      expect(fitsWalker(...placement.position), placement.position.join(',')).toBe(true);
    }
    expect(fitsWalker(...FACILITY.spawn.position)).toBe(true);
  });

  it('solid parts are refused (tower, crate, wall, duct, under the stairs, inside the dock)', () => {
    expect(fitsWalker(0, 0, 0)).toBe(false); // signal tower
    expect(fitsWalker(0.65, 0, 0.6)).toBe(false);
    expect(fitsWalker(3.6, 0, 4.6)).toBe(false); // jumpable crate
    expect(fitsWalker(5, 0, -12.2)).toBe(false); // south wall of the control room
    expect(fitsWalker(0, 0, -12.2)).toBe(true); // …in its doorway
    expect(fitsWalker(11.7, 0, -18)).toBe(false); // the crawl duct (too low to stand)
    expect(fitsWalker(-22.25, 0, -9)).toBe(false); // under the high end of the stairs
    expect(fitsWalker(-22.25, 2.5, 1)).toBe(true); // on the catwalk
    expect(fitsWalker(0, 0.9, 21.5)).toBe(true); // on the dock
    expect(fitsWalker(0, 0, 21.5)).toBe(false); // inside the dock
  });
});
