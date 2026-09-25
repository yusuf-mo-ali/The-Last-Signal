import { Vector3 } from 'three';
import { Capsule } from 'three/addons/math/Capsule.js';
import { describe, expect, it } from 'vitest';
import { PLAYER_MOVEMENT as P } from '../../config/player';
import { CollisionWorld } from '../../physics/CollisionWorld';
import {
  CATWALK_HEIGHT,
  FACILITY,
  FACILITY_BEACON_POSITION,
  FACILITY_HALF_SIZE,
  FACILITY_ROUTE,
} from './facility';
import { levelTriangles } from './geometry';

const collision = new CollisionWorld(
  levelTriangles(FACILITY.brushes, 'collision').flatMap((g) => g.triangles),
);

function standingCapsule(x: number, feetY: number, z: number, height = P.standHeight): Capsule {
  // Lifted a hair off the floor so resting contact does not count.
  return new Capsule(
    new Vector3(x, feetY + P.radius + 0.01, z),
    new Vector3(x, feetY + height - P.radius, z),
    P.radius,
  );
}

describe('FACILITY blockout', () => {
  it('has well-formed brushes inside the map bounds', () => {
    const limit = FACILITY_HALF_SIZE + 1;
    for (const brush of FACILITY.brushes) {
      for (let axis = 0; axis < 3; axis++) {
        expect(brush.max[axis]).toBeGreaterThan(brush.min[axis] ?? 0);
      }
      for (const v of [...brush.min, ...brush.max]) {
        expect(Math.abs(v)).toBeLessThanOrEqual(limit);
      }
    }
  });

  it('stays lightweight: a few thousand triangles at most', () => {
    const render = levelTriangles(FACILITY.brushes, 'render');
    const count = render.reduce((sum, g) => sum + g.triangles.length, 0);
    expect(count).toBeLessThan(2000);
    expect(render.length).toBeLessThanOrEqual(6); // one merged mesh per surface kind
    expect(collision.triangleCount).toBeLessThan(2000);
  });

  it('only has walkable ramps and stairs', () => {
    for (const brush of FACILITY.brushes) {
      if (brush.kind === 'box') {
        continue;
      }
      const run = brush.rise[1] === 'x' ? brush.max[0] - brush.min[0] : brush.max[2] - brush.min[2];
      const rise = brush.max[1] - brush.min[1];
      const normalY = run / Math.hypot(run, rise);
      expect(normalY).toBeGreaterThanOrEqual(P.walkableNormalY);
    }
  });

  it('spawns the player on open ground below the kill plane margin', () => {
    const [x, y, z] = FACILITY.spawn.position;
    expect(collision.capsuleContacts(standingCapsule(x, y, z))).toEqual([]);
    const ground = collision.raycast(new Vector3(x, y + 1, z), new Vector3(0, -1, 0), 2);
    expect(ground?.point.y).toBeCloseTo(y);
    expect(FACILITY.killPlaneY).toBeLessThan(-5);
  });

  it('has room for a standing player at every route waypoint, over ground', () => {
    for (const wp of FACILITY_ROUTE) {
      const contacts = collision.capsuleContacts(standingCapsule(wp.x, wp.y, wp.z));
      expect(contacts, wp.area).toEqual([]);
      const ground = collision.raycast(
        new Vector3(wp.x, wp.y + 0.5, wp.z),
        new Vector3(0, -1, 0),
        1,
      );
      expect(ground?.point.y, wp.area).toBeCloseTo(wp.y);
    }
  });

  it('has a duct that fits a crouching player but not a standing one', () => {
    const [x, z] = [11.7, -18]; // inside the duct
    expect(collision.capsuleContacts(standingCapsule(x, 0, z, P.crouchHeight))).toEqual([]);
    expect(collision.capsuleContacts(standingCapsule(x, 0, z)).length).toBeGreaterThan(0);
  });

  it('keeps the catwalk above head height, so the area under it stays walkable', () => {
    expect(CATWALK_HEIGHT - 0.3).toBeGreaterThan(P.standHeight);
    expect(collision.capsuleContacts(standingCapsule(-22.25, 0, 2))).toEqual([]);
  });

  it('puts the beacon above the tower, clear of the level', () => {
    const [x, y, z] = FACILITY_BEACON_POSITION;
    const top = collision.raycast(new Vector3(x, y, z), new Vector3(0, -1, 0), 20);
    expect(top?.point.y).toBeCloseTo(7);
    expect(y - (top?.point.y ?? 0)).toBeGreaterThan(0.4);
  });
});
