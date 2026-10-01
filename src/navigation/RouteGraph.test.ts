import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { NavGraphDefinition } from '../world/levels/types';
import { RouteGraph } from './RouteGraph';

/**
 * a(0,0) ─ b(7,0) ─ q(14,0) ─ c(20,0) ──► f(40,0)   (c → f is one-way)
 *  │ ╲                         │
 *  │   y(10,−40) far off ──────┘ (a–y–c: fewer hops, much longer)
 * d(0,10) ──────────────── e(20,5) ─ c
 * g(1, y = 3, 0): up high, linked to a
 */
const DEF: NavGraphDefinition = {
  nodes: [
    { id: 'a', position: [0, 0, 0] },
    { id: 'b', position: [7, 0, 0] },
    { id: 'q', position: [14, 0, 0] },
    { id: 'c', position: [20, 0, 0] },
    { id: 'd', position: [0, 0, 10] },
    { id: 'e', position: [20, 0, 5] },
    { id: 'y', position: [10, 0, -40] },
    { id: 'f', position: [40, 0, 0] },
    { id: 'g', position: [1, 3, 0] },
  ],
  links: [
    { from: 'a', to: 'b' },
    { from: 'b', to: 'q' },
    { from: 'q', to: 'c' },
    { from: 'a', to: 'y' },
    { from: 'y', to: 'c' },
    { from: 'a', to: 'd' },
    { from: 'd', to: 'e' },
    { from: 'e', to: 'c' },
    { from: 'c', to: 'f', oneWay: true },
    { from: 'a', to: 'g' },
  ],
};

const ids = (graph: RouteGraph, path: number[] | null) =>
  path?.map((i) => graph.nodes[i]?.id) ?? null;

describe('RouteGraph', () => {
  const graph = new RouteGraph(DEF);

  it('finds the shortest route (distance, not hops)', () => {
    // Three short hops beat two long ones.
    expect(ids(graph, graph.findPath(graph.indexOf('a'), graph.indexOf('c')))).toEqual([
      'a',
      'b',
      'q',
      'c',
    ]);
    expect(ids(graph, graph.findPath(graph.indexOf('d'), graph.indexOf('c')))).toEqual([
      'd',
      'e',
      'c',
    ]);
  });

  it('a route to itself is the node alone', () => {
    expect(ids(graph, graph.findPath(3, 3))).toEqual(['c']);
  });

  it('is exact, not greedy: a detour that ends right beside the goal does not win', () => {
    // s → x → t is 13.3 m and x is 3 m from the goal; s → y → t is 10.1 m but y is 7 m from it.
    // A search that trusts closeness to the goal over distance walked takes the detour.
    const trap = new RouteGraph({
      nodes: [
        { id: 's', position: [0, 0, 0] },
        { id: 'x', position: [9.9, 0, 3] },
        { id: 'y', position: [3, 0, -0.5] },
        { id: 't', position: [10, 0, 0] },
      ],
      links: [
        { from: 's', to: 'x' },
        { from: 'x', to: 't' },
        { from: 's', to: 'y' },
        { from: 'y', to: 't' },
      ],
    });
    expect(ids(trap, trap.findPath(0, 3))).toEqual(['s', 'y', 't']);
  });

  it('respects one-way links', () => {
    expect(ids(graph, graph.findPath(graph.indexOf('a'), graph.indexOf('f')))).toEqual([
      'a',
      'b',
      'q',
      'c',
      'f',
    ]);
    expect(graph.findPath(graph.indexOf('f'), graph.indexOf('a'))).toBeNull();
    expect(graph.isConnected()).toBe(false);
  });

  it('returns null for out-of-range nodes', () => {
    expect(graph.findPath(-1, 0)).toBeNull();
    expect(graph.findPath(0, 99)).toBeNull();
  });

  it('is deterministic: equal-length routes always resolve the same way', () => {
    const square = new RouteGraph({
      nodes: [
        { id: 's', position: [0, 0, 0] },
        { id: 'up', position: [5, 0, -5] },
        { id: 'down', position: [5, 0, 5] },
        { id: 't', position: [10, 0, 0] },
      ],
      links: [
        { from: 's', to: 'up' },
        { from: 's', to: 'down' },
        { from: 'up', to: 't' },
        { from: 'down', to: 't' },
      ],
    });
    const first = ids(square, square.findPath(0, 3));
    for (let i = 0; i < 5; i++) {
      expect(ids(square, square.findPath(0, 3))).toEqual(first);
    }
    expect(first).toEqual(['s', 'up', 't']); // the lower index wins the tie
  });

  it('ranks nearby nodes, preferring the same level', () => {
    // g is the closest horizontally (0.2 m) but 3 m up: it ranks after a and b on the ground.
    expect(ids(graph, graph.nearest(new Vector3(1.2, 0, 0), 3))).toEqual(['a', 'b', 'g']);
    // Standing up there, g is first.
    expect(ids(graph, graph.nearest(new Vector3(1, 3, 0), 1))).toEqual(['g']);
    expect(graph.nearest(new Vector3(), 100)).toHaveLength(DEF.nodes.length);
  });

  it('rejects broken definitions', () => {
    expect(
      () =>
        new RouteGraph({
          nodes: [
            { id: 'x', position: [0, 0, 0] },
            { id: 'x', position: [1, 0, 0] },
          ],
          links: [],
        }),
    ).toThrow(/duplicate/);
    expect(
      () =>
        new RouteGraph({
          nodes: [{ id: 'x', position: [0, 0, 0] }],
          links: [{ from: 'x', to: 'y' }],
        }),
    ).toThrow(/unknown node/);
    expect(
      () =>
        new RouteGraph({
          nodes: [{ id: 'x', position: [0, 0, 0] }],
          links: [{ from: 'x', to: 'x' }],
        }),
    ).toThrow(/loop/);
    expect(() => graph.indexOf('nope')).toThrow(/unknown node/);
  });
});
