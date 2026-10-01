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
 * - Traits (D-043): `config` is the archetype with its traits folded in (`applyTraits`); breakable
 *   plates (a helmet) are per-enemy state in `plates`.
 *
 * Browser-independent. Instances are pooled per archetype and reused: `prepare` resets everything.
 */

import { Vector3 } from 'three';
import { ArmorPlate } from '../combat/armor';
import { Health } from '../combat/Health';
import { HitboxRig } from '../combat/hitbox';
import { EFFECT_CLAMPS, type FrenzyParams } from '../config/effects';
import type { AiState, EnemyArchetypeConfig } from '../config/enemies';
import type { PlayerMovementConfig } from '../config/player';
import { applyTraits, type EnemyConfig } from '../config/traits';
import type { CollisionWorld } from '../physics/CollisionWorld';
import { PlayerMotor } from '../player/PlayerMotor';
import { EnemyStateMachine, type EnemyStateListener } from './ai/EnemyStateMachine';
import { enemyMovementConfig } from './body';
import type { AlarmKind } from './events';
import type { EnemyTarget } from './types';

/** `lunge`: a committed leap between the wind-up and the strike (archetypes with `attack.lunge`). */
export type AttackPhase = 'none' | 'windup' | 'lunge' | 'recovery';

/** How the enemy is currently getting to its target. */
export type NavMode = 'none' | 'direct' | 'route';

const clampTo = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** A frenzy within the guardrails (`EFFECT_CLAMPS.frenzy`), whoever asked for it. */
export function clampFrenzy(f: FrenzyParams): FrenzyParams {
  const c = EFFECT_CLAMPS.frenzy;
  return {
    duration: clampTo(f.duration, 0, c.duration),
    cooldownScale: clampTo(f.cooldownScale, c.cooldownScale, 1),
    windupScale: clampTo(f.windupScale, c.windupScale, 1),
    turnScale: clampTo(f.turnScale, 1, c.turnScale),
    staggerScale: clampTo(f.staggerScale, 1, c.staggerScale),
  };
}

type MutableMovement = { -readonly [K in keyof PlayerMovementConfig]: PlayerMovementConfig[K] };

export class Enemy {
  /** The archetype this (pooled) body was built for: size, rig and poses never change. */
  readonly archetype: EnemyArchetypeConfig;
  /** The archetype with its traits folded in (changes when traits are added or removed). */
  config: EnemyConfig;
  /** Breakable armor from traits, in `config.plates` order. */
  plates: ArmorPlate[] = [];
  /** Bumped whenever `config` or `plates` change (views rebuild their look). */
  configVersion = 0;
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
  /**
   * Told only where the target was (a death cry, D-046), not where it is: while true and unable to
   * see the target, it heads for `lastKnownTargetPosition` instead of the target. Ends when it sees
   * the target or reaches the spot.
   */
  investigating = false;

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
  /** Which way its zig-zag approach currently heads (−1 left, 1 right, 0 straight). */
  weaveSide = 0;

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
  /** Multiplies its walking speed and acceleration this step (a lunge). */
  speedScale = 1;
  accelerationScale = 1;
  /** A timed speed boost (an alarm's haste): the multiplier, until this sim time. */
  hasteMultiplier = 1;
  hasteUntil = Number.NEGATIVE_INFINITY;
  /**
   * Effect modifiers on its locomotion (a mutation such as HUNGER; D-045), set by the manager
   * every step. They change its cruising speed and acceleration, never a lunge or a brake, and
   * never push it above `speedCap` unless it was already faster without them.
   */
  speedMultiplier = 1;
  accelerationMultiplier = 1;
  speedCap = Number.POSITIVE_INFINITY;
  /** Backing away from its target (keeping its distance). */
  retreating = false;
  /**
   * A combat frenzy from an alarm (D-046), until this sim time: attacks sooner, winds up faster,
   * turns faster and may resist staggers. Never stacked: the strongest scales win.
   */
  frenzyUntil = Number.NEGATIVE_INFINITY;
  frenzyCooldownScale = 1;
  frenzyWindupScale = 1;
  frenzyTurnScale = 1;
  frenzyStaggerScale = 1;
  /** What frenzied it last (the view tints its eyes). */
  frenzyKind: AlarmKind | null = null;
  /** The stagger scale its combat profile was last configured with (the manager keeps it in step). */
  appliedStaggerScale = 1;

  // ---- lifecycle ----------------------------------------------------------------------------
  /** Seconds a dead body has left before it is removed. */
  corpseTimer = 0;
  /** True once removed; a removed enemy is never updated or cleaned up again. */
  despawned = true;
  /** `motor.respawns` at spawn: a change means it fell out of the level (a safety net). */
  respawnsAtSpawn = 0;

  /** The motor's settings, owned by this enemy: speed follows traits, haste and lunges. */
  private readonly movement: MutableMovement;

  constructor(
    archetype: EnemyArchetypeConfig,
    world: CollisionWorld,
    killPlaneY: number,
    onStateChange: (enemy: Enemy, from: AiState, to: AiState) => void,
    strict = false,
  ) {
    this.archetype = archetype;
    this.config = applyTraits(archetype);
    this.movement = { ...enemyMovementConfig(archetype) };
    this.motor = new PlayerMotor(world, this.movement, {
      position: new Vector3(),
      killPlaneY,
    });
    this.rig = new HitboxRig(archetype.rig);
    this.health = new Health({ max: archetype.health });
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

  /** Speed multiplier from haste at sim time `now` (1 when none is active). */
  haste(now: number): number {
    return now < this.hasteUntil ? this.hasteMultiplier : 1;
  }

  /** Whether a frenzy is active at sim time `now`. */
  frenzied(now: number): boolean {
    return now < this.frenzyUntil;
  }

  /**
   * Starts or strengthens a frenzy at sim time `now` (D-046). Never stacks: while one is active,
   * each scale keeps the stronger value, and it ends at the later of its end and `now + duration`.
   * Returns whether anything was applied.
   */
  frenzy(now: number, params: FrenzyParams, kind: AlarmKind): boolean {
    const f = clampFrenzy(params);
    if (f.duration <= 0) {
      return false;
    }
    const active = this.frenzied(now);
    this.frenzyCooldownScale = active
      ? Math.min(this.frenzyCooldownScale, f.cooldownScale)
      : f.cooldownScale;
    this.frenzyWindupScale = active
      ? Math.min(this.frenzyWindupScale, f.windupScale)
      : f.windupScale;
    this.frenzyTurnScale = active ? Math.max(this.frenzyTurnScale, f.turnScale) : f.turnScale;
    this.frenzyStaggerScale = active
      ? Math.max(this.frenzyStaggerScale, f.staggerScale)
      : f.staggerScale;
    this.frenzyUntil = Math.max(active ? this.frenzyUntil : now, now + f.duration);
    this.frenzyKind = kind;
    return true;
  }

  /** × its attack cooldown at sim time `now` (a frenzy attacks sooner). */
  cooldownScale(now: number): number {
    return this.frenzied(now) ? this.frenzyCooldownScale : 1;
  }

  /** × its wind-up at sim time `now`. */
  windupScale(now: number): number {
    return this.frenzied(now) ? this.frenzyWindupScale : 1;
  }

  /** × its turn speed at sim time `now`. */
  turnScale(now: number): number {
    return this.frenzied(now) ? this.frenzyTurnScale : 1;
  }

  /** × its stagger threshold at sim time `now`. */
  staggerScale(now: number): number {
    return this.frenzied(now) ? this.frenzyStaggerScale : 1;
  }

  /** Its top speed this step (m/s): config × the brain's scale × haste. */
  get walkSpeed(): number {
    return this.movement.walkSpeed;
  }

  /** Its ground acceleration this step (m/s²): config × the brain's scale or the stat multiplier. */
  get groundAcceleration(): number {
    return this.movement.groundAcceleration;
  }

  /**
   * Its cruising top speed at sim time `now` (no lunge): config × haste, with the effect
   * multiplier. A boost never lifts it above `speedCap` unless it was already faster without it.
   */
  cruiseSpeed(now: number): number {
    const plain = this.config.moveSpeed * this.haste(now);
    const boosted = plain * this.speedMultiplier;
    return this.speedMultiplier > 1 ? Math.min(boosted, Math.max(plain, this.speedCap)) : boosted;
  }

  /**
   * Sets the motor's speed for this step from its config, the brain's scale, haste and effect
   * multipliers. A lunge (a scale other than 1) keeps its own speed, whatever the effects.
   */
  applySpeed(now: number): void {
    this.movement.walkSpeed =
      this.speedScale === 1
        ? this.cruiseSpeed(now)
        : this.config.moveSpeed * this.speedScale * this.haste(now);
    const acceleration =
      this.config.acceleration *
      this.accelerationScale *
      (this.accelerationScale === 1 ? this.accelerationMultiplier : 1);
    this.movement.groundAcceleration = acceleration;
    this.movement.groundDeceleration = acceleration * 1.5;
  }

  /**
   * Replaces its traits: new stats (health keeps its fraction), plates kept where the same plate
   * is still worn (a broken helmet stays broken), new ones whole.
   */
  setConfig(config: EnemyConfig): void {
    this.config = config;
    if (this.health.isAlive) {
      this.health.setMax(config.health, true);
    }
    const previous = this.plates;
    this.plates = config.plates.map(
      (definition) =>
        previous.find((plate) => plate.id === definition.id) ?? new ArmorPlate(definition),
    );
    this.configVersion++;
  }

  /** Readies a (new or pooled) enemy to enter the world at `position`, facing `yaw`. */
  prepare(
    id: string,
    spawnNumber: number,
    position: Vector3,
    yaw: number,
    patrols: boolean,
    config: EnemyConfig = applyTraits(this.archetype),
  ): void {
    this.id = id;
    this.spawnNumber = spawnNumber;
    this.despawned = false;
    this.config = config;
    this.plates = config.plates.map((definition) => new ArmorPlate(definition));
    this.configVersion++;
    this.health.setMax(config.health);
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
    this.investigating = false;
    this.attackPhase = 'none';
    this.attackTimer = 0;
    this.attackCooldown = 0;
    this.attacks = 0;
    this.weaveSide = 0;
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
    this.speedScale = 1;
    this.accelerationScale = 1;
    this.hasteMultiplier = 1;
    this.hasteUntil = Number.NEGATIVE_INFINITY;
    this.speedMultiplier = 1;
    this.accelerationMultiplier = 1;
    this.speedCap = Number.POSITIVE_INFINITY;
    this.retreating = false;
    this.frenzyUntil = Number.NEGATIVE_INFINITY;
    this.frenzyCooldownScale = 1;
    this.frenzyWindupScale = 1;
    this.frenzyTurnScale = 1;
    this.frenzyStaggerScale = 1;
    this.frenzyKind = null;
    this.appliedStaggerScale = 1;
    this.applySpeed(0);
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
