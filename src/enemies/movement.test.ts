/**
 * Enemy movement in the real blockout (D-042): a Walker told where its target is must reach it
 * from the yard in every area, through doorways, up stairs and ramps and around obstacles,
 * without going through walls or floors, teleporting or getting stuck.
 */

import type { Vector3 } from 'three';
import { Capsule } from 'three/addons/math/Capsule.js';
import { describe, expect, it } from 'vitest';
import { ENEMY_STATS } from '../config/enemies';
import { CollisionWorld } from '../physics/CollisionWorld';
import { FACILITY } from '../world/levels/facility';
import { boxTriangles } from '../world/levels/geometry';
import type { LevelDefinition } from '../world/levels/types';
import { World } from '../world/World';
import { DT, enemyTestWorld, TestTarget } from './testWorld';

const W = ENEMY_STATS.walker;
const facility = new World(FACILITY);
const capsule = new Capsule();

/** Deepest overlap of a Walker capsule standing at `feet` with the level. */
function penetration(feet: Vector3): number {
  const r = W.body.radius;
  capsule.radius = r;
  capsule.start.set(feet.x, feet.y + r, feet.z);
  capsule.end.set(feet.x, feet.y + W.body.height - r, feet.z);
  return facility.collision.capsuleContacts(capsule)[0]?.depth ?? 0;
}

interface Chase {
  readonly reached: boolean;
  readonly seconds: number;
  readonly maxPenetration: number;
  readonly maxStep: number;
  readonly minY: number;
  readonly respawns: number;
  readonly hits: number;
}

function chase(
  from: readonly [number, number, number],
  to: readonly [number, number, number],
): Chase {
  const target = new TestTarget(to[0], to[2]);
  target.position.y = to[1];
  target.health = 10_000;
  const t = enemyTestWorld({ targets: [target], world: facility.collision, level: FACILITY });
  const walker = t.manager.spawn('walker', from, { patrol: false, alertTo: target });
  if (!walker) {
    throw new Error('no walker');
  }
  let maxPenetration = 0;
  let maxStep = 0;
  let minY = Number.POSITIVE_INFINITY;
  const previous = walker.motor.position.clone();
  let steps = 0;
  const limit = 45 / DT; // every case needs well under this (9–27 s)
  for (; steps < limit && target.hits.length === 0; steps++) {
    t.step();
    const p = walker.motor.position;
    maxPenetration = Math.max(maxPenetration, penetration(p));
    maxStep = Math.max(maxStep, Math.hypot(p.x - previous.x, p.z - previous.z));
    minY = Math.min(minY, p.y);
    previous.copy(p);
  }
  return {
    reached: target.hits.length > 0,
    seconds: steps * DT,
    maxPenetration,
    maxStep,
    minY,
    respawns: walker.motor.respawns,
    hits: target.hits.length,
  };
}

const CASES: readonly (readonly [
  string,
  readonly [number, number, number],
  readonly [number, number, number],
])[] = [
  ['in the open yard', [0, 0, 6], [7, 0, -6]],
  ['behind the control room desk (south door)', [0, 0, 6], [0, 0, -21.5]],
  ['in the west annex (round the control room)', [-5, 0, 6], [-16, 0, -20]],
  ['up on the catwalk (stairs or ramp)', [-10, 0, 0], [-22.25, 2.5, 3]],
  ['under the catwalk', [-10, 0, 6], [-22.6, 0, 0]],
  ['on the loading dock (its ramp)', [0, 0, 12], [0, 0.9, 22]],
  ['in the loading bay behind the truck', [0, 0, 10], [-20, 0, 22]],
  ['behind the generator (corridor door or the hall)', [10, 0, 0], [19.5, 0, -22.5]],
  ['at the end of the service corridor', [8, 0, 0], [14.7, 0, -20]],
  ['beside the shipping container', [-12, 0, 8], [-6.8, 0, -7]],
];

describe('Walker movement in the facility', () => {
  for (const [name, from, to] of CASES) {
    it(`reaches and hits a target ${name}`, () => {
      const result = chase(from, to);
      expect(result.reached, `${name}: reached in ${result.seconds.toFixed(1)} s`).toBe(true);
      // Never through walls or floors, never teleporting, never falling out.
      expect(result.maxPenetration).toBeLessThan(0.05);
      expect(result.maxStep).toBeLessThanOrEqual(W.moveSpeed * DT * 1.05 + 1e-9);
      expect(result.minY).toBeGreaterThan(-0.05);
      expect(result.respawns).toBe(0);
    });
  }

  it('is deterministic: the same chase gives the same path', () => {
    const run = () => {
      const target = new TestTarget(0, -21.5);
      const t = enemyTestWorld({ targets: [target], world: facility.collision, level: FACILITY });
      const walker = t.manager.spawn('walker', [0, 0, 6], { patrol: false, alertTo: target });
      const path: number[] = [];
      for (let i = 0; i < 600; i++) {
        t.step();
        path.push(walker?.motor.position.x ?? 0, walker?.motor.position.z ?? 0);
      }
      return path;
    };
    expect(run()).toEqual(run());
  });

  it('turns smoothly: never faster than its turn speed', () => {
    const target = new TestTarget(-16, -20);
    const t = enemyTestWorld({ targets: [target], world: facility.collision, level: FACILITY });
    const walker = t.manager.spawn('walker', [-5, 0, 6], { patrol: false, alertTo: target });
    let maxTurn = 0;
    for (let i = 0; i < 1200; i++) {
      t.step();
      if (!walker) {
        break;
      }
      let d = Math.abs(walker.heading - walker.previousHeading);
      if (d > Math.PI) {
        d = Math.PI * 2 - d;
      }
      maxTurn = Math.max(maxTurn, d);
    }
    expect(maxTurn).toBeLessThanOrEqual(W.turnSpeed * DT + 1e-9);
  });

  it('turn rates are per second, not per step: the same at a 120 Hz fixed step', () => {
    // Alerted to a target behind it, it turns on the spot during its reaction time.
    const headingAfterHalfASecond = (dt: number) => {
      const target = new TestTarget(0, 8); // south; it faces north
      const t = enemyTestWorld({ targets: [target] });
      const walker = t.manager.spawn('walker', [0, 0, 0], {
        yaw: 0,
        patrol: false,
        alertTo: target,
      });
      for (let i = 0; i < Math.round(0.5 / dt); i++) {
        t.manager.fixedUpdate(dt);
        t.combat.fixedUpdate(dt);
      }
      return walker?.heading ?? Number.NaN;
    };
    expect(headingAfterHalfASecond(DT)).toBeCloseTo(W.turnSpeed * 0.5, 6);
    expect(headingAfterHalfASecond(1 / 120)).toBeCloseTo(W.turnSpeed * 0.5, 6);
  });

  it('a crowd spreads out instead of stacking, and still reaches the target', () => {
    const target = new TestTarget(0, -3);
    target.health = 10_000;
    const t = enemyTestWorld({ targets: [target], world: facility.collision, level: FACILITY });
    for (let i = 0; i < 8; i++) {
      t.manager.spawn('walker', [-6 + (i % 4) * 0.2, 0, 8 + Math.floor(i / 4) * 0.2], {
        patrol: false,
        alertTo: target,
      });
    }
    t.seconds(20);
    const positions = t.manager.enemies.map((e) => e.motor.position);
    let closest = Number.POSITIVE_INFINITY;
    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        const a = positions[i];
        const b = positions[j];
        if (a && b) {
          closest = Math.min(closest, Math.hypot(a.x - b.x, a.z - b.z));
        }
      }
    }
    expect(closest).toBeGreaterThan(W.body.radius); // never on top of each other
    expect(target.hits.length).toBeGreaterThan(0);
    for (const p of positions) {
      expect(penetration(p)).toBeLessThan(0.05);
    }
  });
});

describe('getting unstuck', () => {
  it('an obstacle the straight-line test cannot see: it gets stuck once, then takes the route', () => {
    // A 0.3 m kerb across the way: too high to step onto, too low for the knee-height rays, so
    // the straight line to the target looks clear. The route goes round through a gap.
    const world = new CollisionWorld([
      ...boxTriangles([-30, -1, -30], [30, 0, 30]),
      ...boxTriangles([-30, 0, 4.9], [6.5, 0.3, 5.1]),
      ...boxTriangles([9.5, 0, 4.9], [30, 0.3, 5.1]),
    ]);
    const level: LevelDefinition = {
      name: 'kerb',
      spawn: { position: [0, 0, 0], yaw: 0 },
      killPlaneY: -20,
      brushes: [],
      navigation: {
        nodes: [
          { id: 'near', position: [0, 0, 1] },
          { id: 'gap-in', position: [8, 0, 3] },
          { id: 'gap-out', position: [8, 0, 7] },
          { id: 'far', position: [0, 0, 9] },
        ],
        links: [
          { from: 'near', to: 'gap-in' },
          { from: 'gap-in', to: 'gap-out' },
          { from: 'gap-out', to: 'far' },
        ],
      },
    };
    const target = new TestTarget(0, 10);
    target.health = 10_000;
    const t = enemyTestWorld({ targets: [target], world, level });
    const walker = t.manager.spawn('walker', [0, 0, 0], { patrol: false, alertTo: target });
    let blocked = false;
    let throughGap = false;
    const reached = t.runUntil(() => {
      blocked ||= walker?.directBlocked ?? false;
      const p = walker?.motor.position;
      throughGap ||= p !== undefined && p.x > 6.5 && p.x < 9.5 && Math.abs(p.z - 5) < 0.2;
      return target.hits.length > 0;
    }, 40);
    expect(blocked, 'the straight walk failed first').toBe(true);
    expect(throughGap, 'then it went round through the gap').toBe(true);
    expect(reached).toBeGreaterThan(0);
    expect(walker?.motor.position.z).toBeGreaterThan(5.1); // on the target's side of the kerb
    // Past it, the block is lifted: a target in the open is chased straight again.
    expect(walker?.directBlocked).toBe(false);
    target.position.set(6, 0, 16);
    t.seconds(1);
    expect(walker?.navMode).toBe('direct');
  });
});
