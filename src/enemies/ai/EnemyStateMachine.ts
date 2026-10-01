/**
 * One enemy's AI state machine (plan §11, ARCHITECTURE §7.4, D-042): the plan's seven states and
 * one table of legal transitions, so behaviour is explicit rather than a set of booleans. Anything
 * not in the table is refused (or throws in strict mode), which makes transitions testable.
 *
 * Generic: the table is the same for every archetype. What triggers a transition (distances,
 * timers, combat events) is decided by the behaviour driving the enemy.
 */

import type { AiState } from '../../config/enemies';

/**
 * Every legal transition, by source state. There are no self-transitions: re-entering a state
 * (a second stagger, a new attack) is handled inside the state.
 *
 * - IDLE / PATROL: no target. PATROL is a short walk around the spawn point.
 * - DETECT: a target was noticed; the readable "noticed you" tell before acting.
 * - CHASE: walking to the target (straight, or along the route graph).
 * - ATTACK: in range: wind-up, strike, recovery, and again while the target stays in range.
 * - STAGGER: stunned by a hit; returns to whatever fits afterwards.
 * - DEAD: terminal. A pooled enemy is reset to IDLE with `reset`, not by a transition.
 */
export const ENEMY_TRANSITIONS: Readonly<Record<AiState, readonly AiState[]>> = {
  IDLE: ['PATROL', 'DETECT', 'STAGGER', 'DEAD'],
  PATROL: ['IDLE', 'DETECT', 'STAGGER', 'DEAD'],
  DETECT: ['CHASE', 'ATTACK', 'IDLE', 'STAGGER', 'DEAD'],
  CHASE: ['ATTACK', 'IDLE', 'STAGGER', 'DEAD'],
  ATTACK: ['CHASE', 'IDLE', 'STAGGER', 'DEAD'],
  STAGGER: ['IDLE', 'CHASE', 'ATTACK', 'DEAD'],
  DEAD: [],
};

export class InvalidEnemyTransitionError extends Error {
  constructor(from: AiState, to: AiState) {
    super(`Illegal enemy AI transition ${from} → ${to}`);
    this.name = 'InvalidEnemyTransitionError';
  }
}

export type EnemyStateListener = (from: AiState, to: AiState) => void;

export class EnemyStateMachine {
  private current: AiState;
  private elapsed = 0;
  private readonly strict: boolean;
  private readonly listener: EnemyStateListener | undefined;

  constructor(
    options: { initial?: AiState; strict?: boolean; onChange?: EnemyStateListener } = {},
  ) {
    this.current = options.initial ?? 'IDLE';
    this.strict = options.strict ?? false;
    this.listener = options.onChange;
  }

  get state(): AiState {
    return this.current;
  }

  /** Seconds spent in the current state (advanced by `advance`). */
  get time(): number {
    return this.elapsed;
  }

  is(state: AiState): boolean {
    return this.current === state;
  }

  canTransition(to: AiState): boolean {
    return ENEMY_TRANSITIONS[this.current].includes(to);
  }

  /** Moves to `to` if legal. Returns whether it did (throws instead in strict mode). */
  transition(to: AiState): boolean {
    if (!this.canTransition(to)) {
      if (this.strict) {
        throw new InvalidEnemyTransitionError(this.current, to);
      }
      return false;
    }
    const from = this.current;
    this.current = to;
    this.elapsed = 0;
    this.listener?.(from, to);
    return true;
  }

  advance(dt: number): void {
    this.elapsed += dt;
  }

  /** Back to IDLE for reuse (a pooled enemy spawning again). Not a transition: no listener. */
  reset(state: AiState = 'IDLE'): void {
    this.current = state;
    this.elapsed = 0;
  }
}
