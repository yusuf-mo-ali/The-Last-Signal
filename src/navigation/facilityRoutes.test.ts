/**
 * The authored route graph of the facility (D-042) is only useful if an enemy body can really
 * walk it. These tests check every node and walk every link, both ways, with a Walker's capsule
 * through the real collision, so a node too close to a wall or a link clipping an obstacle fails
 * here rather than as a zombie stuck in play.
 */

import type { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { ENEMY_STATS } from '../config/enemies';
import { enemyMovementConfig } from '../enemies/body';
import { NO_INTENT, PlayerMotor } from '../player/PlayerMotor';
import { FACILITY, FACILITY_NAVIGATION } from '../world/levels/facility';
import { World } from '../world/World';
import { RouteGraph } from './RouteGraph';

const DT = 1 / 60;
const WALKER = ENEMY_STATS.walker;
const world = new World(FACILITY);
const graph = new RouteGraph(FACILITY_NAVIGATION);

function body(at: Vector3): PlayerMotor {
  return new PlayerMotor(world.collision, enemyMovementConfig(WALKER), {
    position: at.clone(),
    killPlaneY: FACILITY.killPlaneY,
  });
}

/** Walks a Walker body straight at `to`; returns where it ended and how long it took. */
function walk(from: Vector3, to: Vector3) {
  const motor = body(from);
  const length = Math.hypot(to.x - from.x, to.z - from.z);
  const maxSteps = Math.ceil((length / WALKER.moveSpeed + 3) / DT);
  let steps = 0;
  for (; steps < maxSteps; steps++) {
    const dx = to.x - motor.position.x;
    const dz = to.z - motor.position.z;
    if (Math.hypot(dx, dz) < 0.3) {
      break;
    }
    motor.step({ ...NO_INTENT, forward: 1 }, Math.atan2(-dx, -dz), DT);
  }
  return { position: motor.position.clone(), seconds: steps * DT, respawns: motor.respawns };
}

describe('facility route graph', () => {
  it('has unique ids, valid links, and every node reaches every other', () => {
    expect(graph.size).toBe(FACILITY_NAVIGATION.nodes.length);
    expect(graph.isConnected()).toBe(true);
  });

  it('every node stands on walkable floor with room for the body', () => {
    for (const node of graph.nodes) {
      const motor = body(node.position);
      expect(motor.grounded, node.id).toBe(true);
      expect(Math.abs(motor.position.y - node.position.y), node.id).toBeLessThan(0.1);
      // Teleporting resolves overlaps: a node too close to a wall would have been pushed away.
      expect(
        Math.hypot(motor.position.x - node.position.x, motor.position.z - node.position.z),
        node.id,
      ).toBeLessThan(0.01);
      // Idle for a second: it stays put.
      for (let i = 0; i < 60; i++) {
        motor.step(NO_INTENT, 0, DT);
      }
      expect(motor.position.distanceTo(node.position), node.id).toBeLessThan(0.1);
    }
  });

  it('every link can be walked both ways by a Walker body, arriving at the right height', () => {
    for (const link of FACILITY_NAVIGATION.links) {
      for (const [a, b] of [
        [link.from, link.to],
        [link.to, link.from],
      ] as const) {
        const from = graph.position(graph.indexOf(a));
        const to = graph.position(graph.indexOf(b));
        const result = walk(from, to);
        const label = `${a} → ${b}`;
        expect(
          Math.hypot(result.position.x - to.x, result.position.z - to.z),
          `${label}: arrival`,
        ).toBeLessThan(0.3);
        expect(Math.abs(result.position.y - to.y), `${label}: height`).toBeLessThan(0.15);
        expect(result.respawns, label).toBe(0);
        // No detour: straight walking takes about length / speed.
        expect(result.seconds, `${label}: time`).toBeLessThan(
          from.distanceTo(to) / WALKER.moveSpeed + 1.5,
        );
      }
    }
  });

  it('routes between distant areas pass through the expected doorways, stairs and ramps', () => {
    const route = (a: string, b: string) =>
      (graph.findPath(graph.indexOf(a), graph.indexOf(b)) ?? []).map((i) => graph.nodes[i]?.id);
    // Into the control room through the south door.
    expect(route('yard-s', 'cr-c')).toContain('cr-door-in');
    // Onto the catwalk by the stairs or the ramp, never straight up.
    const up = route('yard-nw', 'catwalk-mid');
    expect(up.includes('stairs-top') || up.includes('catwalk-s')).toBe(true);
    // Onto the dock by its ramp.
    expect(route('yard-se', 'dock-w')).toEqual([
      'yard-se',
      'bay-e',
      'dock-ramp-bottom',
      'dock-e',
      'dock-w',
    ]);
    // Into the generator hall through the corridor door or its open south side.
    expect(route('corridor-mid', 'hall-nw')).toEqual([
      'corridor-mid',
      'hall-door',
      'hall-w',
      'hall-nw',
    ]);
  });
});
