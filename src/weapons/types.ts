/**
 * Shared weapon types (plan §9, D-011, D-040). Results are plain data (tuples, ids, numbers) so
 * combat (Phase 3), the adaptive profile, analytics and tests can consume them without three.js
 * objects or references back into the weapon.
 */

import type { Vector3 } from 'three';
import type { LoadoutCategory, WeaponDefinition, WeaponId } from '../config/weapons';
import type { Rng } from '../utils/Rng';
import type { Hitscan, HitResult } from './hitscan';

export type Vec3Tuple = readonly [number, number, number];

/** What a weapon is doing (plan §9 `getState()`). */
export type WeaponStateId = 'ready' | 'cooldown' | 'reloading' | 'empty';

export interface AmmoState {
  readonly magazine: number;
  readonly magazineSize: number;
  /** `Infinity` for unlimited reserve (the starter Pistol, D-039). */
  readonly reserve: number;
}

export interface WeaponStatus {
  readonly id: WeaponId;
  readonly kind: WeaponDefinition['kind'];
  readonly state: WeaponStateId;
  /** `null` for melee weapons, which use no ammunition. */
  readonly ammo: AmmoState | null;
  /** 0 → 1 while reloading, otherwise 0. */
  readonly reloadProgress: number;
}

/** The shooter's body state that widens or tightens spread. */
export interface Stance {
  readonly crouched: boolean;
  readonly grounded: boolean;
  /** Horizontal speed as a fraction of walking speed (0 = still, 1 = walking, 1.5 = sprinting). */
  readonly speedRatio: number;
}

/** Everything an attack needs from the world, built only when an attack happens. */
export interface AttackContext {
  /** Eye position. */
  readonly origin: Vector3;
  /** Unit aim direction (from `PlayerLook`). */
  readonly direction: Vector3;
  readonly stance: Stance;
  /** Seeded, injected randomness: spread and recoil are reproducible (D-014). */
  readonly rng: Rng;
  readonly hitscan: Hitscan;
}

export interface PelletResult {
  /** Unit direction after spread. */
  readonly direction: Vec3Tuple;
  /** Nearest thing hit within range, or null. */
  readonly hit: HitResult | null;
  /** Where the ray stopped: the hit point, or the end of the range. */
  readonly end: Vec3Tuple;
  /** Damage this pellet would deal at that distance (before zone multipliers, applied by combat). */
  readonly damage: number;
}

export interface ShotResult {
  readonly weaponId: WeaponId;
  readonly origin: Vec3Tuple;
  readonly pellets: readonly PelletResult[];
  readonly headshotMultiplier: number;
  /** View kick for this shot, radians (+pitch up, +yaw left); applied through `PlayerLook`. */
  readonly recoil: { readonly pitch: number; readonly yaw: number };
  /** Rounds left in the magazine after this shot. */
  readonly magazine: number;
}

export interface MeleeResult {
  readonly weaponId: WeaponId;
  readonly origin: Vec3Tuple;
  readonly direction: Vec3Tuple;
  readonly hit: HitResult | null;
  readonly damage: number;
  readonly headshotMultiplier: number;
  /** True for a quick melee (V) made while holding another weapon. */
  readonly quick: boolean;
}

/**
 * The plan's weapon interface (§9: fire, reload, canFire, getAmmo, getState), shared by firearms
 * and melee weapons. `update` advances the weapon's own timers once per fixed step.
 */
export interface Weapon {
  readonly definition: WeaponDefinition;
  /** Advances timers by one fixed step. Returns true on the step a reload completes. */
  update(dt: number): boolean;
  canFire(): boolean;
  /** Attacks if `canFire()`; returns null otherwise. */
  fire(context: AttackContext): ShotResult | MeleeResult | null;
  /** Starts a reload if one is possible. Returns whether it started. */
  reload(): boolean;
  cancelReload(): boolean;
  getAmmo(): AmmoState | null;
  getState(): WeaponStatus;
}

/** Why a category could not be equipped. */
export type EquipRefusal = 'locked' | 'empty';

/** Notifications from `WeaponManager` (consumed by recoil, views, HUD, debug, later combat). */
export interface WeaponEvents {
  shot: ShotResult;
  melee: MeleeResult;
  dryFire: { readonly weaponId: WeaponId };
  reloadStarted: { readonly weaponId: WeaponId; readonly duration: number };
  reloaded: { readonly weaponId: WeaponId; readonly magazine: number; readonly reserve: number };
  reloadCancelled: { readonly weaponId: WeaponId };
  equipped: {
    readonly category: LoadoutCategory;
    readonly weaponId: WeaponId;
    readonly equipTime: number;
  };
  equipRefused: { readonly category: LoadoutCategory; readonly reason: EquipRefusal };
  acquired: {
    readonly weaponId: WeaponId;
    readonly category: LoadoutCategory;
    readonly replaced: WeaponId | null;
  };
  secondaryUnlocked: undefined;
}
