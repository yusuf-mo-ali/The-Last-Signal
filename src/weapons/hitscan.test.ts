import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { CollisionWorld } from '../physics/CollisionWorld';
import { Rng } from '../utils/Rng';
import { FACILITY } from '../world/levels/facility';
import { boxTriangles } from '../world/levels/geometry';
import { World } from '../world/World';
import { aimDirection, Hitscan, spreadDirection, type HitscanTarget } from './hitscan';

/** A floor (top y = 0) and a wall whose near face is at z = −10. */
const WORLD = new CollisionWorld([
  ...boxTriangles([-50, -1, -50], [50, 0, 50]),
  ...boxTriangles([-50, 0, -11], [50, 10, -10]),
]);
const EYE = new Vector3(0, 1.6, 0);
const NORTH = new Vector3(0, 0, -1);

/** A target sphere of radius 0.5 at `z`, straight ahead. */
function sphereTarget(z: number, id = 'dummy'): HitscanTarget {
  return {
    raycast: (origin, direction, maxDistance) => {
      const distance = origin.z - z - 0.5;
      if (direction.z > -0.99 || distance > maxDistance) {
        return null;
      }
      return {
        kind: 'target',
        distance,
        point: [0, origin.y, z + 0.5],
        targetId: id,
        zone: 'TORSO',
      };
    },
  };
}

describe('Hitscan against the level', () => {
  const hitscan = new Hitscan(WORLD);

  it('hits a wall at the right distance, point and normal', () => {
    const hit = hitscan.cast(EYE, NORTH, 100);
    expect(hit).toMatchObject({ kind: 'world' });
    expect(hit?.distance).toBeCloseTo(10);
    expect(hit?.point[2]).toBeCloseTo(-10);
    expect(hit?.point[1]).toBeCloseTo(1.6);
    expect(hit?.kind === 'world' && hit.normal[2]).toBeCloseTo(1);
  });

  it('hits the floor when aiming down', () => {
    const down = aimDirection(0, -Math.PI / 4);
    const hit = hitscan.cast(EYE, down, 100);
    expect(hit?.distance).toBeCloseTo(1.6 * Math.SQRT2);
    expect(hit?.point[1]).toBeCloseTo(0);
  });

  it('misses beyond the range, and in open sky', () => {
    expect(hitscan.cast(EYE, NORTH, 9.9)).toBeNull();
    expect(hitscan.cast(EYE, new Vector3(0, 1, 0), 100)).toBeNull();
    expect(hitscan.cast(EYE, new Vector3(0, 0, 1), 100)).toBeNull();
  });

  it('hits the real blockout: the control room desk from the south door', () => {
    const facility = new Hitscan(new World(FACILITY).collision);
    const hit = facility.cast(new Vector3(0, 0.5, -14), NORTH, 50);
    expect(hit?.kind).toBe('world');
    expect(hit?.point[2]).toBeCloseTo(-19); // the desk's south face
  });
});

describe('Hitscan targets (enemy hitboxes from Phase 4)', () => {
  it('returns a target in front of the wall, with its id and zone', () => {
    const hitscan = new Hitscan(WORLD);
    hitscan.addTarget(sphereTarget(-5, 'walker-1'));
    const hit = hitscan.cast(EYE, NORTH, 100);
    expect(hit).toMatchObject({ kind: 'target', targetId: 'walker-1', zone: 'TORSO' });
    expect(hit?.distance).toBeCloseTo(4.5);
  });

  it('lets the wall block a target behind it, and picks the nearest of several', () => {
    const hitscan = new Hitscan(WORLD);
    hitscan.addTarget(sphereTarget(-15, 'behind-wall'));
    expect(hitscan.cast(EYE, NORTH, 100)?.kind).toBe('world');
    hitscan.addTarget(sphereTarget(-7, 'far'));
    hitscan.addTarget(sphereTarget(-3, 'near'));
    expect(hitscan.cast(EYE, NORTH, 100)).toMatchObject({ targetId: 'near' });
  });

  it('can remove a target', () => {
    const hitscan = new Hitscan(WORLD);
    const remove = hitscan.addTarget(sphereTarget(-5));
    remove();
    expect(hitscan.cast(EYE, NORTH, 100)?.kind).toBe('world');
  });
});

describe('spreadDirection', () => {
  it('returns the aim unchanged for a zero cone', () => {
    expect(spreadDirection(NORTH, 0, new Rng(1)).toArray()).toEqual([0, 0, -1]);
  });

  it('stays unit length and inside the cone, and fills it (not just its edge)', () => {
    const rng = new Rng(9);
    const cone = 0.05;
    let inner = 0;
    for (let i = 0; i < 2000; i++) {
      const d = spreadDirection(NORTH, cone, rng);
      expect(d.length()).toBeCloseTo(1);
      const angle = d.angleTo(NORTH);
      expect(angle).toBeLessThanOrEqual(cone + 1e-9);
      if (angle < cone / 2) {
        inner++;
      }
    }
    // Uniform over the disc: about a quarter fall inside half the radius.
    expect(inner / 2000).toBeGreaterThan(0.2);
    expect(inner / 2000).toBeLessThan(0.3);
  });

  it('works when aiming straight up or down', () => {
    const up = spreadDirection(new Vector3(0, 1, 0), 0.1, new Rng(2));
    expect(up.angleTo(new Vector3(0, 1, 0))).toBeLessThanOrEqual(0.1 + 1e-9);
  });

  it('is reproducible from the seed', () => {
    const a = spreadDirection(NORTH, 0.1, new Rng('x'));
    const b = spreadDirection(NORTH, 0.1, new Rng('x'));
    expect(a.equals(b)).toBe(true);
  });
});

describe('aimDirection', () => {
  it('matches the look conventions: yaw 0 north, yaw π/2 west, pitch up', () => {
    const north = aimDirection(0, 0);
    expect(north.x).toBeCloseTo(0);
    expect(north.z).toBeCloseTo(-1);
    const west = aimDirection(Math.PI / 2, 0);
    expect(west.x).toBeCloseTo(-1);
    expect(west.z).toBeCloseTo(0);
    const up = aimDirection(0, Math.PI / 2);
    expect(up.y).toBeCloseTo(1);
  });
});
