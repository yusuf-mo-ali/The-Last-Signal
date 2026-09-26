import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { HUMANOID_RIG, type HitboxRigDefinition } from '../config/combat';
import { DAMAGE_ZONES, type DamageZone } from '../config/enemies';
import { HitboxRig, rayCapsule, raySphere, rigBounds } from './hitbox';

const dir = (x: number, y: number, z: number) => new Vector3(x, y, z).normalize();

/** A humanoid rig at `position`, facing +z (towards a shooter standing south of it). */
function facingSouth(x = 0, z = 0): HitboxRig {
  const rig = new HitboxRig(HUMANOID_RIG);
  rig.position.set(x, 0, z);
  rig.yaw = Math.PI;
  return rig;
}

/** Shoots horizontally north (−z) at height `y` and lateral offset `x`, from 5 m south. */
function shootNorth(rig: HitboxRig, x: number, y: number) {
  return rig.raycast(new Vector3(x, y, rig.position.z + 5), new Vector3(0, 0, -1), 100);
}

describe('raySphere', () => {
  const c = [0, 0, 0] as const;
  it('hits the near surface', () => {
    expect(raySphere(0, 0, 5, 0, 0, -1, c, 1, 100)).toBeCloseTo(4, 12);
  });
  it('misses beside, behind and beyond range', () => {
    expect(raySphere(2, 0, 5, 0, 0, -1, c, 1, 100)).toBe(-1);
    expect(raySphere(0, 0, 5, 0, 0, 1, c, 1, 100)).toBe(-1);
    expect(raySphere(0, 0, 5, 0, 0, -1, c, 1, 3.9)).toBe(-1);
  });
  it('grazes the edge', () => {
    expect(raySphere(1, 0, 5, 0, 0, -1, c, 1, 100)).toBeCloseTo(5, 6);
  });
  it('a ray starting inside hits at 0', () => {
    expect(raySphere(0.2, 0, 0, 0, 0, -1, c, 1, 100)).toBe(0);
  });
});

describe('rayCapsule', () => {
  const a = [0, 0, 0] as const;
  const b = [0, 2, 0] as const;
  it('hits the cylinder side', () => {
    expect(rayCapsule(0, 1, 5, 0, 0, -1, a, b, 0.5, 100)).toBeCloseTo(4.5, 12);
  });
  it('hits the end caps above and below the segment', () => {
    expect(rayCapsule(0, 2.3, 5, 0, 0, -1, a, b, 0.5, 100)).toBeCloseTo(5 - Math.sqrt(0.16), 12);
    expect(rayCapsule(0, -0.3, 5, 0, 0, -1, a, b, 0.5, 100)).toBeCloseTo(5 - Math.sqrt(0.16), 12);
  });
  it('a ray along the axis hits the nearer cap (no division by zero)', () => {
    expect(rayCapsule(0, 10, 0, 0, -1, 0, a, b, 0.5, 100)).toBeCloseTo(7.5, 12);
  });
  it('misses outside the radius and past the caps', () => {
    expect(rayCapsule(0.6, 1, 5, 0, 0, -1, a, b, 0.5, 100)).toBe(-1);
    expect(rayCapsule(0, 2.6, 5, 0, 0, -1, a, b, 0.5, 100)).toBe(-1);
  });
  it('respects the range and hits at 0 from inside', () => {
    expect(rayCapsule(0, 1, 5, 0, 0, -1, a, b, 0.5, 4)).toBe(-1);
    expect(rayCapsule(0, 1, 0.1, 0, 0, -1, a, b, 0.5, 4)).toBe(0);
  });
  it('handles an oblique ray (checked against sampling)', () => {
    const o = new Vector3(3, 3, 3);
    const d = dir(-1, -0.8, -1.1);
    const t = rayCapsule(o.x, o.y, o.z, d.x, d.y, d.z, a, b, 0.5, 100);
    // March along the ray and find the first point within 0.5 m of the segment.
    let marched = -1;
    for (let s = 0; s < 10; s += 1e-4) {
      const p = o.clone().addScaledVector(d, s);
      const y = Math.min(2, Math.max(0, p.y));
      if (Math.hypot(p.x, p.y - y, p.z) <= 0.5) {
        marched = s;
        break;
      }
    }
    expect(marched).toBeGreaterThan(0);
    expect(t).toBeCloseTo(marched, 3);
  });
});

describe('HitboxRig: zone resolution (humanoid, facing the shooter)', () => {
  const rig = facingSouth();
  const cases: readonly (readonly [string, number, number, DamageZone])[] = [
    ['eye height, centre', 0, 1.62, 'HEAD'],
    ['top of the head', 0, 1.74, 'HEAD'],
    ['chest', 0, 1.2, 'TORSO'],
    ['belly', 0, 0.9, 'TORSO'],
    // Facing the shooter, the rig's own left arm is on the shooter's right (+x).
    ['arm on the shooter’s right', 0.31, 1.1, 'ARM_LEFT'],
    ['arm on the shooter’s left', -0.31, 1.1, 'ARM_RIGHT'],
    ['leg on the shooter’s right', 0.11, 0.4, 'LEG_LEFT'],
    ['leg on the shooter’s left', -0.11, 0.4, 'LEG_RIGHT'],
  ];
  for (const [name, x, y, zone] of cases) {
    it(`${name} → ${zone}`, () => {
      expect(shootNorth(rig, x, y)?.zone).toBe(zone);
    });
  }

  it('reports the distance to the surface the ray meets', () => {
    // Head sphere at z = 0, radius 0.13: from 5 m, the front surface is 4.87 m away.
    expect(shootNorth(rig, 0, 1.63)?.distance).toBeCloseTo(4.87, 6);
  });

  it('misses between the legs, beside the body and over the head', () => {
    expect(shootNorth(rig, 0, 0.3)).toBeNull();
    expect(shootNorth(rig, 0.6, 1.2)).toBeNull();
    expect(shootNorth(rig, 0, 1.8)).toBeNull();
  });

  it('every zone of the plan can be hit', () => {
    const hit = new Set<DamageZone>();
    for (let x = -0.5; x <= 0.5; x += 0.02) {
      for (let y = 0; y <= 1.9; y += 0.02) {
        const zone = shootNorth(rig, x, y)?.zone;
        if (zone) {
          hit.add(zone);
        }
      }
    }
    expect([...hit].sort()).toEqual([...DAMAGE_ZONES].sort());
  });

  it('turning the rig turns its zones: from behind, its left arm is on the shooter’s left', () => {
    const behind = facingSouth();
    behind.yaw = 0; // now facing away from the shooter
    expect(shootNorth(behind, -0.31, 1.1)?.zone).toBe('ARM_LEFT');
    expect(shootNorth(behind, 0.31, 1.1)?.zone).toBe('ARM_RIGHT');
  });

  it('facing east or west, its sides follow its own left and right', () => {
    // Facing east (+x), a shooter east of it sees its left arm on the shooter's right (−z side
    // from the shooter's view: the rig's left is north, −z).
    const east = new HitboxRig(HUMANOID_RIG);
    east.yaw = -Math.PI / 2; // yaw −90° faces +x
    const fromEast = (z: number, y: number) =>
      east.raycast(new Vector3(5, y, z), new Vector3(-1, 0, 0), 100)?.zone;
    expect(fromEast(-0.31, 1.1)).toBe('ARM_LEFT');
    expect(fromEast(0.31, 1.1)).toBe('ARM_RIGHT');
    expect(fromEast(-0.11, 0.4)).toBe('LEG_LEFT');
    expect(fromEast(0, 1.62)).toBe('HEAD');
    const west = new HitboxRig(HUMANOID_RIG);
    west.yaw = Math.PI / 2; // faces −x
    const fromWest = (z: number, y: number) =>
      west.raycast(new Vector3(-5, y, z), new Vector3(1, 0, 0), 100)?.zone;
    expect(fromWest(0.31, 1.1)).toBe('ARM_LEFT');
    expect(fromWest(-0.31, 1.1)).toBe('ARM_RIGHT');
  });

  it('agrees with toWorld at any facing: aiming at a shape’s centre hits that shape', () => {
    for (const yaw of [0, 0.4, 1.3, Math.PI / 2, 2.5, Math.PI, -0.7, -2.2]) {
      const r = new HitboxRig(HUMANOID_RIG);
      r.position.set(3, 0, -2);
      r.yaw = yaw;
      for (const shape of HUMANOID_RIG.shapes) {
        const local =
          shape.kind === 'sphere'
            ? shape.center
            : shape.a.map((v, i) => (v + (shape.b[i] ?? 0)) / 2);
        const target = r.toWorld(local as unknown as readonly [number, number, number]);
        // Shoot horizontally at it from 4 m away, from the direction the rig is facing.
        const origin = target.clone().add(new Vector3(-Math.sin(yaw) * 4, 0, -Math.cos(yaw) * 4));
        const direction = target.clone().sub(origin).normalize();
        expect(r.raycast(origin, direction, 100)?.zone, `yaw ${yaw} ${shape.zone}`).toBe(
          shape.zone,
        );
      }
    }
  });

  it('follows its position', () => {
    const moved = facingSouth(10, -20);
    expect(shootNorth(moved, 10, 1.62)?.zone).toBe('HEAD');
    expect(moved.raycast(new Vector3(0, 1.62, -15), new Vector3(0, 0, -1), 100)).toBeNull();
  });

  it('a shot from above hits the head first', () => {
    const hit = rig.raycast(new Vector3(0, 5, 0), new Vector3(0, -1, 0), 10);
    expect(hit?.zone).toBe('HEAD');
    expect(hit?.distance).toBeCloseTo(5 - 1.76, 6);
  });

  it('respects the maximum distance (walls in front cap it)', () => {
    expect(shootNorth(rig, 0, 1.2)?.distance).toBeCloseTo(4.8, 6);
    expect(rig.raycast(new Vector3(0, 1.2, 5), new Vector3(0, 0, -1), 4.7)).toBeNull();
  });

  it('on an exact tie the shape listed first wins', () => {
    const twins: HitboxRigDefinition = {
      id: 'twins',
      shapes: [
        { kind: 'sphere', zone: 'TORSO', center: [0, 1, 0], radius: 0.3 },
        { kind: 'sphere', zone: 'HEAD', center: [0, 1, 0], radius: 0.3 },
      ],
    };
    const r = new HitboxRig(twins);
    expect(r.raycast(new Vector3(0, 1, 5), new Vector3(0, 0, -1), 10)?.zone).toBe('TORSO');
  });

  it('swaps poses', () => {
    const r = facingSouth();
    r.setPose({
      id: 'crawling',
      shapes: [{ kind: 'sphere', zone: 'HEAD', center: [0, 0.3, 0], radius: 0.2 }],
    });
    expect(shootNorth(r, 0, 1.62)).toBeNull();
    expect(shootNorth(r, 0, 0.3)?.zone).toBe('HEAD');
  });

  it('rejects a rig without shapes', () => {
    expect(() => new HitboxRig({ id: 'empty', shapes: [] })).toThrow(RangeError);
  });

  it('maps local points to the world (debug views)', () => {
    const r = facingSouth(2, 3);
    // Facing +z, the rig's right (+x local) is −x in the world.
    const p = r.toWorld([0.3, 1, 0]);
    expect(p.x).toBeCloseTo(1.7, 12);
    expect(p.y).toBe(1);
    expect(p.z).toBeCloseTo(3, 12);
  });
});

describe('humanoid rig data', () => {
  it('bounds enclose every shape and are close to its height', () => {
    const b = rigBounds(HUMANOID_RIG);
    expect(b.center[1]).toBeCloseTo((0.005 + 1.76) / 2, 3);
    expect(b.radius).toBeGreaterThan(0.88);
    expect(b.radius).toBeLessThan(1);
  });
  it('is about as tall as the player (1.8 m) and has every zone once', () => {
    const zones = HUMANOID_RIG.shapes.map((s) => s.zone);
    expect([...zones].sort()).toEqual([...DAMAGE_ZONES].sort());
    const top = Math.max(
      ...HUMANOID_RIG.shapes.map((s) =>
        s.kind === 'sphere' ? s.center[1] + s.radius : Math.max(s.a[1], s.b[1]) + s.radius,
      ),
    );
    expect(top).toBeGreaterThan(1.7);
    expect(top).toBeLessThanOrEqual(1.8);
  });
});
