/**
 * Turns game actions into a movement intent (plan §8, D-017). It asks about actions
 * ("moveForward"), never keys, so rebinding needs no change here; the bindings live in
 * `config/input.ts` and are resolved by `input/ActionMap`.
 */

import type { InputAction } from '../config/input';
import type { MoveIntent } from './PlayerMotor';

/** The slice of `ActionMap` the controller needs, sampled once per fixed step. */
export interface ActionSource {
  isDown(action: InputAction): boolean;
  wasPressed(action: InputAction): boolean;
}

export class PlayerController {
  private readonly actions: ActionSource;

  constructor(actions: ActionSource) {
    this.actions = actions;
  }

  /** The intent for the current fixed step. Opposite keys cancel out. */
  read(): MoveIntent {
    const a = this.actions;
    return {
      forward: axis(a.isDown('moveForward'), a.isDown('moveBackward')),
      right: axis(a.isDown('moveRight'), a.isDown('moveLeft')),
      sprint: a.isDown('sprint'),
      crouch: a.isDown('crouch'),
      // An edge: a tap between two steps still counts, holding the key does not repeat jumps.
      jump: a.wasPressed('jump'),
    };
  }
}

function axis(positive: boolean, negative: boolean): number {
  return (positive ? 1 : 0) - (negative ? 1 : 0);
}
