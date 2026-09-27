/**
 * What every behaviour shares (D-042, D-043): perception and targeting, navigation (straight
 * pursuit or the route graph, stuck detection), idle and patrol, alerts, stagger and attack
 * cancellation. The brains (`meleeBrain`, `screamerBrain`) are thin layers on top, so every
 * archetype uses the same state machine, the same limited-rate decisions and the same movement.
 * Nothing here names an archetype; every value comes from the enemy's config.
 */

import { Vector3 } from 'three';
import { countDown } from '../../weapons/timing';
import type { AiState } from '../../config/enemies';
import type { Enemy } from '../Enemy';
import type { AttackCancelReason, TargetLossReason } from '../events';
import type { EnemyTarget } from '../types';
import type { BrainContext } from './brain';

const _eye = new Vector3();
const _targetEye = new Vector3();
const NEAR_NODES = 4;
const _near: number[] = [];
/** Seconds a patrol walk may take before it is abandoned. */
const PATROL_TIMEOUT = 8;
/** Patrol point attempts per decision. */
const PATROL_TRIES = 3;

export function horizontalDistance(a: Vector3, b: Vector3): number {
  return Math.hypot(b.x - a.x, b.z - a.z);
}

/** Yaw that faces from `from` toward `to` (yaw 0 faces −z). */
export function yawToward(from: Vector3, to: Vector3): number {
  return Math.atan2(-(to.x - from.x), -(to.z - from.z));
}

/** Smallest signed difference `b − a`, in (−π, π]. */
export function angleDelta(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) {
    d -= Math.PI * 2;
  } else if (d <= -Math.PI) {
    d += Math.PI * 2;
  }
  return d;
}

export function eyeOf(enemy: Enemy, out: Vector3): Vector3 {
  return out.copy(enemy.motor.position).setY(enemy.motor.position.y + enemy.config.body.eyeHeight);
}

export function targetEyeOf(target: EnemyTarget, out: Vector3): Vector3 {
  return out.copy(target.position).setY(target.position.y + target.eyeHeight);
}

/** Can the enemy see `target` right now (one ray, eye to eye)? */
export function sees(enemy: Enemy, ctx: BrainContext, target: EnemyTarget): boolean {
  return ctx.lines.lineOfSight(eyeOf(enemy, _eye), targetEyeOf(target, _targetEye));
}

export function inAttackRange(enemy: Enemy, target: EnemyTarget): boolean {
  const pos = enemy.motor.position;
  return (
    horizontalDistance(pos, target.position) <= enemy.config.attackRange &&
    Math.abs(target.position.y - pos.y) <= enemy.config.attack.verticalReach
  );
}

export function transition(enemy: Enemy, to: AiState): void {
  if (enemy.state !== to) {
    enemy.fsm.transition(to);
  }
}

export function enterIdle(enemy: Enemy, ctx: BrainContext): void {
  transition(enemy, 'IDLE');
  const { pauseMin, pauseMax } = enemy.config.patrol;
  enemy.idleTimer = ctx.rng.range(pauseMin, pauseMax);
  enemy.navMode = 'none';
  enemy.retreating = false;
}

export function resetPose(enemy: Enemy): void {
  enemy.rig.setPose(enemy.config.rig);
}

/** Drops any attack in progress; a wind-up or leap that is cut short is reported. */
export function cancelAttack(enemy: Enemy, ctx: BrainContext, reason: AttackCancelReason): void {
  if (enemy.attackPhase === 'windup' || enemy.attackPhase === 'lunge') {
    ctx.events.emit('attackCancelled', { id: enemy.id, reason });
  }
  enemy.attackPhase = 'none';
  enemy.attackTimer = 0;
  resetPose(enemy);
}

export function setTarget(
  enemy: Enemy,
  ctx: BrainContext,
  target: EnemyTarget,
  alerted: boolean,
): void {
  enemy.target = target;
  enemy.canSeeTarget = !alerted;
  if (!alerted) {
    enemy.alertUntil = Number.NEGATIVE_INFINITY;
  }
  enemy.lastSeenAt = ctx.now;
  enemy.lastKnownTargetPosition.copy(target.position);
  enemy.navMode = 'none';
  enemy.replanTimer = 0;
  enemy.directBlocked = false;
  ctx.events.emit('targetAcquired', { id: enemy.id, targetId: target.id, alerted });
}

export function loseTarget(enemy: Enemy, ctx: BrainContext, reason: TargetLossReason): void {
  const target = enemy.target;
  if (!target) {
    return;
  }
  ctx.events.emit('targetLost', { id: enemy.id, targetId: target.id, reason });
  enemy.target = null;
  enemy.canSeeTarget = false;
  enemy.navMode = 'none';
  enemy.route = [];
  enemy.directBlocked = false;
  enemy.retreating = false;
  if (enemy.state === 'DETECT' || enemy.state === 'CHASE' || enemy.state === 'ATTACK') {
    cancelAttack(enemy, ctx, 'lostTarget');
    enterIdle(enemy, ctx);
  }
}

/** Sight, memory and range: keeps, loses or acquires a target. Casts at most one ray per target. */
export function perceive(enemy: Enemy, ctx: BrainContext): void {
  const pos = enemy.motor.position;
  const target = enemy.target;
  if (target) {
    const { loseTargetRange, targetMemory } = enemy.config.perception;
    if (!target.isAlive()) {
      loseTarget(enemy, ctx, 'dead');
    } else {
      enemy.canSeeTarget = sees(enemy, ctx, target);
      if (enemy.canSeeTarget) {
        enemy.lastSeenAt = ctx.now;
      }
      // Told where the target is: it keeps hunting whatever the range or sight, and knows where
      // to go. Otherwise it needs to have seen the target recently, and not too far away.
      const told = ctx.now < enemy.alertUntil;
      if (told || enemy.canSeeTarget) {
        enemy.lastKnownTargetPosition.copy(target.position);
      }
      if (!told) {
        if (horizontalDistance(pos, target.position) > loseTargetRange) {
          loseTarget(enemy, ctx, 'range');
        } else if (ctx.now - enemy.lastSeenAt > targetMemory) {
          loseTarget(enemy, ctx, 'memory');
        }
      }
    }
  }
  if (enemy.target) {
    return;
  }
  // Acquire: the nearest living target within detection range that it can see.
  let best: EnemyTarget | null = null;
  let bestDistance = enemy.config.detectionRange;
  for (const candidate of ctx.targets) {
    if (!candidate.isAlive()) {
      continue;
    }
    const d = horizontalDistance(pos, candidate.position);
    if (d > bestDistance) {
      continue;
    }
    if (sees(enemy, ctx, candidate)) {
      best = candidate;
      bestDistance = d;
    }
  }
  if (best) {
    setTarget(enemy, ctx, best, false);
    if (enemy.state === 'IDLE' || enemy.state === 'PATROL') {
      transition(enemy, 'DETECT');
    }
  }
}

/** Straight at the target if a body can walk that line, otherwise along the route graph. */
export function planChase(enemy: Enemy, ctx: BrainContext, target: EnemyTarget): void {
  const pos = enemy.motor.position;
  const radius = enemy.config.body.radius;
  if (!enemy.directBlocked && ctx.lines.walkable(pos, target.position, radius)) {
    enemy.navMode = 'direct';
    return;
  }
  const routes = ctx.routes;
  if (!routes || routes.size === 0) {
    enemy.navMode = 'none';
    return;
  }
  const goal = ctx.goalNodeFor(target);
  const onRoute = enemy.navMode === 'route' && enemy.routeCursor < enemy.route.length;
  if (!onRoute) {
    // A new route: from the nearest node it can walk straight to.
    let start = -1;
    for (const node of routes.nearest(pos, NEAR_NODES, _near)) {
      if (ctx.lines.walkable(pos, routes.position(node), radius)) {
        start = node;
        break;
      }
    }
    if (start < 0) {
      start = _near[0] ?? 0;
    }
    setRoute(enemy, ctx, routes.findPath(start, goal), goal);
  } else if (goal !== enemy.routeGoal || enemy.replanTimer <= 0) {
    // The target moved on: re-plan from the node it is already walking to, so a re-plan halfway
    // up a staircase never sends it back to the bottom.
    const next = enemy.route[enemy.routeCursor] ?? goal;
    setRoute(enemy, ctx, routes.findPath(next, goal), goal);
  }
  // Cut corners: skip ahead to the farthest of the next few nodes it can walk straight to. Not
  // after a straight walk failed: the same test said that one was clear too.
  const last = enemy.directBlocked ? enemy.routeCursor : enemy.route.length - 1;
  for (let k = Math.min(enemy.routeCursor + 3, last); k > enemy.routeCursor; k--) {
    const node = enemy.route[k];
    if (node !== undefined && ctx.lines.walkable(pos, routes.position(node), radius)) {
      enemy.routeCursor = k;
      break;
    }
  }
  enemy.navMode = 'route';
}

function setRoute(enemy: Enemy, ctx: BrainContext, route: number[] | null, goal: number): void {
  enemy.route = route ?? [];
  enemy.routeCursor = 0;
  enemy.routeGoal = goal;
  enemy.replanTimer = ctx.rules.replanInterval;
}

/** Gave up on a straight walk (or a patrol) that is not getting anywhere. */
export function checkProgress(enemy: Enemy, ctx: BrainContext): void {
  if (enemy.progressTimer < ctx.rules.stuckTime) {
    return;
  }
  const moved = horizontalDistance(enemy.progressAnchor, enemy.motor.position);
  enemy.progressAnchor.copy(enemy.motor.position);
  enemy.progressTimer = 0;
  if (moved >= ctx.rules.stuckDistance) {
    return;
  }
  if (enemy.state === 'PATROL') {
    enterIdle(enemy, ctx);
  } else if (enemy.retreating) {
    // Backed into something: stand its ground this time.
    enemy.retreating = false;
  } else if (enemy.navMode === 'direct') {
    // Something the straight-line test missed (a kerb below knee height, a beam above the chest):
    // take the route instead, to its end.
    enemy.directBlocked = true;
    enemy.route = [];
  } else {
    // Stuck on the route: start a fresh one from wherever it is now.
    enemy.route = [];
  }
}

/**
 * Steering toward the target along what `planChase` decided: straight (stopping `stopDistance`
 * from it), along the route, or to where it was last known. Sets `moveGoal` / `moveSpeed`.
 */
export function followPath(
  enemy: Enemy,
  ctx: BrainContext,
  target: EnemyTarget,
  stopDistance: number,
): void {
  const pos = enemy.motor.position;
  if (enemy.navMode === 'direct') {
    enemy.moveGoal.copy(target.position);
    enemy.moveSpeed = horizontalDistance(pos, target.position) <= stopDistance ? 0 : 1;
  } else if (enemy.navMode === 'route' && ctx.routes && enemy.route.length > 0) {
    let node = enemy.route[enemy.routeCursor];
    if (node !== undefined) {
      const at = ctx.routes.position(node);
      if (horizontalDistance(pos, at) < ctx.rules.arrivalRadius && Math.abs(at.y - pos.y) < 1) {
        enemy.routeCursor++;
        node = enemy.route[enemy.routeCursor];
      }
    }
    if (node === undefined) {
      enemy.directBlocked = false; // the end of the route: the straight line may work now
    }
    enemy.moveGoal.copy(node === undefined ? target.position : ctx.routes.position(node));
    enemy.moveSpeed = 1;
  } else {
    enemy.moveGoal.copy(enemy.lastKnownTargetPosition);
    enemy.moveSpeed =
      horizontalDistance(pos, enemy.lastKnownTargetPosition) > ctx.rules.arrivalRadius ? 1 : 0;
  }
  if (enemy.moveSpeed === 0) {
    enemy.faceYaw = yawToward(pos, target.position);
  }
}

function choosePatrolPoint(enemy: Enemy, ctx: BrainContext): boolean {
  const { radius } = enemy.config.patrol;
  for (let i = 0; i < PATROL_TRIES; i++) {
    const angle = ctx.rng.range(0, Math.PI * 2);
    const r = ctx.rng.range(Math.min(0.5, radius), radius);
    enemy.patrolPoint.set(
      enemy.home.x + Math.cos(angle) * r,
      enemy.home.y,
      enemy.home.z + Math.sin(angle) * r,
    );
    if (ctx.lines.walkable(enemy.motor.position, enemy.patrolPoint, enemy.config.body.radius)) {
      return true;
    }
  }
  return false;
}

/** Decisions while it has no target (in `think`): start a patrol walk; notice a stuck one. */
export function thinkIdle(enemy: Enemy, ctx: BrainContext): void {
  if (enemy.state === 'IDLE') {
    if (enemy.patrols && enemy.idleTimer <= 0) {
      if (choosePatrolPoint(enemy, ctx)) {
        transition(enemy, 'PATROL');
        enemy.patrolTimer = PATROL_TIMEOUT;
        enemy.progressAnchor.copy(enemy.motor.position);
        enemy.progressTimer = 0;
      } else {
        enemy.idleTimer = ctx.rng.range(enemy.config.patrol.pauseMin, enemy.config.patrol.pauseMax);
      }
    }
  } else if (enemy.state === 'PATROL') {
    checkProgress(enemy, ctx);
  }
}

/** Every step while patrolling: walk to the patrol point at patrol speed, then rest. */
export function updatePatrol(enemy: Enemy, ctx: BrainContext): void {
  enemy.patrolTimer = countDown(enemy.patrolTimer, ctx.dt);
  if (
    horizontalDistance(enemy.motor.position, enemy.patrolPoint) < ctx.rules.arrivalRadius ||
    enemy.patrolTimer <= 0
  ) {
    enterIdle(enemy, ctx);
    return;
  }
  enemy.moveGoal.copy(enemy.patrolPoint);
  enemy.moveSpeed = enemy.config.patrol.speedFactor;
}

/**
 * Told about a target (hit by it, or alerted): notices it without needing to see it, and keeps it
 * for `duration` seconds whatever the range or sight (refreshed by later alerts).
 */
export function alertTo(
  enemy: Enemy,
  ctx: BrainContext,
  target: EnemyTarget,
  duration: number,
): void {
  if (!enemy.alive || !target.isAlive()) {
    return;
  }
  if (enemy.target === target) {
    enemy.alertUntil = Math.max(enemy.alertUntil, ctx.now + duration);
    return;
  }
  if (enemy.target) {
    return;
  }
  setTarget(enemy, ctx, target, true);
  enemy.alertUntil = ctx.now + duration;
  if (enemy.state === 'IDLE' || enemy.state === 'PATROL') {
    transition(enemy, 'DETECT');
  }
}

/** A stagger from combat: whatever it was doing stops (a wind-up is lost), for its duration. */
export function stagger(enemy: Enemy, ctx: BrainContext): void {
  if (!enemy.alive) {
    return;
  }
  cancelAttack(enemy, ctx, 'stagger');
  enemy.staggerTimer = enemy.config.staggerDuration;
  transition(enemy, 'STAGGER');
  ctx.events.emit('staggered', { id: enemy.id });
}
