/**
 * The ranged attacker (D-046): the behaviour of an enemy that keeps its distance and throws a
 * projectile. The Spitter uses it. Everything but the attack is shared (`common.ts`: perception,
 * navigation, idle and patrol, alerts, stagger, and keeping its distance like the Screamer):
 *
 * - CHASE is positioning: it closes in beyond `preferredRange.max` (or without sight), holds
 *   between `min` and `max`, and backs away once the target is inside `retreat`. Too close, it
 *   backs off before it spits (rushing it works), unless it is cornered.
 * - ATTACK: when it can see the target within its attack range and the cooldown allows, a long,
 *   readable wind-up (the telegraph: the head rears back, the throat glows) while it keeps facing
 *   the target; then one projectile is let fly (a `spat` event) on a low arc at where the target
 *   is at that moment, with no lead, so moving during the flight dodges it; then a recovery.
 * - A stagger interrupts the wind-up: nothing is thrown, and the cooldown has still been spent.
 *
 * It never hurts anyone itself: `EnemyProjectiles` flies the projectile and applies its hit, through
 * the target's own damage rules (D-029). No hitscan: every ranged hit can be seen coming.
 */

import { Vector3 } from 'three';
import { countDown, TIMER_EPSILON } from '../../weapons/timing';
import type { Enemy } from '../Enemy';
import type { EnemyTarget } from '../types';
import type { BrainContext, EnemyBrain } from './brain';
import {
  alertTo,
  cooldownOf,
  enterIdle,
  horizontalDistance,
  perceive,
  resetPose,
  stagger,
  thinkIdle,
  thinkStandoff,
  tooClose,
  transition,
  updatePatrol,
  updateStandoff,
  windupOf,
  yawToward,
} from './common';

/** Where it spits from: its mouth, just in front of and below its eyes (metres). */
const MOUTH_FORWARD = 0.35;
const MOUTH_BELOW_EYES = 0.12;
/** Where it aims: this fraction of the target's eye height (the chest). */
const AIM_HEIGHT = 0.75;

const _from = new Vector3();
const _to = new Vector3();
const _velocity = new Vector3();

/**
 * The launch velocity that lobs a projectile of `speed` from `from` to `to` under `gravity`, on
 * the lower (flatter, faster) of the two arcs. Out of reach, it throws at 45° (its farthest arc).
 * Writes `out`; returns false when the target was out of reach.
 */
export function lobVelocity(
  from: Vector3,
  to: Vector3,
  speed: number,
  gravity: number,
  out: Vector3,
): boolean {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const x = Math.hypot(dx, dz);
  const y = to.y - from.y;
  const v2 = speed * speed;
  if (x < 1e-6) {
    out.set(0, y >= 0 ? speed : -speed, 0);
    return true;
  }
  const disc = v2 * v2 - gravity * (gravity * x * x + 2 * y * v2);
  const reachable = disc >= 0;
  const angle =
    gravity <= 0
      ? Math.atan2(y, x)
      : reachable
        ? Math.atan((v2 - Math.sqrt(disc)) / (gravity * x))
        : Math.PI / 4;
  const horizontal = speed * Math.cos(angle);
  out.set((dx / x) * horizontal, speed * Math.sin(angle), (dz / x) * horizontal);
  return reachable;
}

/** Where its projectile leaves from (its mouth), facing `yaw`. */
export function mouthOf(enemy: Enemy, yaw: number, out: Vector3): Vector3 {
  const p = enemy.motor.position;
  return out.set(
    p.x - Math.sin(yaw) * MOUTH_FORWARD,
    p.y + enemy.config.body.eyeHeight - MOUTH_BELOW_EYES,
    p.z - Math.cos(yaw) * MOUTH_FORWARD,
  );
}

/** Where it aims at a target: its chest. */
export function aimPointOf(target: EnemyTarget, out: Vector3): Vector3 {
  return out.copy(target.position).setY(target.position.y + target.eyeHeight * AIM_HEIGHT);
}

function canAttack(enemy: Enemy, target: EnemyTarget): boolean {
  const pos = enemy.motor.position;
  return (
    enemy.config.projectile !== undefined &&
    enemy.attackCooldown <= 0 &&
    !tooClose(enemy, target) &&
    enemy.canSeeTarget &&
    target.isAlive() &&
    horizontalDistance(pos, target.position) <= enemy.config.attackRange &&
    Math.abs(target.position.y - pos.y) <= enemy.config.attack.verticalReach
  );
}

function startAttack(enemy: Enemy, ctx: BrainContext, target: EnemyTarget): void {
  transition(enemy, 'ATTACK');
  const { config } = enemy;
  enemy.attackPhase = 'windup';
  const windup = windupOf(enemy, ctx.now);
  enemy.attackTimer = windup;
  enemy.attackYaw = yawToward(enemy.motor.position, target.position);
  // Spent at the start: an interrupted spit still has to wait for its cooldown.
  enemy.attackCooldown = cooldownOf(enemy, ctx.now);
  enemy.attacks++;
  enemy.retreating = false;
  if (config.attackPose) {
    enemy.rig.setPose(config.attackPose);
  }
  ctx.events.emit('attackStarted', { id: enemy.id, targetId: target.id, windup, kind: 'spit' });
}

/** The end of the wind-up: one projectile at where the target is now (no lead). */
function release(enemy: Enemy, ctx: BrainContext): void {
  const target = enemy.target;
  const projectile = enemy.config.projectile;
  if (!target?.isAlive() || !projectile) {
    ctx.events.emit('attackMissed', {
      id: enemy.id,
      targetId: target?.id ?? '',
      reason: 'dead',
    });
    return;
  }
  const yaw = yawToward(enemy.motor.position, target.position);
  enemy.attackYaw = yaw;
  mouthOf(enemy, yaw, _from);
  aimPointOf(target, _to);
  lobVelocity(_from, _to, projectile.speed, projectile.gravity, _velocity);
  ctx.events.emit('spat', {
    id: enemy.id,
    targetId: target.id,
    archetype: enemy.config.id,
    position: [_from.x, _from.y, _from.z],
    velocity: [_velocity.x, _velocity.y, _velocity.z],
  });
}

function recover(enemy: Enemy, ctx: BrainContext): void {
  if (enemy.target) {
    transition(enemy, 'CHASE');
  } else {
    enterIdle(enemy, ctx);
  }
}

export const rangedBrain: EnemyBrain = {
  think(enemy, ctx) {
    if (!enemy.alive) {
      return;
    }
    perceive(enemy, ctx);
    if (enemy.state === 'IDLE' || enemy.state === 'PATROL') {
      thinkIdle(enemy, ctx);
      return;
    }
    const target = enemy.target;
    if (enemy.state === 'CHASE' && target) {
      thinkStandoff(enemy, ctx, target);
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
    enemy.speedScale = 1;
    enemy.accelerationScale = 1;

    switch (enemy.state) {
      case 'IDLE':
        break;

      case 'PATROL':
        updatePatrol(enemy, ctx);
        break;

      case 'DETECT':
        if (!target) {
          enterIdle(enemy, ctx);
          break;
        }
        enemy.faceYaw = yawToward(pos, target.position);
        if (enemy.fsm.time >= config.perception.reactionTime - TIMER_EPSILON) {
          if (canAttack(enemy, target)) {
            startAttack(enemy, ctx, target);
          } else {
            transition(enemy, 'CHASE');
          }
        }
        break;

      case 'CHASE':
        if (!target) {
          enterIdle(enemy, ctx);
          break;
        }
        if (canAttack(enemy, target)) {
          startAttack(enemy, ctx, target);
          break;
        }
        updateStandoff(enemy, ctx, target);
        break;

      case 'ATTACK':
        if (enemy.attackPhase === 'windup') {
          // It keeps facing the target through the wind-up: the tell says where it will throw.
          if (target) {
            enemy.faceYaw = yawToward(pos, target.position);
          }
          enemy.attackTimer = countDown(enemy.attackTimer, ctx.dt);
          if (enemy.attackTimer <= 0) {
            release(enemy, ctx);
            enemy.attackPhase = 'recovery';
            enemy.attackTimer = config.attack.recovery;
          }
        } else if (enemy.attackPhase === 'recovery') {
          enemy.attackTimer = countDown(enemy.attackTimer, ctx.dt);
          if (enemy.attackTimer <= 0) {
            enemy.attackPhase = 'none';
            resetPose(enemy);
          }
        } else {
          recover(enemy, ctx);
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
    stagger(enemy, ctx);
  },

  alert(enemy, ctx, target, duration = Number.POSITIVE_INFINITY, lastKnown = null) {
    alertTo(enemy, ctx, target, duration, lastKnown);
  },

  forceAttack(enemy, ctx) {
    const target = enemy.target;
    const free = enemy.state === 'DETECT' || enemy.state === 'CHASE' || enemy.state === 'ATTACK';
    if (!enemy.alive || !target || !free || enemy.attackPhase !== 'none') {
      return false;
    }
    startAttack(enemy, ctx, target);
    return true;
  },
};
