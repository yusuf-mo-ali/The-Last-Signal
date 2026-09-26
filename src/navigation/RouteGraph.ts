/**
 * The level's route graph (D-013 "routes", D-042): authored nodes on walkable floor and the
 * straight walks between them. Enemies use it when they cannot walk straight at their target:
 * around walls, through doorways, up stairs and ramps. Browser-independent and deterministic.
 *
 * Small by design (tens of nodes): A* runs on preallocated typed arrays and allocates only the
 * returned path. The flow field of D-008 remains the plan if crowds or maps outgrow this.
 */

import { Vector3 } from 'three';
import type { NavGraphDefinition } from '../world/levels/types';

export interface RouteNode {
  readonly index: number;
  readonly id: string;
  /** Feet position. */
  readonly position: Vector3;
}

/** Height differences cost this much more than horizontal distance when ranking nearby nodes. */
const VERTICAL_WEIGHT = 3;

export class RouteGraph {
  readonly nodes: readonly RouteNode[];
  /** Outgoing links per node, as node indices. */
  private readonly neighbours: readonly (readonly number[])[];
  private readonly byId = new Map<string, number>();
  private readonly g: Float64Array;
  private readonly f: Float64Array;
  private readonly cameFrom: Int32Array;
  /** 0 = unseen, 1 = open, 2 = closed. */
  private readonly status: Uint8Array;
  private readonly order: number[] = [];

  constructor(definition: NavGraphDefinition) {
    this.nodes = definition.nodes.map((node, index) => {
      if (this.byId.has(node.id)) {
        throw new Error(`Route graph: duplicate node "${node.id}"`);
      }
      this.byId.set(node.id, index);
      return { index, id: node.id, position: new Vector3(...node.position) };
    });
    const neighbours: number[][] = this.nodes.map(() => []);
    for (const link of definition.links) {
      const from = this.byId.get(link.from);
      const to = this.byId.get(link.to);
      if (from === undefined || to === undefined) {
        throw new Error(`Route graph: link ${link.from} → ${link.to} names an unknown node`);
      }
      if (from === to) {
        throw new Error(`Route graph: link ${link.from} → ${link.to} is a loop`);
      }
      neighbours[from]?.push(to);
      if (!link.oneWay) {
        neighbours[to]?.push(from);
      }
    }
    this.neighbours = neighbours;
    const n = this.nodes.length;
    this.g = new Float64Array(n);
    this.f = new Float64Array(n);
    this.cameFrom = new Int32Array(n);
    this.status = new Uint8Array(n);
  }

  get size(): number {
    return this.nodes.length;
  }

  indexOf(id: string): number {
    const index = this.byId.get(id);
    if (index === undefined) {
      throw new Error(`Route graph: unknown node "${id}"`);
    }
    return index;
  }

  neighboursOf(index: number): readonly number[] {
    return this.neighbours[index] ?? [];
  }

  /**
   * The shortest route from node `start` to node `goal`, as node indices including both ends, or
   * null when the goal cannot be reached. Ties resolve to the lower node index, so the same query
   * always returns the same route.
   */
  findPath(start: number, goal: number): number[] | null {
    const n = this.nodes.length;
    if (start < 0 || start >= n || goal < 0 || goal >= n) {
      return null;
    }
    const { g, f, cameFrom, status } = this;
    status.fill(0);
    g.fill(Number.POSITIVE_INFINITY);
    const goalPosition = this.position(goal);
    g[start] = 0;
    f[start] = this.position(start).distanceTo(goalPosition);
    cameFrom[start] = -1;
    status[start] = 1;
    for (;;) {
      // Open node with the lowest f (lowest index on a tie): the graph is tiny, a scan is cheap.
      let current = -1;
      let best = Number.POSITIVE_INFINITY;
      for (let i = 0; i < n; i++) {
        const fi = f[i] ?? Number.POSITIVE_INFINITY;
        if (status[i] === 1 && fi < best) {
          best = fi;
          current = i;
        }
      }
      if (current < 0) {
        return null;
      }
      if (current === goal) {
        return this.reconstruct(goal);
      }
      status[current] = 2;
      const from = this.position(current);
      const gCurrent = g[current] ?? Number.POSITIVE_INFINITY;
      for (const next of this.neighboursOf(current)) {
        if (status[next] === 2) {
          continue;
        }
        const tentative = gCurrent + from.distanceTo(this.position(next));
        if (tentative < (g[next] ?? Number.POSITIVE_INFINITY)) {
          g[next] = tentative;
          f[next] = tentative + this.position(next).distanceTo(goalPosition);
          cameFrom[next] = current;
          status[next] = 1;
        }
      }
    }
  }

  /**
   * Node indices ordered by how near they are to `position` (height differences weigh more, so a
   * node on the same level ranks first). Writes into and returns `out` (at most `count` entries).
   */
  nearest(position: Vector3, count: number, out: number[] = []): number[] {
    const order = this.order;
    order.length = 0;
    for (let i = 0; i < this.nodes.length; i++) {
      order.push(i);
    }
    const score = (i: number): number => {
      const p = this.position(i);
      return (
        Math.hypot(p.x - position.x, p.z - position.z) +
        Math.abs(p.y - position.y) * VERTICAL_WEIGHT
      );
    };
    order.sort((a, b) => score(a) - score(b) || a - b);
    out.length = 0;
    for (let i = 0; i < Math.min(count, order.length); i++) {
      out.push(order[i] ?? 0);
    }
    return out;
  }

  /** True if every node can reach every other node. */
  isConnected(): boolean {
    for (let i = 1; i < this.nodes.length; i++) {
      if (!this.findPath(0, i) || !this.findPath(i, 0)) {
        return false;
      }
    }
    return true;
  }

  position(index: number): Vector3 {
    const node = this.nodes[index];
    if (!node) {
      throw new RangeError(`Route graph: no node ${index}`);
    }
    return node.position;
  }

  private reconstruct(goal: number): number[] {
    const path: number[] = [];
    for (let at = goal; at >= 0; at = this.cameFrom[at] ?? -1) {
      path.push(at);
    }
    return path.reverse();
  }
}
