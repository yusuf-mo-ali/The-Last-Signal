/**
 * Every gun (D-011, D-040): one class configured by a `FirearmDefinition`. The Pistol is the only
 * definition in Phase 2; the Assault Rifle (auto fire) and Shotgun (pellets) need data, not code.
 *
 * Timing runs on the fixed step. The shot cooldown keeps its fractional remainder (D-004), so a
 * weapon fires at its exact rate on average even when the interval is not a whole number of steps.
 * The remainder only exists on the step the weapon becomes ready; a weapon that was already
 * ready carries none, so an idle weapon never fires early or bursts.
 */

import { Vector3 } from 'three';
import { falloffFactor, type FirearmDefinition } from '../config/weapons';
import { spreadDirection, toTuple } from './hitscan';
import { stepCooldown, TIMER_EPSILON as EPSILON } from './timing';
import type {
  AmmoState,
  AttackContext,
  PelletResult,
  ShotResult,
  Stance,
  Weapon,
  WeaponStateId,
  WeaponStatus,
} from './types';

const DEG = Math.PI / 180;

export class Firearm implements Weapon {
  readonly definition: FirearmDefinition;
  magazine: number;
  reserve: number;
  /** Debug: shots do not consume ammunition. */
  infiniteAmmo = false;
  private cooldown = 0;
  private reloadRemaining = 0;
  private reloading = false;
  private readonly direction = new Vector3();
  private readonly end = new Vector3();

  constructor(definition: FirearmDefinition) {
    if (!(definition.fireRate > 0) || definition.fireRate > 60) {
      throw new RangeError(`${definition.id}: fireRate must be in (0, 60] shots per second`);
    }
    if (!(definition.magazineSize >= 1) || !(definition.pellets >= 1)) {
      throw new RangeError(`${definition.id}: magazineSize and pellets must be at least 1`);
    }
    this.definition = definition;
    this.magazine = definition.magazineSize;
    this.reserve = definition.reserveAmmo;
  }

  /** Seconds between shots at the maximum fire rate. */
  get interval(): number {
    return 1 / this.definition.fireRate;
  }

  get isReloading(): boolean {
    return this.reloading;
  }

  update(dt: number): boolean {
    this.cooldown = stepCooldown(this.cooldown, dt);
    if (!this.reloading) {
      return false;
    }
    this.reloadRemaining -= dt;
    if (this.reloadRemaining > EPSILON) {
      return false;
    }
    const taken = Math.min(this.definition.magazineSize - this.magazine, this.reserve);
    this.magazine += taken;
    this.reserve -= taken;
    this.reloading = false;
    this.reloadRemaining = 0;
    return true;
  }

  canFire(): boolean {
    return !this.reloading && this.magazine > 0 && this.cooldown <= EPSILON;
  }

  /** Spread cone half-angle, in radians, for a stance. */
  spreadRadians(stance: Stance): number {
    const s = this.definition.spread;
    const moving = 1 + (s.movingMultiplier - 1) * Math.min(1, Math.max(0, stance.speedRatio));
    return (
      s.baseDeg *
      DEG *
      (stance.crouched ? s.crouchMultiplier : 1) *
      (stance.grounded ? 1 : s.airborneMultiplier) *
      moving
    );
  }

  fire(context: AttackContext): ShotResult | null {
    if (!this.canFire()) {
      return null;
    }
    const def = this.definition;
    if (!this.infiniteAmmo) {
      this.magazine--;
    }
    this.cooldown += this.interval;

    const cone = this.spreadRadians(context.stance);
    const pellets: PelletResult[] = [];
    for (let i = 0; i < def.pellets; i++) {
      const direction = spreadDirection(context.direction, cone, context.rng, this.direction);
      const hit = context.hitscan.cast(context.origin, direction, def.range);
      const distance = hit ? hit.distance : def.range;
      this.end.copy(context.origin).addScaledVector(direction, distance);
      pellets.push({
        direction: toTuple(direction),
        hit,
        end: toTuple(this.end),
        damage: (def.damage / def.pellets) * falloffFactor(def.falloff, distance),
      });
    }

    const r = def.recoil;
    const pitch = (r.pitchDeg + (context.rng.next() * 2 - 1) * r.pitchVarianceDeg) * DEG;
    const yaw = (context.rng.next() * 2 - 1) * r.yawDeg * DEG;
    return {
      weaponId: def.id,
      origin: toTuple(context.origin),
      pellets,
      headshotMultiplier: def.headshotMultiplier,
      recoil: { pitch, yaw },
      magazine: this.magazine,
    };
  }

  reload(): boolean {
    if (this.reloading || this.magazine >= this.definition.magazineSize || this.reserve <= 0) {
      return false;
    }
    this.reloading = true;
    this.reloadRemaining = this.definition.reloadTime;
    return true;
  }

  cancelReload(): boolean {
    if (!this.reloading) {
      return false;
    }
    this.reloading = false;
    this.reloadRemaining = 0;
    return true;
  }

  /** Fills the magazine and restores the reserve to its starting amount (debug, Supply Terminal). */
  refill(): void {
    this.cancelReload();
    this.magazine = this.definition.magazineSize;
    this.reserve = Math.max(this.reserve, this.definition.reserveAmmo);
  }

  /** Adds reserve rounds (Supply Terminal ammunition, pickups). */
  addReserve(rounds: number): void {
    if (rounds > 0) {
      this.reserve += rounds;
    }
  }

  getAmmo(): AmmoState {
    return {
      magazine: this.magazine,
      magazineSize: this.definition.magazineSize,
      reserve: this.reserve,
    };
  }

  getState(): WeaponStatus {
    let state: WeaponStateId = 'ready';
    if (this.reloading) {
      state = 'reloading';
    } else if (this.magazine <= 0) {
      state = 'empty';
    } else if (this.cooldown > EPSILON) {
      state = 'cooldown';
    }
    return {
      id: this.definition.id,
      kind: 'firearm',
      state,
      ammo: this.getAmmo(),
      reloadProgress: this.reloading ? 1 - this.reloadRemaining / this.definition.reloadTime : 0,
    };
  }
}
