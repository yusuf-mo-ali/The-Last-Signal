/**
 * Turns game actions into a `WeaponInput` (D-017, D-039). It asks about actions, never keys:
 * 1 / 2 / 3 are `equipPrimary` / `equipSecondary` / `equipMelee`, the wheel is
 * `weaponNext` / `weaponPrevious`, V is `melee` (quick melee).
 */

import type { ActionSource } from '../player/PlayerController';
import type { WeaponInput } from './WeaponManager';

export class WeaponController {
  private readonly actions: ActionSource;

  constructor(actions: ActionSource) {
    this.actions = actions;
  }

  /** The weapon input for the current fixed step. */
  read(): WeaponInput {
    const a = this.actions;
    const next = a.wasPressed('weaponNext');
    const previous = a.wasPressed('weaponPrevious');
    return {
      firePressed: a.wasPressed('fire'),
      fireHeld: a.isDown('fire'),
      reload: a.wasPressed('reload'),
      equipPrimary: a.wasPressed('equipPrimary'),
      equipSecondary: a.wasPressed('equipSecondary'),
      equipMelee: a.wasPressed('equipMelee'),
      cycle: next === previous ? 0 : next ? 1 : -1,
      quickMelee: a.wasPressed('melee'),
    };
  }
}
