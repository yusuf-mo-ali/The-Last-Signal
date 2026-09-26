/**
 * Test helpers for the enemy framework (imported by tests only): a small open world, a
 * controllable target, and an `EnemyManager` wired to a `CombatSystem`, with every enemy event
 * recorded. Not part of the game.
 */

import { Vector3 } from 'three';
import { CombatSystem } from '../combat/CombatSystem';
import type { EnemyRules } from '../config/enemies';
import { ENEMY_RULES } from '../config/enemies';
import { CollisionWorld } from '../physics/CollisionWorld';
import { Rng } from '../utils/Rng';
import { Hitscan } from '../weapons/hitscan';
import { boxTriangles } from '../world/levels/geometry';
import type { LevelDefinition } from '../world/levels/types';
import type { PickupManager } from '../world/PickupManager';
import { EnemyManager } from './EnemyManager';
import type { EnemyEvents } from './events';
import type { EnemyHit, EnemyTarget } from './types';

export const DT = 1 / 60;

/** A controllable target (stands in for the player). */
export class TestTarget implements EnemyTarget {
  readonly id: string;
  readonly position: Vector3;
  readonly eyeHeight = 1.62;
  readonly radius = 0.35;
  health = 100;
  readonly hits: EnemyHit[] = [];
  /** When false, hits are ignored (like the player outside WAVE_ACTIVE). */
  vulnerable = true;

  constructor(x = 0, z = 0, id = 'player') {
    this.id = id;
    this.position = new Vector3(x, 0, z);
  }

  isAlive(): boolean {
    return this.health > 0;
  }

  receiveHit(hit: EnemyHit): number {
    this.hits.push(hit);
    if (!this.vulnerable || this.health <= 0) {
      return 0;
    }
    const applied = Math.min(this.health, hit.amount);
    this.health -= applied;
    return applied;
  }
}

/**
 * A 60 × 60 m floor with a wall at z ∈ [−10.4, −10] for x ∈ [−30, 30] except a 3 m doorway at
 * x ∈ [−1.5, 1.5] (wall from y 0 to 3).
 */
export const TEST_WORLD_BRUSHES = [
  ...boxTriangles([-30, -1, -30], [30, 0, 30]),
  ...boxTriangles([-30, 0, -10.4], [-1.5, 3, -10]),
  ...boxTriangles([1.5, 0, -10.4], [30, 3, -10]),
];

export const TEST_LEVEL: LevelDefinition = {
  name: 'enemy test world',
  spawn: { position: [0, 0, 0], yaw: 0 },
  killPlaneY: -20,
  brushes: [],
  navigation: {
    nodes: [
      { id: 'south', position: [0, 0, -5] },
      { id: 'door', position: [0, 0, -10.2] },
      { id: 'north', position: [0, 0, -15] },
    ],
    links: [
      { from: 'south', to: 'door' },
      { from: 'door', to: 'north' },
    ],
  },
};

type Recorded = {
  [K in keyof EnemyEvents]: { type: K; payload: EnemyEvents[K] };
}[keyof EnemyEvents];

export function enemyTestWorld(
  options: {
    targets?: TestTarget[];
    rules?: Partial<EnemyRules>;
    seed?: number | string;
    pickups?: PickupManager;
    level?: LevelDefinition;
    world?: CollisionWorld;
  } = {},
) {
  const world = options.world ?? new CollisionWorld(TEST_WORLD_BRUSHES);
  const hitscan = new Hitscan(world);
  const combat = new CombatSystem({ hitscan });
  const targets = options.targets ?? [new TestTarget(0, 10)];
  let active = true;
  const manager = new EnemyManager({
    world,
    level: options.level ?? TEST_LEVEL,
    combat,
    targets: () => targets,
    rng: new Rng(options.seed ?? 'enemies'),
    active: () => active,
    rules: { ...ENEMY_RULES, ...options.rules },
    strict: true,
    ...(options.pickups ? { pickups: options.pickups } : {}),
  });
  const events: Recorded[] = [];
  for (const type of [
    'spawned',
    'stateChanged',
    'targetAcquired',
    'targetLost',
    'attackStarted',
    'attackHit',
    'attackMissed',
    'attackCancelled',
    'staggered',
    'died',
    'despawned',
  ] as const) {
    manager.events.on(type, (payload: unknown) => {
      events.push({ type, payload } as Recorded);
    });
  }
  const step = (n = 1) => {
    for (let i = 0; i < n; i++) {
      manager.fixedUpdate(DT);
      combat.fixedUpdate(DT);
    }
  };
  const seconds = (s: number) => {
    step(Math.round(s * 60));
  };
  /** Steps until `until()` is true (or `max` seconds pass); returns the steps taken. */
  const runUntil = (until: () => boolean, max = 30): number => {
    for (let i = 0; i < max * 60; i++) {
      if (until()) {
        return i;
      }
      step();
    }
    return -1;
  };
  const of = <K extends keyof EnemyEvents>(type: K): EnemyEvents[K][] =>
    events.flatMap((e) => (e.type === type ? [e.payload as EnemyEvents[K]] : []));
  return {
    world,
    hitscan,
    combat,
    manager,
    targets,
    target: targets[0] ?? new TestTarget(),
    events,
    step,
    seconds,
    runUntil,
    of,
    setActive: (value: boolean) => {
      active = value;
    },
  };
}
