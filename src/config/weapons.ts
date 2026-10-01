/**
 * Weapon data (plan §9, GAME_DESIGN §5, D-011, D-039, D-040). Every weapon is a definition here,
 * never a subclass: the framework in `src/weapons/` reads these values and nothing else. Values are
 * Pass-1 starting points (plan §32); tuning changes are logged in BALANCING.md.
 *
 * Units: metres, seconds, degrees (angles are converted to radians where they are used).
 */

/** The three named loadout categories (D-039). Never "slot 1/2/3". */
export const LOADOUT_CATEGORIES = ['primary', 'secondary', 'melee'] as const;
export type LoadoutCategory = (typeof LOADOUT_CATEGORIES)[number];
export type FirearmCategory = Exclude<LoadoutCategory, 'melee'>;

/** Weapons implemented so far. New weapons are added here and in `WEAPONS`. */
export const WEAPON_IDS = ['bareHands', 'pistol'] as const;
export type WeaponId = (typeof WEAPON_IDS)[number];

/** Planned weapons (plan §9, GAME_DESIGN §5.2) that have a role but no definition yet. */
export const PLANNED_WEAPON_IDS = ['assaultRifle', 'shotgun', 'knife'] as const;
export type PlannedWeaponId = (typeof PLANNED_WEAPON_IDS)[number];

export type FireMode = 'semi' | 'auto' | 'pump';

/** Plan §9 base properties, plus the shot pattern, spread, recoil and falloff the design needs. */
export interface FirearmDefinition {
  readonly kind: 'firearm';
  readonly id: WeaponId;
  readonly name: string;
  /** Loadout categories this weapon may occupy; the first is its default. */
  readonly fits: readonly FirearmCategory[];
  /** Damage per shot (split across pellets), before falloff and zone multipliers. */
  readonly damage: number;
  /** Maximum shots per second. */
  readonly fireRate: number;
  readonly fireMode: FireMode;
  readonly magazineSize: number;
  /** Reserve ammunition at acquisition; `Infinity` for the starter Pistol (D-039). */
  readonly reserveAmmo: number;
  /** Seconds from starting a reload to a full magazine. */
  readonly reloadTime: number;
  /** Metres; nothing is hit beyond it. */
  readonly range: number;
  /** Multiplier on a HEAD-zone hit (combat applies it, Phase 3). */
  readonly headshotMultiplier: number;
  /** Rays per shot (shotgun pellets); 1 for a single bullet. */
  readonly pellets: number;
  /** Damage falloff: full damage up to `start` m, `minFactor` from `end` m on, linear between. */
  readonly falloff: { readonly start: number; readonly end: number; readonly minFactor: number };
  /** Cone half-angle of shot dispersion, in degrees, and what widens or tightens it. */
  readonly spread: {
    readonly baseDeg: number;
    readonly crouchMultiplier: number;
    /** Applied at full walking speed or faster (scaled linearly below it). */
    readonly movingMultiplier: number;
    readonly airborneMultiplier: number;
  };
  /** View kick per shot, applied through `PlayerLook` (D-040). */
  readonly recoil: {
    /** Upward kick per shot, degrees. */
    readonly pitchDeg: number;
    /** Random extra upward kick, ± degrees. */
    readonly pitchVarianceDeg: number;
    /** Random sideways kick, ± degrees. */
    readonly yawDeg: number;
    /** How fast the kick settles back, degrees per second (only the kick, never the player's aim). */
    readonly recoveryDegPerSecond: number;
  };
  /** Seconds to raise the weapon after switching to it. */
  readonly equipTime: number;
}

export interface MeleeDefinition {
  readonly kind: 'melee';
  readonly id: WeaponId;
  readonly name: string;
  readonly fits: readonly ['melee'];
  readonly damage: number;
  /** Metres from the eye. */
  readonly reach: number;
  /** Seconds from one swing to the next (and the length of a quick melee). */
  readonly cooldown: number;
  readonly headshotMultiplier: number;
  readonly equipTime: number;
}

export type WeaponDefinition = FirearmDefinition | MeleeDefinition;

export const WEAPONS: { readonly bareHands: MeleeDefinition; readonly pistol: FirearmDefinition } =
  {
    bareHands: {
      kind: 'melee',
      id: 'bareHands',
      name: 'Bare Hands',
      fits: ['melee'],
      damage: 15,
      reach: 1.6,
      cooldown: 0.5,
      headshotMultiplier: 1.5,
      equipTime: 0.2,
    },
    pistol: {
      kind: 'firearm',
      id: 'pistol',
      name: 'Pistol',
      // D-039: Primary at the start; also fits Secondary so it can become a sidearm later.
      fits: ['primary', 'secondary'],
      damage: 26,
      fireRate: 6,
      fireMode: 'semi',
      magazineSize: 12,
      reserveAmmo: Number.POSITIVE_INFINITY,
      reloadTime: 1.3,
      range: 120,
      headshotMultiplier: 2.5,
      pellets: 1,
      falloff: { start: 20, end: 60, minFactor: 0.6 },
      spread: { baseDeg: 0.6, crouchMultiplier: 0.6, movingMultiplier: 1.8, airborneMultiplier: 3 },
      recoil: { pitchDeg: 1.1, pitchVarianceDeg: 0.25, yawDeg: 0.35, recoveryDegPerSecond: 9 },
      equipTime: 0.35,
    },
  };

/** A run's starting loadout (D-039): Bare Hands, the Pistol as Primary, Secondary locked. */
export const STARTING_LOADOUT: {
  readonly melee: WeaponId;
  readonly primary: WeaponId | null;
  readonly secondary: 'locked' | { readonly weapon: WeaponId | null };
} = {
  melee: 'bareHands',
  primary: 'pistol',
  secondary: 'locked',
};

export interface WeaponRules {
  readonly triggerBufferTime: number;
  readonly autoReloadOnEmpty: boolean;
  readonly sprintLockoutAfterAttack: number;
  readonly secondaryUnlockAfterWave: number;
}

/** Rules shared by every weapon (D-040). */
export const WEAPON_RULES: WeaponRules = {
  /** A trigger press this long before the weapon is ready still fires when it becomes ready. */
  triggerBufferTime: 0.12,
  /** Pressing fire with an empty magazine starts a reload (after the dry-fire click). */
  autoReloadOnEmpty: true,
  /** Sprinting is suppressed this long after a shot or swing (firing cancels sprint, GAME_DESIGN §4.2). */
  sprintLockoutAfterAttack: 0.35,
  /** The wave after which the Secondary category unlocks (D-039; applied by the wave system later). */
  secondaryUnlockAfterWave: 5,
};

/** Design roles (GAME_DESIGN §5.2): implemented and planned weapons. Descriptive, used by UI and tests. */
export const WEAPON_ROLES: Readonly<
  Record<
    WeaponId | PlannedWeaponId,
    { readonly name: string; readonly role: string; readonly category: LoadoutCategory }
  >
> = {
  bareHands: { name: 'Bare Hands', role: 'Always-available fallback', category: 'melee' },
  pistol: { name: 'Pistol', role: 'Reliable starter; precision', category: 'primary' },
  assaultRifle: {
    name: 'Assault Rifle',
    role: 'Sustained damage at mid range',
    category: 'primary',
  },
  shotgun: { name: 'Shotgun', role: 'Close-range burst', category: 'primary' },
  knife: { name: 'Knife', role: 'Melee build', category: 'melee' },
};

export function weaponDefinition(id: WeaponId): WeaponDefinition {
  return WEAPONS[id];
}

/** Damage factor for a hit at `distance` metres (1 up close, `minFactor` far away). */
export function falloffFactor(falloff: FirearmDefinition['falloff'], distance: number): number {
  if (distance <= falloff.start) {
    return 1;
  }
  if (distance >= falloff.end) {
    return falloff.minFactor;
  }
  const t = (distance - falloff.start) / (falloff.end - falloff.start);
  return 1 + (falloff.minFactor - 1) * t;
}
