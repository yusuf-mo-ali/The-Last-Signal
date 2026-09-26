/**
 * The melee chaser (D-042): the generic behaviour of an enemy that walks up to its target and
 * hits it. The Walker uses it; any melee archetype can, with its own numbers. No archetype is
 * named here: every value comes from the enemy's config.
 *
 * States (plan §11; transitions in `EnemyStateMachine`):
 * - IDLE: no target. Waits a random pause, then (if it patrols) walks to a point near its spawn.
 * - PATROL: that walk, at a fraction of its speed.
 * - DETECT: it saw its target (within detection range, in line of sight) or was hit or alerted;
 *   it turns to face the target for its reaction time, then chases or attacks.
 * - CHASE: walks straight at the target when a body can walk that line, otherwise along the route
 *   graph; stops just short of it.
 * - ATTACK: in range and in sight: a committed wind-up (the telegraph; no moving, the facing
 *   locked), one strike that lands only if the target is still in reach, in front and not behind
 *   a wall, then recovery; again when the cooldown allows, back to CHASE when out of range.
 * - STAGGER: a stagger from combat cancels any wind-up and stops it for its stagger duration;
 *   then back to whatever fits (attack, chase or idle).
 * - Target loss: the target died, or (unless the enemy was told where it is: a hit tells it for its
 *   memory time, the game's `alert` for good) went beyond the lose range or stayed out of sight
 *   longer than the enemy's memory.
 *
 * Decisions that cast rays run in `think` (limited rate); timing that must be exact (reaction,
 * wind-up, strike, recovery, stagger) runs in `update`, every fixed step.
 */

import { Vector3 } from 'three';
import { countDown, TIMER_EPSILON } from '../../weapons/timing';
import type { Enemy } from '../Enemy';
import type { AttackCancelReason, AttackMissReason, TargetLossReason } from '../events';
import type { EnemyTarget } from '../types';
import type { BrainContext, EnemyBrain } from './brain';

const _eye = new Vector3();
const _targetEye = new Vector3();
const NEAR_NODES = 4;
const _near: number[] = [];
/** Seconds a patrol walk may take before it is abandoned. */
const PATROL_TIMEOUT = 8;
/** Chasing stops this fraction of the attack range from the target (it never pushes into it). */
const STOP_FRACTION = 0.85;
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

function eyeOf(enemy: Enemy, out: Vector3): Vector3 {
  return out.copy(enemy.motor.position).setY(enemy.motor.position.y + enemy.config.body.eyeHeight);
}

function targetEyeOf(target: EnemyTarget, out: Vector3): Vector3 {
  return out.copy(target.position).setY(target.position.y + target.eyeHeight);
}

function inAttackRange(enemy: Enemy, target: EnemyTarget): boolean {
  const pos = enemy.motor.position;
  return (
    horizontalDistance(pos, target.position) <= enemy.config.attackRange &&
    Math.abs(target.position.y - pos.y) <= enemy.config.attack.verticalReach
  );
}

function transition(enemy: Enemy, to: Parameters<Enemy['fsm']['transition']>[0]): void {
  if (enemy.state !== to) {
    enemy.fsm.transition(to);
  }
}

function enterIdle(enemy: Enemy, ctx: BrainContext): void {
  transition(enemy, 'IDLE');
  const { pauseMin, pauseMax } = enemy.config.patrol;
  enemy.idleTimer = ctx.rng.range(pauseMin, pauseMax);
  enemy.navMode = 'none';
}

function resetPose(enemy: Enemy): void {
  enemy.rig.setPose(enemy.config.rig);
}

function cancelAttack(enemy: Enemy, ctx: BrainContext, reason: AttackCancelReason): void {
  if (enemy.attackPhase === 'windup') {
    ctx.events.emit('attackCancelled', { id: enemy.id, reason });
  }
  enemy.attackPhase = 'none';
  enemy.attackTimer = 0;
  resetPose(enemy);
}

function setTarget(enemy: Enemy, ctx: BrainContext, target: EnemyTarget, alerted: boolean): void {
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

function loseTarget(enemy: Enemy, ctx: BrainContext, reason: TargetLossReason): void {
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
  if (enemy.state === 'DETECT' || enemy.state === 'CHASE' || enemy.state === 'ATTACK') {
    cancelAttack(enemy, ctx, 'lostTarget');
    enterIdle(enemy, ctx);
  }
}

/** Sight, memory and range: keeps, loses or acquires a target. Casts at most one ray per target. */
function perceive(enemy: Enemy, ctx: BrainContext): void {
  const pos = enemy.motor.position;
  const target = enemy.target;
  if (target) {
    const { loseTargetRange, targetMemory } = enemy.config.perception;
    if (!target.isAlive()) {
      loseTarget(enemy, ctx, 'dead');
    } else {
      enemy.canSeeTarget = ctx.lines.lineOfSight(
        eyeOf(enemy, _eye),
        targetEyeOf(target, _targetEye),
      );
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
    if (ctx.lines.lineOfSight(eyeOf(enemy, _eye), targetEyeOf(candidate, _targetEye))) {
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
function planChase(enemy: Enemy, ctx: BrainContext, target: EnemyTarget): void {
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
function checkProgress(enemy: Enemy, ctx: BrainContext): void {
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

function startAttack(enemy: Enemy, ctx: BrainContext, target: EnemyTarget): void {
  transition(enemy, 'ATTACK');
  const { config } = enemy;
  enemy.attackPhase = 'windup';
  enemy.attackTimer = config.attack.windup;
  enemy.attackYaw = yawToward(enemy.motor.position, target.position);
  enemy.attackCooldown = config.attackCooldown;
  enemy.attacks++;
  enemy.directBlocked = false; // it got there: whatever was in the way is behind it
  if (config.attackPose) {
    enemy.rig.setPose(config.attackPose);
  }
  enemy.moveSpeed = 0;
  enemy.faceYaw = enemy.attackYaw;
  ctx.events.emit('attackStarted', {
    id: enemy.id,
    targetId: target.id,
    windup: config.attack.windup,
  });
}

/** The end of the wind-up: one strike, which lands only if the target is still there. */
function strike(enemy: Enemy, ctx: BrainContext): void {
  const target = enemy.target;
  const { config } = enemy;
  const pos = enemy.motor.position;
  let miss: AttackMissReason | null = null;
  if (!target?.isAlive()) {
    miss = 'dead';
  } else if (Math.abs(target.position.y - pos.y) > config.attack.verticalReach) {
    miss = 'height';
  } else if (horizontalDistance(pos, target.position) > config.attack.reach) {
    miss = 'range';
  } else if (
    Math.abs(angleDelta(enemy.attackYaw, yawToward(pos, target.position))) >
    (config.attack.arcDeg * Math.PI) / 360
  ) {
    miss = 'arc';
  } else if (!ctx.lines.lineOfSight(eyeOf(enemy, _eye), targetEyeOf(target, _targetEye))) {
    miss = 'blocked';
  }
  const targetId = target?.id ?? '';
  if (miss !== null || !target) {
    ctx.events.emit('attackMissed', { id: enemy.id, targetId, reason: miss ?? 'dead' });
    return;
  }
  const dx = target.position.x - pos.x;
  const dz = target.position.z - pos.z;
  const length = Math.hypot(dx, dz) || 1;
  const amount = target.receiveHit({
    amount: config.attackDamage,
    attackerId: enemy.id,
    archetype: config.id,
    direction: [dx / length, 0, dz / length],
  });
  ctx.events.emit('attackHit', {
    id: enemy.id,
    targetId,
    amount,
    damage: config.attackDamage,
  });
}

function recover(enemy: Enemy, ctx: BrainContext): void {
  const target = enemy.target;
  if (!target) {
    enterIdle(enemy, ctx);
  } else if (inAttackRange(enemy, target) && enemy.canSeeTarget) {
    transition(enemy, 'ATTACK');
    enemy.attackPhase = 'none';
  } else {
    transition(enemy, 'CHASE');
  }
}

/**
 * Told about a target (hit by it, or alerted by the game): notices it without needing to see it,
 * and keeps it for `duration` seconds whatever the range or sight (refreshed by later alerts).
 */
function alertTo(enemy: Enemy, ctx: BrainContext, target: EnemyTarget, duration: number): void {
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

export const meleeBrain: EnemyBrain = {
  think(enemy, ctx) {
    if (!enemy.alive) {
      return;
    }
    perceive(enemy, ctx);
    switch (enemy.state) {
      case 'IDLE':
        if (enemy.patrols && enemy.idleTimer <= 0) {
          if (choosePatrolPoint(enemy, ctx)) {
            transition(enemy, 'PATROL');
            enemy.patrolTimer = PATROL_TIMEOUT;
            enemy.progressAnchor.copy(enemy.motor.position);
            enemy.progressTimer = 0;
          } else {
            enemy.idleTimer = ctx.rng.range(
              enemy.config.patrol.pauseMin,
              enemy.config.patrol.pauseMax,
            );
          }
        }
        break;
      case 'PATROL':
        checkProgress(enemy, ctx);
        break;
      case 'CHASE':
        if (enemy.target) {
          planChase(enemy, ctx, enemy.target);
          checkProgress(enemy, ctx);
        }
        break;
      default:
        break;
    }
  },

  update(enemy, ctx) {
    if (!enemy.alive) {
      return;
    }
    const { config } = enemy;
    const pos = enemy.motor.position;
    const target = enemy.target;
    enemy.moveSpeed = 0;
    enemy.faceYaw = null;

    switch (enemy.state) {
      case 'IDLE':
        break;

      case 'PATROL':
        enemy.patrolTimer = countDown(enemy.patrolTimer, ctx.dt);
        if (
          horizontalDistance(pos, enemy.patrolPoint) < ctx.rules.arrivalRadius ||
          enemy.patrolTimer <= 0
        ) {
          enterIdle(enemy, ctx);
          break;
        }
        enemy.moveGoal.copy(enemy.patrolPoint);
        enemy.moveSpeed = config.patrol.speedFactor;
        break;

      case 'DETECT':
        if (!target) {
          enterIdle(enemy, ctx);
          break;
        }
        enemy.faceYaw = yawToward(pos, target.position);
        if (enemy.fsm.time >= config.perception.reactionTime - TIMER_EPSILON) {
          if (inAttackRange(enemy, target) && enemy.canSeeTarget && enemy.attackCooldown <= 0) {
            startAttack(enemy, ctx, target);
          } else {
            transition(enemy, 'CHASE');
          }
        }
        break;

      case 'CHASE': {
        if (!target) {
          enterIdle(enemy, ctx);
          break;
        }
        if (inAttackRange(enemy, target) && enemy.canSeeTarget) {
          enemy.faceYaw = yawToward(pos, target.position);
          if (enemy.attackCooldown <= 0) {
            startAttack(enemy, ctx, target);
          }
          break;
        }
        if (enemy.navMode === 'direct') {
          enemy.moveGoal.copy(target.position);
          const stop = config.attackRange * STOP_FRACTION;
          enemy.moveSpeed = horizontalDistance(pos, target.position) <= stop ? 0 : 1;
        } else if (enemy.navMode === 'route' && ctx.routes && enemy.route.length > 0) {
          let node = enemy.route[enemy.routeCursor];
          if (node !== undefined) {
            const at = ctx.routes.position(node);
            if (
              horizontalDistance(pos, at) < ctx.rules.arrivalRadius &&
              Math.abs(at.y - pos.y) < 1
            ) {
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
            horizontalDistance(pos, enemy.lastKnownTargetPosition) > ctx.rules.arrivalRadius
              ? 1
              : 0;
        }
        if (enemy.moveSpeed === 0) {
          enemy.faceYaw = yawToward(pos, target.position);
        }
        break;
      }

      case 'ATTACK':
        if (enemy.attackPhase === 'windup') {
          enemy.faceYaw = enemy.attackYaw;
          enemy.attackTimer = countDown(enemy.attackTimer, ctx.dt);
          if (enemy.attackTimer <= 0) {
            strike(enemy, ctx);
            enemy.attackPhase = 'recovery';
            enemy.attackTimer = config.attack.recovery;
          }
        } else if (enemy.attackPhase === 'recovery') {
          if (target) {
            enemy.faceYaw = yawToward(pos, target.position);
          }
          enemy.attackTimer = countDown(enemy.attackTimer, ctx.dt);
          if (enemy.attackTimer <= 0) {
            enemy.attackPhase = 'none';
            resetPose(enemy);
          }
        } else if (!target) {
          enterIdle(enemy, ctx);
        } else if (inAttackRange(enemy, target) && enemy.canSeeTarget) {
          enemy.faceYaw = yawToward(pos, target.position);
          if (enemy.attackCooldown <= 0) {
            startAttack(enemy, ctx, target);
          }
        } else {
          transition(enemy, 'CHASE');
        }
        break;

      case 'STAGGER':
        enemy.staggerTimer = countDown(enemy.staggerTimer, ctx.dt);
        if (enemy.staggerTimer <= 0) {
          recover(enemy, ctx);
        }
        break;

      case 'DEAD':
        break;
    }
  },

  onDamaged(enemy, ctx, attacker) {
    if (attacker) {
      alertTo(enemy, ctx, attacker, enemy.config.perception.targetMemory);
    }
  },

  onStaggered(enemy, ctx) {
    if (!enemy.alive) {
      return;
    }
    cancelAttack(enemy, ctx, 'stagger');
    enemy.staggerTimer = enemy.config.staggerDuration;
    transition(enemy, 'STAGGER');
    ctx.events.emit('staggered', { id: enemy.id });
  },

  alert(enemy, ctx, target) {
    alertTo(enemy, ctx, target, Number.POSITIVE_INFINITY);
  },
};
