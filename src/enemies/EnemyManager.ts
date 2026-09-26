/**
 * Runs every enemy (plan §11, ARCHITECTURE §7.4, D-042): a fixed-step system that owns their
 * lifecycle and drives their brains. Generic: it never looks at an archetype id, only at config.
 *
 * Lifecycle, per enemy:
 *   spawn (pooled instance, unique id) → registered with the CombatSystem (rig + Health, exactly
 *   like a training dummy) → alive: think / update / move each step → killed through combat
 *   (`onKilled`): DEAD, drops rolled, body stays for `corpseTime` → despawned: unregistered from
 *   combat, returned to the pool. Despawning happens exactly once per spawn.
 *
 * Each fixed step (only while `active()` and not frozen):
 *   1. timers; `think` for the enemies whose turn it is (every `thinkInterval`, spread evenly
 *      over the steps by spawn order, so the cost is flat and never spikes on one step);
 *   2. `update` for every living enemy: exact timing (reaction, wind-up, strike, stagger) and
 *      the steering outputs;
 *   3. separation between enemies and from targets (pushes, never teleports);
 *   4. movement through the capsule motor (walls, stairs, ramps, gravity), turning at the
 *      archetype's rate; the hit volumes follow.
 * Combat's `damaged` (alert) and `staggered` events reach the brain immediately.
 *
 * Deterministic: fixed steps, step-counted think turns, seeded randomness; nothing depends on the
 * render frame rate. Browser-independent.
 */

import { Vector3 } from 'three';
import type { CombatSystem, KilledEvent } from '../combat/CombatSystem';
import { DROP_TABLES } from '../config/drops';
import {
  ENEMY_RULES,
  enemyConfig,
  type AiState,
  type EnemyArchetypeConfig,
  type EnemyArchetypeId,
  type EnemyRules,
} from '../config/enemies';
import { EventBus } from '../core/EventBus';
import type { FixedUpdateSystem } from '../core/Game';
import { bodyFits } from '../navigation/clearance';
import { LineTester } from '../navigation/LineTester';
import { RouteGraph } from '../navigation/RouteGraph';
import type { CollisionWorld } from '../physics/CollisionWorld';
import { Pool } from '../utils/Pool';
import type { Rng } from '../utils/Rng';
import { countDown } from '../weapons/timing';
import type { Vec3Tuple } from '../weapons/types';
import { rollDrops } from '../world/drops';
import type { LevelDefinition } from '../world/levels/types';
import type { PickupManager } from '../world/PickupManager';
import type { BrainContext, EnemyBrain } from './ai/brain';
import { BRAINS } from './ai/brains';
import { angleDelta, horizontalDistance } from './ai/meleeBrain';
import { Enemy } from './Enemy';
import type { EnemyEvents } from './events';
import type { EnemyTarget } from './types';

export interface SpawnOptions {
  readonly yaw?: number;
  /** Whether it may patrol while idle (default: yes, if its archetype patrols). */
  readonly patrol?: boolean;
  /** Knows about this target from the start (waves: the horde is drawn to the player). */
  readonly alertTo?: EnemyTarget;
}

export interface EnemyManagerOptions {
  readonly world: CollisionWorld;
  readonly level: LevelDefinition;
  readonly combat: CombatSystem;
  /** Everything enemies may target (the player). Read every step. */
  readonly targets: () => readonly EnemyTarget[];
  /** Seeded randomness for patrols and drops (D-014). */
  readonly rng: Rng;
  /** Whether enemies simulate this step (true while a run is being played). */
  readonly active: () => boolean;
  /** Where drops appear; without it, deaths drop nothing. */
  readonly pickups?: PickupManager;
  readonly rules?: EnemyRules;
  /** Throw on illegal AI transitions (tests and dev builds). */
  readonly strict?: boolean;
}

/** Counters for tests, debug tools and performance measurements. */
export interface EnemyStats {
  thinks: number;
  updates: number;
  moves: number;
  spawned: number;
  despawned: number;
}

const _goalNear: number[] = [];
const _probe = new Vector3();

export class EnemyManager implements FixedUpdateSystem {
  readonly events = new EventBus<EnemyEvents>();
  readonly lines: LineTester;
  readonly routes: RouteGraph | null;
  readonly stats: EnemyStats = { thinks: 0, updates: 0, moves: 0, spawned: 0, despawned: 0 };
  /** Debug: enemies stop thinking and moving (the rest of the game runs on). */
  frozen = false;

  private readonly world: CollisionWorld;
  private readonly level: LevelDefinition;
  private readonly combat: CombatSystem;
  private readonly targets: () => readonly EnemyTarget[];
  private readonly rng: Rng;
  private readonly active: () => boolean;
  private readonly pickups: PickupManager | undefined;
  private readonly rules: EnemyRules;
  private readonly strict: boolean;
  private readonly pools = new Map<EnemyArchetypeId, Pool<Enemy>>();
  private readonly byId = new Map<string, Enemy>();
  /** Registration order; replaced (not mutated) on change so iteration is always safe. */
  private list: readonly Enemy[] = [];
  private readonly unsubscribe: (() => void)[] = [];
  private counter = 0;
  private stepCount = 0;
  private thinkSteps = 0;
  private simTime = 0;
  private readonly goalCache = new Map<string, number>();
  private readonly context: BrainContext & {
    now: number;
    dt: number;
    targets: readonly EnemyTarget[];
  };

  constructor(options: EnemyManagerOptions) {
    this.world = options.world;
    this.level = options.level;
    this.combat = options.combat;
    this.targets = options.targets;
    this.rng = options.rng;
    this.active = options.active;
    this.pickups = options.pickups;
    this.rules = options.rules ?? ENEMY_RULES;
    this.strict = options.strict ?? false;
    this.lines = new LineTester(options.world, this.rules);
    this.routes = options.level.navigation ? new RouteGraph(options.level.navigation) : null;
    this.context = {
      now: 0,
      dt: 1 / 60,
      targets: [],
      lines: this.lines,
      routes: this.routes,
      rng: this.rng,
      rules: this.rules,
      events: this.events,
      goalNodeFor: (target) => this.goalNodeFor(target),
    };
    this.unsubscribe.push(
      this.combat.events.on('damaged', (event) => {
        const enemy = this.byId.get(event.targetId);
        if (enemy?.alive) {
          this.brainOf(enemy).onDamaged(enemy, this.context, this.nearestTarget(enemy));
        }
      }),
      this.combat.events.on('staggered', (event) => {
        const enemy = this.byId.get(event.targetId);
        if (enemy?.alive) {
          this.brainOf(enemy).onStaggered(enemy, this.context);
        }
      }),
    );
  }

  /** Every enemy in the world, living or a body, in spawn order. */
  get enemies(): readonly Enemy[] {
    return this.list;
  }

  get aliveCount(): number {
    let alive = 0;
    for (const enemy of this.list) {
      if (enemy.alive) {
        alive++;
      }
    }
    return alive;
  }

  /** Simulated seconds since the run began. */
  get now(): number {
    return this.simTime;
  }

  get(id: string): Enemy | undefined {
    return this.byId.get(id);
  }

  /**
   * Puts an enemy of `archetype` into the world at `position` (feet). Returns it, or null when
   * the living-enemy cap is reached.
   */
  spawn(
    archetype: EnemyArchetypeId,
    position: Vector3 | Vec3Tuple,
    options: SpawnOptions = {},
  ): Enemy | null {
    if (this.aliveCount >= this.rules.maxAlive) {
      return null;
    }
    const config = enemyConfig(archetype);
    const enemy = this.poolFor(config).acquire();
    const number = ++this.counter;
    const at = position instanceof Vector3 ? position : new Vector3(...position);
    enemy.prepare(`${config.id}-${number}`, number, at, options.yaw ?? 0, options.patrol ?? true);
    enemy.idleTimer = this.rng.range(config.patrol.pauseMin, config.patrol.pauseMax);
    this.byId.set(enemy.id, enemy);
    this.list = [...this.list, enemy];
    this.combat.add({
      id: enemy.id,
      rig: enemy.rig,
      health: enemy.health,
      ...(config.zoneMultipliers ? { zoneMultipliers: config.zoneMultipliers } : {}),
      armor: config.armor,
      resistance: config.resistance,
      staggerThreshold: config.staggerThreshold,
      onKilled: (event) => {
        this.onKilled(enemy, event);
      },
    });
    this.stats.spawned++;
    const p = enemy.motor.position;
    this.events.emit('spawned', { id: enemy.id, archetype: config.id, position: [p.x, p.y, p.z] });
    if (options.alertTo) {
      this.brainOf(enemy).alert(enemy, this.context, options.alertTo);
    }
    return enemy;
  }

  /**
   * Whether an enemy of `archetype` has room to stand at `position` (feet): ground within a step
   * below, and no solid part of the level inside its body. `spawn` trusts its caller (authored
   * spawn points are validated by tests); tools that place enemies at arbitrary points check
   * here first.
   */
  canStand(archetype: EnemyArchetypeId, position: Vector3 | Vec3Tuple): boolean {
    const at = position instanceof Vector3 ? _probe.copy(position) : _probe.set(...position);
    const { body } = enemyConfig(archetype);
    return (
      bodyFits(this.level.brushes, at.x, at.y, at.z, body, this.rules.maxRise) &&
      this.lines.hasGround(at)
    );
  }

  /** Makes an enemy aware of a target it has not seen. */
  alert(id: string, target: EnemyTarget): boolean {
    const enemy = this.byId.get(id);
    if (!enemy?.alive) {
      return false;
    }
    this.brainOf(enemy).alert(enemy, this.context, target);
    return true;
  }

  /** Kills a living enemy through the normal combat death (debug tools). */
  kill(id: string): boolean {
    return this.combat.kill(id) !== null;
  }

  /** Removes an enemy now, living or dead: unregistered from combat, back to the pool. Once. */
  despawn(id: string): boolean {
    const enemy = this.byId.get(id);
    if (!enemy || enemy.despawned) {
      return false;
    }
    enemy.release();
    this.byId.delete(id);
    this.list = this.list.filter((e) => e !== enemy);
    this.combat.remove(id);
    this.poolFor(enemy.config).release(enemy);
    this.stats.despawned++;
    this.events.emit('despawned', { id });
    return true;
  }

  /** Removes every enemy (a new run) and restarts ids from 1. */
  clear(): void {
    for (const enemy of this.list) {
      this.despawn(enemy.id);
    }
    this.counter = 0;
    this.stepCount = 0;
    this.simTime = 0;
  }

  /**
   * Debug: moves an enemy to `state` through the same paths the game uses (STAGGER as a stagger,
   * DEAD as a kill); other states only if the transition is legal. Returns whether it changed.
   */
  forceState(id: string, state: AiState): boolean {
    const enemy = this.byId.get(id);
    if (!enemy?.alive) {
      return false;
    }
    if (state === 'DEAD') {
      return this.kill(id);
    }
    if (state === 'STAGGER') {
      this.brainOf(enemy).onStaggered(enemy, this.context);
      return true;
    }
    return enemy.fsm.canTransition(state) && enemy.fsm.transition(state);
  }

  fixedUpdate(dt: number): void {
    const list = this.list;
    if (!this.active() || this.frozen) {
      for (const enemy of list) {
        enemy.motor.hold();
        enemy.previousHeading = enemy.heading;
      }
      return;
    }
    this.simTime += dt;
    this.stepCount++;
    if (this.thinkSteps === 0) {
      this.thinkSteps = Math.max(1, Math.round(this.rules.thinkInterval / dt));
    }
    const ctx = this.context;
    ctx.now = this.simTime;
    ctx.dt = dt;
    ctx.targets = this.targets();
    this.goalCache.clear();

    // 1–2. Decisions and exact timing.
    for (const enemy of list) {
      if (enemy.despawned) {
        continue;
      }
      if (!enemy.health.isAlive) {
        enemy.motor.hold();
        enemy.previousHeading = enemy.heading;
        enemy.corpseTimer = countDown(enemy.corpseTimer, dt);
        if (enemy.corpseTimer <= 0) {
          this.despawn(enemy.id);
        }
        continue;
      }
      enemy.fsm.advance(dt);
      enemy.attackCooldown = countDown(enemy.attackCooldown, dt);
      enemy.replanTimer = countDown(enemy.replanTimer, dt);
      enemy.idleTimer = countDown(enemy.idleTimer, dt);
      const brain = this.brainOf(enemy);
      if ((this.stepCount + enemy.spawnNumber) % this.thinkSteps === 0) {
        brain.think(enemy, ctx);
        this.stats.thinks++;
      }
      brain.update(enemy, ctx);
      this.stats.updates++;
    }

    // 3. Separation (living enemies only; bodies do not push).
    this.separate(this.list);

    // 4. Movement.
    for (const enemy of this.list) {
      if (!enemy.alive) {
        continue;
      }
      this.move(enemy, dt);
      this.stats.moves++;
      if (enemy.motor.respawns !== enemy.respawnsAtSpawn) {
        // Fell out of the level (a safety net; the blockout is closed): remove it.
        this.despawn(enemy.id);
      }
    }
  }

  dispose(): void {
    for (const off of this.unsubscribe) {
      off();
    }
    this.unsubscribe.length = 0;
    this.clear();
  }

  // ---- internals --------------------------------------------------------------------------------

  private brainOf(enemy: Enemy): EnemyBrain {
    return BRAINS[enemy.config.behavior];
  }

  private poolFor(config: EnemyArchetypeConfig): Pool<Enemy> {
    let pool = this.pools.get(config.id);
    if (!pool) {
      pool = new Pool<Enemy>({
        create: () =>
          new Enemy(
            config,
            this.world,
            this.level.killPlaneY,
            (enemy, from, to) => {
              this.events.emit('stateChanged', { id: enemy.id, from, to });
            },
            this.strict,
          ),
      });
      this.pools.set(config.id, pool);
    }
    return pool;
  }

  private onKilled(enemy: Enemy, _event: KilledEvent): void {
    if (enemy.attackPhase === 'windup') {
      this.events.emit('attackCancelled', { id: enemy.id, reason: 'death' });
    }
    enemy.attackPhase = 'none';
    enemy.rig.setPose(enemy.config.rig);
    enemy.fsm.transition('DEAD');
    enemy.target = null;
    enemy.navMode = 'none';
    enemy.moveSpeed = 0;
    enemy.corpseTimer = Math.max(enemy.config.corpseTime, 1e-6);
    const p = enemy.motor.position;
    this.events.emit('died', {
      id: enemy.id,
      archetype: enemy.config.id,
      position: [p.x, p.y, p.z],
    });
    const table = enemy.config.drops;
    if (table && this.pickups) {
      for (const pickup of rollDrops(DROP_TABLES[table], this.rng)) {
        this.pickups.spawn(pickup, [p.x, p.y + 0.2, p.z]);
      }
    }
  }

  /** The route node to head for to reach `target`: near it and with a straight walk to it. */
  private goalNodeFor(target: EnemyTarget): number {
    const cached = this.goalCache.get(target.id);
    if (cached !== undefined) {
      return cached;
    }
    const routes = this.routes;
    if (!routes) {
      return -1;
    }
    let goal = -1;
    for (const node of routes.nearest(target.position, 4, _goalNear)) {
      if (this.lines.walkable(routes.position(node), target.position, this.rules.goalClearance)) {
        goal = node;
        break;
      }
    }
    if (goal < 0) {
      goal = _goalNear[0] ?? 0;
    }
    this.goalCache.set(target.id, goal);
    return goal;
  }

  private nearestTarget(enemy: Enemy): EnemyTarget | null {
    let best: EnemyTarget | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const target of this.targets()) {
      if (!target.isAlive()) {
        continue;
      }
      const d = horizontalDistance(enemy.motor.position, target.position);
      if (d < bestDistance) {
        best = target;
        bestDistance = d;
      }
    }
    return best;
  }

  /** Pushes overlapping enemies apart, and enemies off their targets (velocity, not position). */
  private separate(list: readonly Enemy[]): void {
    const { separationDistance: reach, separationStrength: strength } = this.rules;
    for (const enemy of list) {
      enemy.separation.set(0, 0, 0);
    }
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (!a?.alive) {
        continue;
      }
      const pa = a.motor.position;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (!b?.alive) {
          continue;
        }
        const pb = b.motor.position;
        if (Math.abs(pb.y - pa.y) > 1) {
          continue;
        }
        let dx = pb.x - pa.x;
        let dz = pb.z - pa.z;
        let d = Math.hypot(dx, dz);
        if (d >= reach) {
          continue;
        }
        if (d < 1e-4) {
          // Exactly on top of each other: split along a direction fixed by their spawn order.
          const angle = (a.spawnNumber * 7 + b.spawnNumber * 13) * 0.61803398875;
          dx = Math.cos(angle);
          dz = Math.sin(angle);
          d = 1;
        } else {
          dx /= d;
          dz /= d;
        }
        const push = ((reach - Math.min(d, reach)) / reach) * strength;
        a.separation.x -= dx * push;
        a.separation.z -= dz * push;
        b.separation.x += dx * push;
        b.separation.z += dz * push;
      }
    }
    // Never walk into a target's body.
    for (const target of this.context.targets) {
      if (!target.isAlive()) {
        continue;
      }
      for (const enemy of list) {
        if (!enemy.alive) {
          continue;
        }
        const p = enemy.motor.position;
        if (Math.abs(target.position.y - p.y) > 1) {
          continue;
        }
        const dx = p.x - target.position.x;
        const dz = p.z - target.position.z;
        const d = Math.hypot(dx, dz);
        const min = enemy.config.body.radius + target.radius + 0.05;
        if (d < min && d > 1e-4) {
          const push = ((min - d) / min) * strength * 2;
          enemy.separation.x += (dx / d) * push;
          enemy.separation.z += (dz / d) * push;
        }
      }
    }
  }

  /** Turns toward the brain's wish and walks through the capsule motor. */
  private move(enemy: Enemy, dt: number): void {
    const { config, motor } = enemy;
    const pos = motor.position;
    let desired = enemy.heading;
    if (enemy.moveSpeed > 0) {
      const dx = enemy.moveGoal.x - pos.x;
      const dz = enemy.moveGoal.z - pos.z;
      if (dx * dx + dz * dz > 1e-6) {
        desired = Math.atan2(-dx, -dz);
      }
    } else if (enemy.faceYaw !== null) {
      desired = enemy.faceYaw;
    }
    enemy.previousHeading = enemy.heading;
    const delta = angleDelta(enemy.heading, desired);
    const maxTurn = config.turnSpeed * dt;
    enemy.heading = wrapAngle(
      enemy.heading + (Math.abs(delta) <= maxTurn ? delta : Math.sign(delta) * maxTurn),
    );
    // Walk along its facing, slower while still turning toward the goal (no moonwalking).
    const alignment = Math.max(0, Math.cos(angleDelta(enemy.heading, desired)));
    const sin = Math.sin(enemy.heading);
    const cos = Math.cos(enemy.heading);
    const s = enemy.separation;
    const forward = enemy.moveSpeed * alignment + (-s.x * sin - s.z * cos) / config.moveSpeed;
    const right = (s.x * cos - s.z * sin) / config.moveSpeed;
    motor.step({ forward, right, sprint: false, crouch: false, jump: false }, enemy.heading, dt);
    enemy.syncRig();
    if (enemy.moveSpeed > 0) {
      enemy.progressTimer += dt;
    } else {
      enemy.progressAnchor.copy(pos);
      enemy.progressTimer = 0;
    }
  }
}

function wrapAngle(angle: number): number {
  let a = angle % (Math.PI * 2);
  if (a > Math.PI) {
    a -= Math.PI * 2;
  } else if (a <= -Math.PI) {
    a += Math.PI * 2;
  }
  return a;
}
