import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { ENEMY_RULES } from '../config/enemies';
import { CollisionWorld } from '../physics/CollisionWorld';
import { boxTriangles, rampTriangles } from '../world/levels/geometry';
import { LineTester } from './LineTester';

/**
 * Floor; a wall at x ∈ [4, 5] from z = −10 to 0; a low crate (0.6 m) at x ∈ [4, 5], z ∈ [2, 3];
 * an overhang (a duct ceiling at 1.25 m) at x ∈ [4, 5], z ∈ [6, 7]; a thin post at x = 4.5,
 * z = 10.3; a ramp rising 1 m over 4 m toward +x at z ∈ [14, 16].
 */
const world = new CollisionWorld([
  ...boxTriangles([-50, -1, -50], [50, 0, 50]),
  ...boxTriangles([4, 0, -10], [5, 3, 0]),
  ...boxTriangles([4, 0, 2], [5, 0.6, 3]),
  ...boxTriangles([4, 1.25, 6], [5, 3, 7]),
  ...boxTriangles([4.45, 0, 10.25], [4.55, 3, 10.35]),
  ...rampTriangles([2, 0, 14], [6, 1, 16], '+x'),
]);
const lines = new LineTester(world);
const R = 0.35;
const v = (x: number, y: number, z: number) => new Vector3(x, y, z);

describe('LineTester.walkable', () => {
  it('open floor is walkable, in both directions', () => {
    expect(lines.walkable(v(0, 0, 20), v(9, 0, 20), R)).toBe(true);
    expect(lines.walkable(v(9, 0, 20), v(0, 0, 20), R)).toBe(true);
  });

  it('a wall blocks it', () => {
    expect(lines.walkable(v(0, 0, -5), v(9, 0, -5), R)).toBe(false);
  });

  it('a low crate blocks it (knee height), though it can be seen over', () => {
    expect(lines.walkable(v(0, 0, 2.5), v(9, 0, 2.5), R)).toBe(false);
    expect(lines.lineOfSight(v(0, 1.6, 2.5), v(9, 1.6, 2.5))).toBe(true);
  });

  it('an opening too low to stand in blocks it (chest height)', () => {
    expect(lines.walkable(v(0, 0, 6.5), v(9, 0, 6.5), R)).toBe(false);
  });

  it('something beside the centre line but within the body blocks it', () => {
    // The post is 0.3 m to the side of the line: inside the 0.35 m body.
    expect(lines.walkable(v(0, 0, 10.0), v(9, 0, 10.0), R)).toBe(false);
    // A thin body passes.
    expect(lines.walkable(v(0, 0, 10.0), v(9, 0, 10.0), 0.2)).toBe(true);
  });

  it('ends on different levels are never a straight walk', () => {
    expect(lines.walkable(v(0, 0, 20), v(3, ENEMY_RULES.maxRise + 0.01, 20), R)).toBe(false);
    expect(lines.walkable(v(0, 0, 20), v(3, ENEMY_RULES.maxRise - 0.01, 20), R)).toBe(true);
  });

  it('walks up a gentle ramp between points on it', () => {
    // Along the ramp, 0.25 m higher per metre: from x = 2.5 (y 0.125) to x = 4.5 (y 0.625).
    expect(lines.walkable(v(2.5, 0.125, 15), v(4.5, 0.625, 15), R)).toBe(true);
  });

  it('a zero-length line is trivially walkable and visible', () => {
    expect(lines.walkable(v(1, 0, 1), v(1, 0, 1), R)).toBe(true);
    expect(lines.lineOfSight(v(1, 1, 1), v(1, 1, 1))).toBe(true);
  });

  it('counts its rays (4 for a clear walkable line, fewer when it stops early)', () => {
    const before = lines.rays;
    lines.walkable(v(0, 0, 20), v(9, 0, 20), R);
    expect(lines.rays - before).toBe(4);
    const blocked = lines.rays;
    lines.walkable(v(0, 0, -5), v(9, 0, -5), R);
    expect(lines.rays - blocked).toBe(1);
  });
});

describe('LineTester.lineOfSight', () => {
  it('walls block sight; the open floor does not', () => {
    expect(lines.lineOfSight(v(0, 1.6, -5), v(9, 1.6, -5))).toBe(false);
    expect(lines.lineOfSight(v(0, 1.6, 20), v(9, 1.6, 20))).toBe(true);
  });

  it('sight over a wall top is clear', () => {
    expect(lines.lineOfSight(v(0, 3.5, -5), v(9, 3.5, -5))).toBe(true);
  });
});

describe('LineTester.hasGround', () => {
  it('finds ground within a step of the feet; none in the air or past the floor’s edge', () => {
    const step = ENEMY_RULES.maxRise;
    expect(lines.hasGround(v(0, 0, 20))).toBe(true);
    expect(lines.hasGround(v(0, step - 0.05, 20))).toBe(true); // hovering, less than a step up
    expect(lines.hasGround(v(0, step + 0.05, 20))).toBe(false); // in the air
    expect(lines.hasGround(v(4.5, 0.6, 2.5))).toBe(true); // on top of the low crate
    expect(lines.hasGround(v(4, 0.5, 15))).toBe(true); // on the ramp (surface 0.5 m there)
    expect(lines.hasGround(v(60, 0, 0))).toBe(false); // beyond the floor
  });

  it('costs one ray', () => {
    const before = lines.rays;
    lines.hasGround(v(0, 0, 20));
    expect(lines.rays - before).toBe(1);
  });
});
