/**
 * Every melee weapon (D-039, D-040): one class configured by a `MeleeDefinition`. Bare Hands is the
 * only definition in Phase 2; a Knife is data, not code.
 *
 * Placeholder behaviour: a swing is an instant ray of `reach` metres along the aim, which reports
 * what it touched (the level or a hitbox rig); the combat system turns a rig hit into damage
 * through the same path as a bullet, with no falloff (D-041). Swing animation timing and hit arcs
 * arrive with real melee weapons.
 */

import { Vector3 } from 'three';
import type { MeleeDefinition } from '../../config/weapons';
import { toTuple } from '../hitscan';
import { stepCooldown, TIMER_EPSILON as EPSILON } from '../timing';
import type { AttackContext, MeleeResult, Weapon, WeaponStatus } from '../types';

export class MeleeWeapon implements Weapon {
  readonly definition: MeleeDefinition;
  private cooldown = 0;
  private readonly direction = new Vector3();

  constructor(definition: MeleeDefinition) {
    this.definition = definition;
  }

  update(dt: number): boolean {
    this.cooldown = stepCooldown(this.cooldown, dt);
    return false;
  }

  canFire(): boolean {
    return this.cooldown <= EPSILON;
  }

  fire(context: AttackContext): MeleeResult | null {
    if (!this.canFire()) {
      return null;
    }
    this.cooldown += this.definition.cooldown;
    const direction = this.direction.copy(context.direction);
    return {
      weaponId: this.definition.id,
      origin: toTuple(context.origin),
      direction: toTuple(direction),
      hit: context.hitscan.cast(context.origin, direction, this.definition.reach),
      damage: this.definition.damage,
      headshotMultiplier: this.definition.headshotMultiplier,
      quick: false,
    };
  }

  /** Melee weapons never reload. */
  reload(): boolean {
    return false;
  }

  cancelReload(): boolean {
    return false;
  }

  /** Melee weapons use no ammunition. */
  getAmmo(): null {
    return null;
  }

  getState(): WeaponStatus {
    return {
      id: this.definition.id,
      kind: 'melee',
      state: this.cooldown > EPSILON ? 'cooldown' : 'ready',
      ammo: null,
      reloadProgress: 0,
    };
  }
}
