import { Ray, Triangle, Vector3 } from 'three';
import { Capsule } from 'three/addons/math/Capsule.js';
import { Octree } from 'three/addons/math/Octree.js';
import { describe, expect, it } from 'vitest';

// Guards the assumption behind D-003 and D-006: three.js math and the Octree/Capsule
// collision addons run headlessly in Node, with no renderer or DOM.
describe('toolchain: headless three.js', () => {
  it('runs vector math in Node', () => {
    expect(new Vector3(3, 4, 0).length()).toBe(5);
  });

  it('resolves capsule and ray queries against an octree built from raw triangles', () => {
    // A 10 x 10 floor at y = 0 made of two upward-facing triangles.
    const a = new Vector3(-5, 0, -5);
    const b = new Vector3(5, 0, -5);
    const c = new Vector3(5, 0, 5);
    const d = new Vector3(-5, 0, 5);
    const octree = new Octree();
    octree.addTriangle(new Triangle(a, c, b));
    octree.addTriangle(new Triangle(a, d, c));
    octree.build();

    // A capsule sunk 0.2 units into the floor must be pushed up by 0.2.
    const capsule = new Capsule(new Vector3(0, 0.3, 0), new Vector3(0, 1.5, 0), 0.5);
    const hit = octree.capsuleIntersect(capsule);
    expect(hit).not.toBe(false);
    if (hit) {
      expect(Math.abs(hit.normal.y)).toBeCloseTo(1);
      expect(hit.depth).toBeCloseTo(0.2);
    }

    // A ray cast straight down from y = 2 must hit the floor 2 units away.
    const rayHit = octree.rayIntersect(new Ray(new Vector3(0, 2, 0), new Vector3(0, -1, 0)));
    expect(rayHit).not.toBe(false);
    if (rayHit) {
      expect(rayHit.distance).toBeCloseTo(2);
    }
  });
});
