/**
 * The Climber (D-047): the only body that climbs. Its route takes the facility's climb links (and
 * nobody else's ever does), it goes up a wall and over the top onto the player's perch, it can be
 * knocked or shot off the wall, it never attacks from it, and only it may enter at an elevated
 * spawn point, never while the player is up there.
 */

import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { ENEMY_STATS, IMPLEMENTED_ENEMY_IDS } from '../config/enemies';
import { RouteGraph } from '../navigation/RouteGraph';
import { NO_INTENT, PlayerMotor } from '../player/PlayerMotor';
import { enemyMovementConfig } from './body';
import { Rng } from '../utils/Rng';
import { SpawnDirector, groupClimbs, type SpawnViewer } from '../waves/SpawnDirector';
import { CATWALK_HEIGHT, FACILITY, FACILITY_NAVIGATION } from '../world/levels/facility';
import { World } from '../world/World';
import { DT, enemyTestWorld, TestTarget } from './testWorld';

const facility = () => new World(FACILITY);
const graph = new RouteGraph(FACILITY_NAVIGATION);
const WITHOUT_CLIMBS = new RouteGraph({
  ...FACILITY_NAVIGATION,
  links: FACILITY_NAVIGATION.links.filter((l) => !l.climb),
});
const ids = (route: number[] | null) => (route ?? []).map((i) => graph.nodes[i]?.id);
const node = (id: string) => graph.indexOf(id);

/** A target standing on the catwalk (or anywhere). */
function targetAt(x: number, y: number, z: number): TestTarget {
  const t = new TestTarget(x, z);
  t.position.y = y;
  t.vulnerable = false;
  return t;
}

describe('climb links in the route graph', () => {
  it('only a climbing body’s routes use them; everyone else’s are exactly as before', () => {
    expect(ids(graph.findPath(node('yard-w'), node('catwalk-mid'), true))).toEqual([
      'yard-w',
      'catwalk-foot',
      'catwalk-mid',
    ]);
    for (let a = 0; a < graph.size; a++) {
      for (let b = 0; b < graph.size; b++) {
        expect(graph.findPath(a, b), `${a} → ${b}`).toEqual(WITHOUT_CLIMBS.findPath(a, b));
      }
    }
    for (const id of IMPLEMENTED_ENEMY_IDS) {
      expect(ENEMY_STATS[id].climb !== undefined, id).toBe(id === 'climber');
    }
  });

  it('every climb is clear for a Climber body: straight up, across, and it lands on the top', () => {
    const world = facility();
    const config = ENEMY_STATS.climber;
    for (const link of FACILITY_NAVIGATION.links.filter((l) => l.climb)) {
      const foot = graph.position(node(link.from));
      const top = graph.position(node(link.to));
      const over = Math.max(top.y, link.over ?? top.y) + 0.05;
      const motor = new PlayerMotor(world.collision, enemyMovementConfig(config), {
        position: foot.clone(),
        killPlaneY: FACILITY.killPlaneY,
      });
      const probe = new Vector3();
      // Every point of the path: nothing pushes the body (no overlap with the level).
      for (let k = 0; k <= 20; k++) {
        probe.set(foot.x, foot.y + ((over - foot.y) * k) / 20, foot.z);
        motor.teleport(probe);
        expect(motor.position.distanceTo(probe), `${link.from} up ${k}`).toBeLessThan(0.02);
      }
      for (let k = 0; k <= 20; k++) {
        probe.set(foot.x + ((top.x - foot.x) * k) / 20, over, foot.z + ((top.z - foot.z) * k) / 20);
        motor.teleport(probe);
        expect(motor.position.distanceTo(probe), `${link.from} over ${k}`).toBeLessThan(0.02);
      }
      // Released over the top, it settles on the ledge.
      motor.teleport(probe.set(top.x, over, top.z));
      for (let i = 0; i < 60; i++) {
        motor.step(NO_INTENT, 0, DT);
      }
      expect(Math.abs(motor.position.y - top.y), `${link.to} landing`).toBeLessThan(0.1);
    }
  });
});

describe('the Climber on a wall', () => {
  const setup = () => {
    const world = facility();
    const target = targetAt(-22.25, CATWALK_HEIGHT, 1);
    const t = enemyTestWorld({ level: FACILITY, world: world.collision, targets: [target] });
    return { t, target };
  };

  it('comes up the wall onto the catwalk, faster than a Walker takes the stairs', () => {
    const { t, target } = setup();
    const climber = t.manager.spawn('climber', [-9, 0, 4], { patrol: false, alertTo: target });
    let climbed = false;
    let maxClimbY = 0;
    const steps = t.runUntil(() => {
      if (climber?.climbing) {
        climbed = true;
        maxClimbY = Math.max(maxClimbY, climber.motor.position.y);
      }
      return (climber?.motor.position.y ?? 0) > CATWALK_HEIGHT - 0.1 && !climber?.climbing;
    }, 30);
    expect(climbed).toBe(true);
    expect(maxClimbY).toBeGreaterThan(CATWALK_HEIGHT - 0.05);
    expect(climber?.motor.position.y).toBeCloseTo(CATWALK_HEIGHT, 1);
    // The Walker from the same spot has to go round by the stairs or the ramp.
    const w = setup();
    const walker = w.t.manager.spawn('walker', [-9, 0, 4], { patrol: false, alertTo: w.target });
    w.t.runUntil(() => (walker?.motor.position.y ?? 0) > CATWALK_HEIGHT - 0.1, 60);
    expect(walker?.climbing).toBeNull();
    expect(steps * DT).toBeLessThan(15);
  });

  it('cannot attack while climbing; a stagger knocks it off; shot dead, it lies at the foot', () => {
    const { t, target } = setup();
    const climber = t.manager.spawn('climber', [-19.4, 0, 3], { patrol: false, alertTo: target });
    t.runUntil(() => (climber?.motor.position.y ?? 0) > 1.2, 20);
    expect(climber?.climbing).not.toBeNull();
    expect(t.of('attackStarted').filter((e) => e.id === climber?.id)).toEqual([]);
    // A body shot staggers it off the wall: it falls to the ground.
    t.combat.applyHit({
      targetId: climber?.id ?? '',
      zone: 'TORSO',
      weaponId: 'pistol',
      source: 'shot',
      quick: false,
      baseDamage: 30,
      falloff: 1,
      headshotMultiplier: 1,
      point: [0, 0, 0],
      direction: [0, 0, 1],
      distance: 10,
    });
    t.seconds(0.1);
    expect(climber?.climbing).toBeNull();
    // It drops to the ground within its stagger (then it goes back up: the climb is its route).
    const fallen = t.runUntil(() => (climber?.motor.position.y ?? 9) < 0.2, 1);
    expect(fallen * DT).toBeLessThan(ENEMY_STATS.climber.staggerDuration);

    // Again, and this time killed on the wall: the body is at the foot, not in the air.
    t.runUntil(() => (climber?.motor.position.y ?? 0) > 1.2 && climber?.climbing !== null, 20);
    t.manager.kill(climber?.id ?? '');
    t.step(2);
    expect(climber?.motor.position.y).toBeLessThan(0.2);
  });
});

describe('elevated spawn points (D-043, D-047)', () => {
  const director = () =>
    new SpawnDirector({
      points: FACILITY.spawnPoints ?? [],
      canStand: () => true,
      lineOfSight: () => false,
      walkable: () => true,
      rng: new Rng('elevated'),
    });
  const viewer = (y: number): SpawnViewer => ({
    eye: new Vector3(10, y + 1.6, 10),
    yaw: 0,
    fovDeg: 100,
  });
  const catwalk = (FACILITY.spawnPoints ?? []).find((p) => p.tags?.includes('elevated'));

  it('only an all-Climber group may use one, and never while the player is up there', () => {
    expect(catwalk).toBeDefined();
    const d = director();
    if (!catwalk) {
      return;
    }
    expect(groupClimbs(['climber', 'climber'])).toBe(true);
    expect(groupClimbs(['climber', 'walker'])).toBe(false);
    expect(d.status(catwalk, viewer(0), 'walker', false, false)).toBe('reserved');
    expect(d.status(catwalk, viewer(0), 'climber', false, true)).toBe('eligible');
    expect(d.status(catwalk, viewer(CATWALK_HEIGHT), 'climber', false, true)).toBe('reserved');
    // Over many draws: never for others, sometimes for Climbers.
    let used = 0;
    for (let i = 0; i < 300; i++) {
      expect(d.pick(['walker'], viewer(0))?.point.id).not.toBe(catwalk.id);
      expect(d.pick(['climber'], viewer(CATWALK_HEIGHT))?.point.id).not.toBe(catwalk.id);
      if (d.pick(['climber'], viewer(0))?.point.id === catwalk.id) {
        used++;
      }
    }
    expect(used).toBeGreaterThan(0);
  });
});
