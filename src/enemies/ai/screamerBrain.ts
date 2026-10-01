/**
 * The support caster (D-043): the behaviour of an enemy that does not fight in melee but disrupts
 * from a distance. The Screamer uses it. It shares everything else with the melee chaser
 * (`common.ts`: perception, navigation, idle and patrol, alerts, stagger) and the same state
 * machine; only positioning and the attack differ:
 *
 * - CHASE is positioning: it closes in beyond `preferredRange.max` (or when it cannot see the
 *   target), backs away inside `preferredRange.min`, and otherwise holds its ground facing it.
 * - ATTACK is its ability: when it can see the target within its attack range and the cooldown
 *   allows, a long, readable wind-up (the telegraph), then the ability goes off: a scream raises
 *   an alarm (a generic `alarm` event, heard within `ability.radius`), then a recovery.
 * - A stagger (any solid hit) interrupts the wind-up: nothing goes off, and the cooldown has
 *   still been spent, so interrupting a scream buys time.
 *
 * It never deals damage itself; what the alarm does is up to whoever listens (`EnemyManager`'s
 * response: nearby enemies are told where the target is, hastened and frenzied, D-046).
 */

import { Vector3 } from 'three';
import { countDown, TIMER_EPSILON } from '../../weapons/timing';
import type { Enemy } from '../Enemy';
import type { EnemyTarget } from '../types';
import type { BrainContext, EnemyBrain } from './brain';
import {
  alertTo,
  checkProgress,
  cooldownOf,
  enterIdle,
  followPath,
  horizontalDistance,
  perceive,
  planChase,
  resetPose,
  stagger,
  thinkIdle,
  transition,
  updatePatrol,
  windupOf,
  yawToward,
} from './common';

/** Metres per retreat step. */
const RETREAT_STEP = 3;
/** Directions tried when backing away: straight away first, then veering off (radians). */
const RETREAT_ANGLES = [0, Math.PI / 4, -Math.PI / 4, Math.PI / 2, -Math.PI / 2];

const _away = new Vector3();

function band(enemy: Enemy): { min: number; max: number } {
  return enemy.config.preferredRange ?? { min: 0, max: enemy.config.attackRange * 0.8 };
}

function canUseAbility(enemy: Enemy, target: EnemyTarget): boolean {
  const pos = enemy.motor.position;
  return (
    enemy.attackCooldown <= 0 &&
    enemy.canSeeTarget &&
    target.isAlive() &&
    horizontalDistance(pos, target.position) <= enemy.config.attackRange &&
    Math.abs(target.position.y - pos.y) <= enemy.config.attack.verticalReach
  );
}

function startAbility(enemy: Enemy, ctx: BrainContext, target: EnemyTarget): void {
  transition(enemy, 'ATTACK');
  const { config } = enemy;
  enemy.attackPhase = 'windup';
  const windup = windupOf(enemy, ctx.now);
  enemy.attackTimer = windup;
  enemy.attackYaw = yawToward(enemy.motor.position, target.position);
  // Spent at the start: an interrupted scream still has to wait for its cooldown.
  enemy.attackCooldown = cooldownOf(enemy, ctx.now);
  enemy.attacks++;
  enemy.retreating = false;
  if (config.attackPose) {
    enemy.rig.setPose(config.attackPose);
  }
  ctx.events.emit('attackStarted', {
    id: enemy.id,
    targetId: target.id,
    windup,
    kind: 'scream',
  });
}

/** The end of the wind-up: the ability goes off (an alarm) whether or not anyone hears it. */
function release(enemy: Enemy, ctx: BrainContext): void {
  const ability = enemy.config.ability;
  const p = enemy.motor.position;
  const target = enemy.target?.isAlive() ? enemy.target : null;
  ctx.events.emit('alarm', {
    sourceId: enemy.id,
    kind: ability?.kind ?? 'scream',
    position: [p.x, p.y, p.z],
    radius: ability?.radius ?? 0,
    targetId: target?.id ?? null,
    targetPosition: target ? [target.position.x, target.position.y, target.position.z] : null,
    alertDuration: ability?.alertDuration ?? 0,
    alertMode: 'live',
    haste: ability ? { ...ability.haste } : null,
    frenzy: ability?.frenzy ? { ...ability.frenzy } : null,
    // The Screamer calls the horde in: the wave runtime pulls its next group forward (D-045).
    reinforcements: true,
    time: ctx.now,
  });
}

/** Where to back away to: a walkable point away from the target, or none (stand its ground). */
function planRetreat(enemy: Enemy, ctx: BrainContext, target: EnemyTarget): void {
  const pos = enemy.motor.position;
  const away = yawToward(target.position, pos);
  for (const offset of RETREAT_ANGLES) {
    const yaw = away + offset;
    _away.set(pos.x - Math.sin(yaw) * RETREAT_STEP, pos.y, pos.z - Math.cos(yaw) * RETREAT_STEP);
    if (ctx.lines.walkable(pos, _away, enemy.config.body.radius)) {
      enemy.patrolPoint.copy(_away);
      enemy.retreating = true;
      return;
    }
  }
  enemy.retreating = false;
}

function recover(enemy: Enemy, ctx: BrainContext): void {
  if (enemy.target) {
    transition(enemy, 'CHASE');
  } else {
    enterIdle(enemy, ctx);
  }
}

export const screamerBrain: EnemyBrain = {
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
    if (enemy.state !== 'CHASE' || !target) {
      return;
    }
    const d = horizontalDistance(enemy.motor.position, target.position);
    const { min, max } = band(enemy);
    if (!enemy.canSeeTarget || d > max) {
      enemy.retreating = false;
      planChase(enemy, ctx, target);
    } else if (d < min) {
      if (!enemy.retreating) {
        planRetreat(enemy, ctx, target);
      }
    } else {
      enemy.retreating = false;
      enemy.navMode = 'none';
    }
    checkProgress(enemy, ctx);
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
          if (canUseAbility(enemy, target)) {
            startAbility(enemy, ctx, target);
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
        if (canUseAbility(enemy, target)) {
          startAbility(enemy, ctx, target);
          break;
        }
        const d = horizontalDistance(pos, target.position);
        const { min, max } = band(enemy);
        if (enemy.retreating) {
          if (d >= min || horizontalDistance(pos, enemy.patrolPoint) < ctx.rules.arrivalRadius) {
            enemy.retreating = false;
            enemy.faceYaw = yawToward(pos, target.position);
          } else {
            enemy.moveGoal.copy(enemy.patrolPoint);
            enemy.moveSpeed = 1;
          }
        } else if (enemy.canSeeTarget && d <= max) {
          enemy.faceYaw = yawToward(pos, target.position); // hold its ground
        } else {
          followPath(enemy, ctx, target, max * 0.9);
        }
        break;
      }

      case 'ATTACK':
        if (enemy.attackPhase === 'windup') {
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
    startAbility(enemy, ctx, target);
    return true;
  },
};
