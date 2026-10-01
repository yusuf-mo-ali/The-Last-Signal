/**
 * The melee chaser (D-042, D-043): the behaviour of an enemy that walks up to its target and hits
 * it. The Walker, the Runner and the Tank all use it with their own numbers; two optional config
 * blocks change how it plays, never an archetype id:
 * - `weave`: in the open, at mid range, it approaches in a zig-zag (the Runner);
 * - `attack.lunge`: between the wind-up and the strike it leaps along its locked facing, so it can
 *   start an attack from further away (the Runner).
 *
 * States (plan §11; transitions in `EnemyStateMachine`):
 * - IDLE / PATROL: no target (see `common.ts`).
 * - DETECT: it saw its target (within detection range, in line of sight) or was hit or alerted;
 *   it turns to face the target for its reaction time, then chases or attacks.
 * - CHASE: walks straight at the target when a body can walk that line, otherwise along the route
 *   graph; stops just short of it.
 * - ATTACK: in range and in sight: a committed wind-up (the telegraph; no moving, the facing
 *   locked), optionally a leap, one strike that lands only if the target is still in reach, in
 *   front and not behind a wall, then recovery; again when the cooldown allows, back to CHASE when
 *   out of range.
 * - STAGGER: a stagger cancels any wind-up or leap and stops it for its stagger duration; then back
 *   to whatever fits (attack, chase or idle).
 *
 * Decisions that cast rays run in `think` (limited rate); timing that must be exact (reaction,
 * wind-up, leap, strike, recovery, stagger) runs in `update`, every fixed step.
 */

import { Vector3 } from 'three';
import { countDown, TIMER_EPSILON } from '../../weapons/timing';
import type { Enemy } from '../Enemy';
import type { AttackMissReason } from '../events';
import type { EnemyTarget } from '../types';
import type { BrainContext, EnemyBrain } from './brain';
import {
  alertTo,
  angleDelta,
  checkProgress,
  cooldownOf,
  enterIdle,
  followPath,
  horizontalDistance,
  inAttackRange,
  perceive,
  planChase,
  resetPose,
  sees,
  stagger,
  thinkIdle,
  transition,
  updatePatrol,
  windupOf,
  yawToward,
} from './common';

export { angleDelta, horizontalDistance, yawToward } from './common';

/** Chasing stops this fraction of the attack range from the target (it never pushes into it). */
const STOP_FRACTION = 0.85;
/** Metres ahead of itself a weaving enemy aims (the zig-zag's step). */
const WEAVE_LOOKAHEAD = 3;
/** A leap ends early this far (beyond both bodies) from the target: it never lands inside it. */
const LUNGE_CLEARANCE = 0.25;
/** How much harder than usual it brakes out of a leap. */
const LANDING_BRAKE = 8;

const _dir = new Vector3();
const _probe = new Vector3();

/** In the open at mid range: which way to zig-zag now (decided in `think`, where rays belong). */
function planWeave(enemy: Enemy, ctx: BrainContext, target: EnemyTarget): void {
  const weave = enemy.config.weave;
  enemy.weaveSide = 0;
  if (!weave || enemy.navMode !== 'direct') {
    return;
  }
  const pos = enemy.motor.position;
  const d = horizontalDistance(pos, target.position);
  if (d < weave.minDistance || d > weave.maxDistance) {
    return;
  }
  // Switch sides every `period` seconds; the phase differs per enemy so a pack does not mirror.
  const side = Math.sin((Math.PI * ctx.now) / weave.period + enemy.spawnNumber * 1.7) >= 0 ? 1 : -1;
  weaveGoal(enemy, target, side, _probe);
  if (ctx.lines.walkable(pos, _probe, enemy.config.body.radius)) {
    enemy.weaveSide = side;
  }
}

/** The point a weaving enemy heads for: `WEAVE_LOOKAHEAD` ahead, `angleDeg` off the line. */
function weaveGoal(enemy: Enemy, target: EnemyTarget, side: number, out: Vector3): Vector3 {
  const pos = enemy.motor.position;
  const angle =
    yawToward(pos, target.position) +
    (side * ((enemy.config.weave?.angleDeg ?? 0) * Math.PI)) / 180;
  return out.set(
    pos.x - Math.sin(angle) * WEAVE_LOOKAHEAD,
    pos.y,
    pos.z - Math.cos(angle) * WEAVE_LOOKAHEAD,
  );
}

function startAttack(enemy: Enemy, ctx: BrainContext, target: EnemyTarget): void {
  transition(enemy, 'ATTACK');
  const { config } = enemy;
  enemy.attackPhase = 'windup';
  const windup = windupOf(enemy, ctx.now);
  enemy.attackTimer = windup;
  enemy.attackYaw = yawToward(enemy.motor.position, target.position);
  enemy.attackCooldown = cooldownOf(enemy, ctx.now);
  enemy.attacks++;
  enemy.directBlocked = false; // it got there: whatever was in the way is behind it
  enemy.weaveSide = 0;
  if (config.attackPose) {
    enemy.rig.setPose(config.attackPose);
  }
  enemy.moveSpeed = 0;
  enemy.faceYaw = enemy.attackYaw;
  ctx.events.emit('attackStarted', {
    id: enemy.id,
    targetId: target.id,
    windup,
    kind: 'strike',
  });
}

/** The end of the wind-up (or leap): one strike, which lands only if the target is still there. */
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
  } else if (!sees(enemy, ctx, target)) {
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

function endWindupOrLunge(enemy: Enemy, ctx: BrainContext): void {
  strike(enemy, ctx);
  enemy.attackPhase = 'recovery';
  enemy.attackTimer = enemy.config.attack.recovery;
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

export const meleeBrain: EnemyBrain = {
  think(enemy, ctx) {
    if (!enemy.alive) {
      return;
    }
    perceive(enemy, ctx);
    if (enemy.state === 'IDLE' || enemy.state === 'PATROL') {
      thinkIdle(enemy, ctx);
    } else if (enemy.state === 'CHASE' && enemy.target) {
      planChase(enemy, ctx, enemy.target);
      planWeave(enemy, ctx, enemy.target);
      checkProgress(enemy, ctx);
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
        followPath(enemy, ctx, target, config.attackRange * STOP_FRACTION);
        if (enemy.weaveSide !== 0 && enemy.navMode === 'direct' && enemy.moveSpeed > 0) {
          weaveGoal(enemy, target, enemy.weaveSide, enemy.moveGoal);
        }
        break;
      }

      case 'ATTACK':
        if (enemy.attackPhase === 'windup') {
          enemy.faceYaw = enemy.attackYaw;
          enemy.attackTimer = countDown(enemy.attackTimer, ctx.dt);
          if (enemy.attackTimer <= 0) {
            const lunge = config.attack.lunge;
            if (lunge && lunge.distance > 0 && lunge.speed > 0) {
              enemy.attackPhase = 'lunge';
              enemy.attackTimer = lunge.distance / lunge.speed;
            } else {
              endWindupOrLunge(enemy, ctx);
            }
          }
        }
        if (enemy.attackPhase === 'lunge') {
          // Committed: straight along the locked facing, fast, until it lands or reaches the target.
          const lunge = config.attack.lunge;
          const close =
            target !== null &&
            horizontalDistance(pos, target.position) <=
              config.body.radius + target.radius + LUNGE_CLEARANCE;
          if (!lunge || enemy.attackTimer <= 0 || close) {
            endWindupOrLunge(enemy, ctx);
          } else {
            _dir.set(-Math.sin(enemy.attackYaw), 0, -Math.cos(enemy.attackYaw));
            enemy.moveGoal.copy(pos).addScaledVector(_dir, lunge.distance + 1);
            enemy.moveSpeed = 1;
            enemy.speedScale = lunge.speed / Math.max(0.01, config.moveSpeed);
            enemy.accelerationScale = 20;
            enemy.attackTimer = countDown(enemy.attackTimer, ctx.dt);
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
        } else if (enemy.attackPhase === 'none') {
          if (!target) {
            enterIdle(enemy, ctx);
          } else if (inAttackRange(enemy, target) && enemy.canSeeTarget) {
            enemy.faceYaw = yawToward(pos, target.position);
            if (enemy.attackCooldown <= 0) {
              startAttack(enemy, ctx, target);
            }
          } else {
            transition(enemy, 'CHASE');
          }
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
    // Out of a leap (landed, or knocked out of it), it plants its feet instead of sliding on.
    if (enemy.attackPhase !== 'lunge' && config.attack.lunge) {
      const v = enemy.motor.velocity;
      if (Math.hypot(v.x, v.z) > enemy.cruiseSpeed(ctx.now) * 1.05) {
        enemy.accelerationScale = LANDING_BRAKE;
      }
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
    enemy.attackCooldown = 0;
    startAttack(enemy, ctx, target);
    return true;
  },
};
