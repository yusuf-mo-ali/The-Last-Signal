/**
 * Weapon configuration schema (plan §9, GAME_DESIGN §5, D-011).
 * Skeleton: ids, roles and the schema. Numbers arrive with the weapon framework (Phase 2) and are
 * tuned in BALANCING.md; every weapon is data, never a subclass.
 */

export const WEAPON_IDS = ['pistol', 'assaultRifle', 'shotgun'] as const;
export type WeaponId = (typeof WEAPON_IDS)[number];

export type FireMode = 'semi' | 'auto' | 'pump';

/** Plan §9 base weapon properties, plus the shot pattern and falloff the design needs. */
export interface WeaponConfig {
  readonly damage: number;
  /** Shots per second. */
  readonly fireRate: number;
  readonly magazineSize: number;
  /** Reserve ammunition; `Infinity` for the pistol [Proposed, GAME_DESIGN §5]. */
  readonly reserveAmmo: number;
  /** Seconds. */
  readonly reloadTime: number;
  /** Metres. */
  readonly range: number;
  readonly recoil: number;
  /** Cone half-angle in degrees. */
  readonly spread: number;
  readonly headshotMultiplier: number;
  readonly fireMode: FireMode;
  /** Rays per shot (shotgun pellets). */
  readonly pellets: number;
  /** Damage falloff: full damage to `start` m, `minFactor` at `end` m. */
  readonly falloff: { readonly start: number; readonly end: number; readonly minFactor: number };
}

/** Design roles (GAME_DESIGN §5); descriptive, used by UI and tests. */
export const WEAPON_ROLES: Readonly<
  Record<WeaponId, { readonly name: string; readonly role: string; readonly fireMode: FireMode }>
> = {
  pistol: { name: 'Pistol', role: 'Reliable starter; precision', fireMode: 'semi' },
  assaultRifle: { name: 'Assault Rifle', role: 'Sustained damage at mid range', fireMode: 'auto' },
  shotgun: { name: 'Shotgun', role: 'Close-range burst', fireMode: 'pump' },
};
