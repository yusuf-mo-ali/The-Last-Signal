/**
 * Connects the weapons to the player on the fixed step (D-040): builds the attack context (eye
 * position, aim from `PlayerLook`, stance from `PlayerMotor`), applies recoil through
 * `PlayerLook`, and lets the kick settle back. Runs after the player has moved, so shots leave
 * from where the player is this step. Browser-independent.
 */

import { Vector3 } from 'three';
import type { FixedUpdateSystem } from '../core/Game';
import type { Player } from '../player/Player';
import type { Rng } from '../utils/Rng';
import { Firearm } from './Firearm';
import { aimDirection, type Hitscan } from './hitscan';
import type { AttackContext, Stance } from './types';
import type { WeaponInput, WeaponManager } from './WeaponManager';

const DEG = Math.PI / 180;

export interface WeaponSystemOptions {
  readonly manager: WeaponManager;
  readonly player: Player;
  readonly hitscan: Hitscan;
  readonly rng: Rng;
  readonly input: () => WeaponInput;
  /** Whether weapons work this step (true while a run is being played). */
  readonly active: () => boolean;
}

export class WeaponSystem implements FixedUpdateSystem {
  readonly manager: WeaponManager;
  private readonly player: Player;
  private readonly hitscan: Hitscan;
  private readonly rng: Rng;
  private readonly input: () => WeaponInput;
  private readonly active: () => boolean;
  private readonly origin = new Vector3();
  private readonly direction = new Vector3();
  private readonly removeRecoilListener: () => void;
  /** Radians per second at which the last shot's kick settles (from that firearm's data). */
  private recoveryRate = 0;

  constructor(options: WeaponSystemOptions) {
    this.manager = options.manager;
    this.player = options.player;
    this.hitscan = options.hitscan;
    this.rng = options.rng;
    this.input = options.input;
    this.active = options.active;
    this.removeRecoilListener = this.manager.events.on('shot', (shot) => {
      this.player.look.addRecoil(shot.recoil.pitch, shot.recoil.yaw);
      const weapon = this.manager.activeWeapon;
      if (weapon instanceof Firearm) {
        this.recoveryRate = weapon.definition.recoil.recoveryDegPerSecond * DEG;
      }
    });
  }

  fixedUpdate(dt: number): void {
    if (!this.active()) {
      return;
    }
    this.manager.step(this.input(), this.context, dt);
    // Outstanding kick settles back at the rate of the firearm that caused it, even after a
    // switch to another weapon.
    this.player.look.recoverRecoil(this.recoveryRate * dt);
  }

  /** Built on demand by the manager, only on steps that attack. */
  readonly context = (): AttackContext => {
    const { motor, look } = this.player;
    this.origin.copy(motor.position);
    this.origin.y += motor.eyeHeight;
    aimDirection(look.yaw, look.pitch, this.direction);
    const stance: Stance = {
      crouched: motor.crouched,
      grounded: motor.grounded,
      speedRatio: motor.horizontalSpeed / motor.config.walkSpeed,
    };
    return {
      origin: this.origin,
      direction: this.direction,
      stance,
      rng: this.rng,
      hitscan: this.hitscan,
    };
  };

  dispose(): void {
    this.removeRecoilListener();
  }
}
