import { Vector3 } from 'three';
import { Capsule } from 'three/addons/math/Capsule.js';
import { describe, expect, it } from 'vitest';
import { boxTriangles } from '../world/levels/geometry';
import { CollisionWorld } from './CollisionWorld';

/** A floor (top at y = 0) and a wall whose west face is at x = 2. */
function world(): CollisionWorld {
  const triangles = boxTriangles([-10, -1, -10], [10, 0, 10]);
  boxTriangles([2, 0, -10], [3, 3, 10], triangles);
  return new CollisionWorld(triangles);
}

function capsuleAt(x: number, feetY: number, z: number, radius = 0.35, height = 1.8): Capsule {
  return new Capsule(
    new Vector3(x, feetY + radius, z),
    new Vector3(x, feetY + height - radius, z),
    radius,
  );
}

describe('CollisionWorld', () => {
  it('counts its triangles', () => {
    expect(world().triangleCount).toBe(24);
  });

  it('reports nothing for a capsule in open space', () => {
    expect(world().capsuleContacts(capsuleAt(0, 0.5, 0))).toEqual([]);
  });

  it('reports the floor, pushing up by the overlap', () => {
    // Off the diagonal that splits the floor's top face into two triangles.
    const [contact, ...rest] = world().capsuleContacts(capsuleAt(0.5, -0.1, -3));
    expect(rest).toEqual([]);
    expect(contact?.normal.y).toBeCloseTo(1);
    expect(contact?.depth).toBeCloseTo(0.1);
  });

  it('reports floor and wall separately, deepest first', () => {
    const contacts = world().capsuleContacts(capsuleAt(1.8, -0.05, -3));
    expect(contacts).toHaveLength(2);
    const [wall, floor] = contacts;
    expect(wall?.normal.x).toBeCloseTo(-1);
    expect(wall?.depth).toBeCloseTo(0.15);
    expect(floor?.normal.y).toBeCloseTo(1);
    expect(floor?.depth).toBeCloseTo(0.05);
  });

  it('ignores a capsule that is entirely behind a face (one-sided surfaces)', () => {
    // Deep inside the wall, behind its west face: only the faces it is near count.
    const inside = world().capsuleContacts(capsuleAt(2.5, 0.5, 0, 0.1));
    expect(inside.every((c) => c.normal.x !== -1)).toBe(true);
  });

  it('raycasts to the nearest front face within range', () => {
    const w = world();
    const down = w.raycast(new Vector3(0, 5, 0), new Vector3(0, -1, 0), 10);
    expect(down?.distance).toBeCloseTo(5);
    expect(down?.normal.y).toBeCloseTo(1);
    expect(down?.point.y).toBeCloseTo(0);

    const east = w.raycast(new Vector3(0, 1, 0), new Vector3(1, 0, 0), 10);
    expect(east?.distance).toBeCloseTo(2);

    expect(w.raycast(new Vector3(0, 5, 0), new Vector3(0, -1, 0), 4)).toBeNull();
    expect(w.raycast(new Vector3(0, 5, 0), new Vector3(0, 1, 0), 100)).toBeNull();
  });
});
