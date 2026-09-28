/**
 * Fair spawn points (D-044) in the Phase 1 facility: never close to the player, never in view (a
 * point behind a wall is fine), room for every body, spread out, biased on request, and the
 * reserved elevated point never used.
 */

import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { DEFAULT_ROSTER, type ImplementedEnemyId } from '../config/enemies';
import { WAVE_RULES } from '../config/waves';
import { enemyTestWorld, TestTarget } from '../enemies/testWorld';
import { Rng } from '../utils/Rng';
import { FACILITY, FACILITY_SPAWN_POINTS } from '../world/levels/facility';
import { World } from '../world/World';
import { SpawnDirector, type SpawnViewer } from './SpawnDirector';

const facility = new World(FACILITY);

function director(seed = 'spawns') {
  const t = enemyTestWorld({
    targets: [new TestTarget(0, 14)],
    world: facility.collision,
    level: FACILITY,
  });
  const spawns = new SpawnDirector({
    points: FACILITY_SPAWN_POINTS,
    canStand: (a, at) => t.manager.canStand(a, at),
    lineOfSight: (from, to) => t.manager.lines.lineOfSight(from, to),
    walkable: (from, to, r) => t.manager.lines.walkable(from, to, r),
    rng: new Rng(seed),
  });
  return { t, spawns };
}

/** A viewer at feet (x, z) with the player's eye height, looking along `yaw`. */
function viewer(x: number, z: number, yaw = 0, fovDeg = 100): SpawnViewer {
  return { eye: new Vector3(x, 1.62, z), yaw, fovDeg };
}

const byId = (id: string) => {
  const p = FACILITY_SPAWN_POINTS.find((s) => s.id === id);
  if (!p) {
    throw new Error(id);
  }
  return p;
};

describe('SpawnDirector: eligibility', () => {
  it('too close: within 12 m of the player', () => {
    const { spawns } = director();
    const p = byId('yard-far-e'); // (19, 0, 2)
    expect(spawns.status(p, viewer(12, 2, Math.PI / 2))).toBe('tooClose');
    expect(spawns.status(p, viewer(0, 2, Math.PI / 2))).not.toBe('tooClose');
  });

  it('in view: in front and in sight; behind the player or behind a wall is fine', () => {
    const { spawns } = director();
    const yardNw = byId('yard-nw'); // (-14, 0, -9), open yard
    // From the spawn (0, 14): facing north-west toward it → in view; facing south → not.
    const toward = Math.atan2(-(-14 - 0), -(-9 - 14));
    expect(spawns.status(yardNw, viewer(0, 14, toward))).toBe('inView');
    expect(spawns.status(yardNw, viewer(0, 14, toward + Math.PI))).toBe('eligible');
    // A control-room corner: straight ahead of a player looking north, but behind its wall.
    expect(spawns.status(byId('control-nw'), viewer(0, 14, 0))).toBe('eligible');
    expect(spawns.inView(byId('control-nw'), viewer(0, 14, 0))).toBe(false);
  });

  it('the view cone includes a margin beyond half the field of view', () => {
    const { spawns } = director();
    const yardNw = byId('yard-nw'); // in plain sight when faced from the spawn
    const toward = Math.atan2(14, 23);
    const deg = Math.PI / 180;
    const half = 100 / 2; // the helper's FOV
    // Turned away by more than half the FOV but inside the margin: still counts as seen.
    const insideMargin = (half + WAVE_RULES.spawn.viewMarginDeg / 2) * deg;
    expect(spawns.status(yardNw, viewer(0, 14, toward + insideMargin))).toBe('inView');
    expect(spawns.status(yardNw, viewer(0, 14, toward - insideMargin))).toBe('inView');
    // Beyond the margin: out of view.
    const beyond = (half + WAVE_RULES.spawn.viewMarginDeg + 5) * deg;
    expect(spawns.status(yardNw, viewer(0, 14, toward + beyond))).toBe('eligible');
  });

  it('a relaxed pick ignores the view rule, never the distance', () => {
    const { spawns } = director();
    const yardNw = byId('yard-nw');
    const toward = Math.atan2(14, 23);
    expect(spawns.status(yardNw, viewer(0, 14, toward), 'walker', true)).toBe('eligible');
    expect(spawns.status(byId('yard-far-e'), viewer(12, 2), 'walker', true)).toBe('tooClose');
  });

  it('the elevated point is reserved for adaptive content', () => {
    const { spawns } = director();
    expect(spawns.status(byId('catwalk'), viewer(0, 14, Math.PI))).toBe('reserved');
  });
});

describe('SpawnDirector: picks', () => {
  it('never picks a point that is too close or in view, from many places and facings', () => {
    const { spawns } = director();
    const rng = new Rng('views');
    for (let i = 0; i < 300; i++) {
      const v = viewer(rng.range(-20, 20), rng.range(-20, 20), rng.range(-Math.PI, Math.PI));
      const pick = spawns.pick(['walker', 'runner'], v);
      if (!pick) {
        continue;
      }
      const [x, , z] = pick.point.position;
      expect(Math.hypot(x - v.eye.x, z - v.eye.z)).toBeGreaterThanOrEqual(
        WAVE_RULES.spawn.minDistance,
      );
      expect(spawns.inView(pick.point, v)).toBe(false);
      expect(pick.point.tags ?? []).not.toContain('elevated');
    }
  });

  it('places every member of a group where its body fits, apart from each other', () => {
    const { t, spawns } = director();
    const group: ImplementedEnemyId[] = ['tank', 'tank', 'runner', 'screamer'];
    for (let i = 0; i < 30; i++) {
      const pick = spawns.pick(group, viewer(0, 14, 0));
      expect(pick).not.toBeNull();
      const positions = pick?.positions ?? [];
      expect(positions).toHaveLength(group.length);
      positions.forEach((p, k) => {
        expect(t.manager.canStand(group[k] ?? 'walker', p)).toBe(true);
      });
      for (let a = 0; a < positions.length; a++) {
        for (let b = a + 1; b < positions.length; b++) {
          expect(positions[a]?.distanceTo(positions[b] ?? new Vector3())).toBeGreaterThan(1);
        }
      }
    }
  });

  it('group members only stand where they could walk from the point (no slot behind a wall)', () => {
    const { t } = director();
    const blocked = new SpawnDirector({
      points: FACILITY_SPAWN_POINTS,
      canStand: (a, at) => t.manager.canStand(a, at),
      lineOfSight: (from, to) => t.manager.lines.lineOfSight(from, to),
      walkable: () => false, // every ring slot is cut off from its point
      rng: new Rng('walls'),
    });
    // A single enemy stands on the point itself; a pair needs a ring slot, and none is reachable.
    expect(blocked.pick(['walker'], viewer(0, 14, 0))).not.toBeNull();
    expect(blocked.pick(['walker', 'walker'], viewer(0, 14, 0))).toBeNull();
  });

  it('spreads groups out: the same point rarely twice in a row', () => {
    const { spawns } = director();
    let repeats = 0;
    let last = '';
    for (let i = 0; i < 200; i++) {
      const id = spawns.pick(['walker'], viewer(0, 14, 0))?.point.id ?? '';
      if (id === last) {
        repeats++;
      }
      last = id;
    }
    expect(repeats).toBeLessThan(20);
  });

  it('favours biased regions', () => {
    const plain = director('a').spawns;
    const biased = director('a').spawns;
    let east = 0;
    let eastBiased = 0;
    // Facing south from the spawn: the east points are behind the player, so eligible.
    const v = viewer(0, 14, Math.PI);
    expect(byId('yard-far-e').region).toBe('east');
    expect(plain.status(byId('yard-far-e'), v, 'walker')).toBe('eligible');
    for (let i = 0; i < 300; i++) {
      if (plain.pick(['walker'], v)?.point.region === 'east') {
        east++;
      }
      if (biased.pick(['walker'], v, ['east'])?.point.region === 'east') {
        eastBiased++;
      }
    }
    expect(east).toBeGreaterThan(0);
    expect(eastBiased).toBeGreaterThan(east * 1.4);
  });

  it('is deterministic for a seed', () => {
    const a = director('same').spawns;
    const b = director('same').spawns;
    for (let i = 0; i < 20; i++) {
      expect(a.pick(['walker'], viewer(0, 14, 0))?.point.id).toBe(
        b.pick(['walker'], viewer(0, 14, 0))?.point.id,
      );
    }
  });

  it('returns null when nothing is eligible (the caller defers)', () => {
    const t = enemyTestWorld({ world: facility.collision, level: FACILITY });
    const spawns = new SpawnDirector({
      points: [byId('yard-far-e')],
      canStand: (a, at) => t.manager.canStand(a, at),
      lineOfSight: (from, to) => t.manager.lines.lineOfSight(from, to),
      walkable: (from, to, r) => t.manager.lines.walkable(from, to, r),
      rng: new Rng('x'),
    });
    expect(spawns.pick(['walker'], viewer(12, 2))).toBeNull();
  });
});

describe('the facility spawn points', () => {
  it('every normal point fits every roster body, and has a straight walk to a route node', () => {
    const { t } = director();
    const nodes = FACILITY.navigation?.nodes ?? [];
    for (const point of FACILITY_SPAWN_POINTS) {
      const at = new Vector3(...point.position);
      for (const a of DEFAULT_ROSTER) {
        expect(t.manager.canStand(a, at), `${point.id} ${a}`).toBe(true);
      }
      const reachable = nodes.some((n) =>
        t.manager.lines.walkable(at, new Vector3(...n.position), 0.5),
      );
      expect(reachable, point.id).toBe(true);
    }
  });

  it('all at least 12 m from the player spawn; ids unique; regions set', () => {
    const [sx, , sz] = FACILITY.spawn.position;
    const ids = new Set<string>();
    for (const point of FACILITY_SPAWN_POINTS) {
      expect(
        Math.hypot(point.position[0] - sx, point.position[2] - sz),
        point.id,
      ).toBeGreaterThanOrEqual(WAVE_RULES.spawn.minDistance);
      ids.add(point.id);
    }
    expect(ids.size).toBe(FACILITY_SPAWN_POINTS.length);
    expect(
      FACILITY_SPAWN_POINTS.filter((p) => !p.tags?.includes('elevated')).length,
    ).toBeGreaterThanOrEqual(10);
  });
});
