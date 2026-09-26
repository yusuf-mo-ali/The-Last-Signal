/**
 * One enemy (plan §11, D-012, D-042): generic data for any archetype. It holds the state; the
 * behaviour lives in a brain (`ai/`) chosen by the archetype, and the lifecycle (spawn, combat
 * registration, death, cleanup, pooling) in `EnemyManager`. Nothing here is Walker-specific.
 *
 * - Body: the same kinematic capsule as the player (`PlayerMotor`, D-042).
 * - Hit volumes: a `HitboxRig` registered with the `CombatSystem` (like a training dummy).
 * - Health: the Phase 3 `Health`; death comes through combat's `onKilled` hook.
 * - AI: an explicit `EnemyStateMachine` plus the perception, attack, navigation and patrol data
 *   the brain works with.
 *
 * Browser-independent. Instances are pooled and reused: `prepare` resets everything.
 */

import { Vector3 } from 'three';
import { Health } from '../combat/Health';
import { HitboxRig } from '../combat/hitbox';
import type { AiState, EnemyArchetypeConfig } from '../config/enemies';
import type { CollisionWorld } from '../physics/CollisionWorld';
import { PlayerMotor } from '../player/PlayerMotor';
import { EnemyStateMachine, type EnemyStateListener } from './ai/EnemyStateMachine';
import { enemyMovementConfig } from './body';
import type { EnemyTarget } from './types';

export type AttackPhase = 'none' | 'windup' | 'recovery';

/** How the enemy is currently getting to its target. */
export type NavMode = 'none' | 'direct' | 'route';

export class Enemy {
  readonly config: EnemyArchetypeConfig;
  readonly motor: PlayerMotor;
  readonly rig: HitboxRig;
  readonly health: Health;
  readonly fsm: EnemyStateMachine;

  /** Unique for the run (e.g. `walker-3`). */
  id = '';
  /** Order of spawning in the run; spreads decisions over the think interval. */
  spawnNumber = 0;
  /** Facing (yaw 0 faces −z, like the player), before and after the latest step. */
  heading = 0;
  previousHeading = 0;
  /** Where it spawned; patrols stay around here. */
  readonly home = new Vector3();
  /** Whether it wanders while idle (its archetype's patrol radius > 0 and the spawn allows it). */
  patrols = true;

  // ---- perception ---------------------------------------------------------------------------
  target: EnemyTarget | null = null;
  canSeeTarget = false;
  /** Sim time when the target was last seen. */
  lastSeenAt = Number.NEGATIVE_INFINITY;
  /**
   * Until this sim time it keeps its target whatever the range or sight: it was told where the
   * target is (a hit: for its memory time; the horde, via `alert`: for good).
   */
  alertUntil = Number.NEGATIVE_INFINITY;
  readonly lastKnownTargetPosition = new Vector3();

  // ---- attack -------------------------------------------------------------------------------
  attackPhase: AttackPhase = 'none';
  /** Seconds left in the current attack phase. */
  attackTimer = 0;
  /** Seconds until the next attack may start. */
  attackCooldown = 0;
  /** Facing locked at the start of the wind-up (the attack is committed). */
  attackYaw = 0;
  /** Attacks started since spawning (tests, debug). */
  attacks = 0;

  // ---- stagger, idle, patrol ----------------------------------------------------------------
  staggerTimer = 0;
  idleTimer = 0;
  readonly patrolPoint = new Vector3();
  patrolTimer = 0;

  // ---- navigation ---------------------------------------------------------------------------
  navMode: NavMode = 'none';
  /** Route node indices, and the one it is walking to. */
  route: number[] = [];
  routeCursor = 0;
  routeGoal = -1;
  replanTimer = 0;
  /**
   * It got stuck walking straight at its target, so something the straight-line test cannot see
   * is in the way: it follows the route, link by link (every link is walkable by a body), until
   * the end of the route (or until it reaches the target) before it tries the straight line again.
   */
  directBlocked = false;
  readonly progressAnchor = new Vector3();
  progressTimer = 0;

  // ---- steering: written by the brain every step, read by the manager -----------------------
  /** Where it wants to walk. */
  readonly moveGoal = new Vector3();
  /** 0–1 of its walking speed; 0 = stand. */
  moveSpeed = 0;
  /** A direction it wants to face while standing (null: keep facing its movement). */
  faceYaw: number | null = null;
  /** Push away from neighbours this step, m/s (world XZ). */
  readonly separation = new Vector3();

  // ---- lifecycle ----------------------------------------------------------------------------
  /** Seconds a dead body has left before it is removed. */
  corpseTimer = 0;
  /** True once removed; a removed enemy is never updated or cleaned up again. */
  despawned = true;
  /** `motor.respawns` at spawn: a change means it fell out of the level (a safety net). */
  respawnsAtSpawn = 0;

  constructor(
    config: EnemyArchetypeConfig,
    world: CollisionWorld,
    killPlaneY: number,
    onStateChange: (enemy: Enemy, from: AiState, to: AiState) => void,
    strict = false,
  ) {
    this.config = config;
    this.motor = new PlayerMotor(world, enemyMovementConfig(config), {
      position: new Vector3(),
      killPlaneY,
    });
    this.rig = new HitboxRig(config.rig);
    this.health = new Health({ max: config.health });
    const listener: EnemyStateListener = (from, to) => {
      onStateChange(this, from, to);
    };
    this.fsm = new EnemyStateMachine({ strict, onChange: listener });
  }

  get state(): AiState {
    return this.fsm.state;
  }

  /** Alive and in the world. */
  get alive(): boolean {
    return !this.despawned && this.health.isAlive;
  }

  /** Readies a (new or pooled) enemy to enter the world at `position`, facing `yaw`. */
  prepare(id: string, spawnNumber: number, position: Vector3, yaw: number, patrols: boolean): void {
    this.id = id;
    this.spawnNumber = spawnNumber;
    this.despawned = false;
    this.health.revive();
    this.fsm.reset();
    this.motor.teleport(position);
    this.respawnsAtSpawn = this.motor.respawns;
    this.home.copy(this.motor.position);
    this.heading = yaw;
    this.previousHeading = yaw;
    this.patrols = patrols && this.config.patrol.radius > 0;
    this.target = null;
    this.canSeeTarget = false;
    this.lastSeenAt = Number.NEGATIVE_INFINITY;
    this.alertUntil = Number.NEGATIVE_INFINITY;
    this.attackPhase = 'none';
    this.attackTimer = 0;
    this.attackCooldown = 0;
    this.attacks = 0;
    this.staggerTimer = 0;
    this.idleTimer = 0;
    this.patrolTimer = 0;
    this.navMode = 'none';
    this.route = [];
    this.routeCursor = 0;
    this.routeGoal = -1;
    this.replanTimer = 0;
    this.directBlocked = false;
    this.progressAnchor.copy(this.motor.position);
    this.progressTimer = 0;
    this.moveGoal.copy(this.motor.position);
    this.moveSpeed = 0;
    this.faceYaw = null;
    this.separation.set(0, 0, 0);
    this.corpseTimer = 0;
    this.rig.setPose(this.config.rig);
    this.syncRig();
  }

  /** Keeps the hit volumes where the body is. */
  syncRig(): void {
    this.rig.position.copy(this.motor.position);
    this.rig.yaw = this.heading;
  }

  /** Forgets targets and routes (released to the pool). */
  release(): void {
    this.despawned = true;
    this.target = null;
    this.route = [];
  }
}
