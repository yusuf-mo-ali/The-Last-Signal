/**
 * Owns the run's loadout (D-039) and runs every weapon rule on the fixed step (D-040):
 * switching, quick melee, reloads and the trigger. The only code that changes the loadout.
 *
 * The loadout has three **named** categories, never numbered slots:
 * - `melee`: always present (Bare Hands at the start) and always usable through quick melee;
 * - `primary`: one firearm or empty (the Pistol at the start);
 * - `secondary`: `locked` until `unlockSecondary()`, then one firearm or empty.
 *
 * Everything the manager does is also announced on `events` (shots, swings, reloads, switches,
 * refusals), which recoil, the view, the HUD, debug tools and later combat listen to.
 * Browser-independent and deterministic: randomness comes from the attack context's seeded `Rng`.
 */

import {
  STARTING_LOADOUT,
  WEAPON_RULES,
  WEAPONS,
  type FirearmCategory,
  type LoadoutCategory,
  type WeaponDefinition,
  type WeaponId,
} from '../config/weapons';
import { EventBus } from '../core/EventBus';
import { Firearm } from './Firearm';
import { MeleeWeapon } from './melee/MeleeWeapon';
import { countDown } from './timing';
import type { AttackContext, EquipRefusal, MeleeResult, Weapon, WeaponEvents } from './types';

/** What the player asked the weapons to do this step (from `WeaponController`). */
export interface WeaponInput {
  /** Fire was pressed during this step (an edge). */
  readonly firePressed: boolean;
  /** Fire is held down. */
  readonly fireHeld: boolean;
  readonly reload: boolean;
  readonly equipPrimary: boolean;
  readonly equipSecondary: boolean;
  readonly equipMelee: boolean;
  /** Mouse wheel: +1 next, −1 previous, 0 none. */
  readonly cycle: -1 | 0 | 1;
  readonly quickMelee: boolean;
}

export const NO_WEAPON_INPUT: WeaponInput = {
  firePressed: false,
  fireHeld: false,
  reload: false,
  equipPrimary: false,
  equipSecondary: false,
  equipMelee: false,
  cycle: 0,
  quickMelee: false,
};

type SecondarySlot =
  { readonly state: 'locked' } | { readonly state: 'unlocked'; readonly weapon: Firearm | null };

/** A read-only picture of the loadout, by weapon id (UI, debug, tests, saves later). */
export interface LoadoutSnapshot {
  readonly melee: WeaponId;
  readonly primary: WeaponId | null;
  readonly secondary: 'locked' | { readonly weapon: WeaponId | null };
  readonly active: LoadoutCategory;
}

export type EquipResult = 'equipped' | 'already' | EquipRefusal;

export type AcquireResult =
  | { readonly ok: true; readonly category: LoadoutCategory; readonly replaced: WeaponId | null }
  | { readonly ok: false; readonly reason: 'locked' | 'doesNotFit' };

export interface WeaponManagerOptions {
  readonly events?: EventBus<WeaponEvents>;
  readonly starting?: typeof STARTING_LOADOUT;
  readonly definitions?: Readonly<Record<WeaponId, WeaponDefinition>>;
}

/** Cycle order of the firearm categories (the mouse wheel cycles firearms, D-039). */
const FIREARM_ORDER: readonly FirearmCategory[] = ['primary', 'secondary'];

export class WeaponManager {
  readonly events: EventBus<WeaponEvents>;
  private readonly definitions: Readonly<Record<WeaponId, WeaponDefinition>>;
  private readonly starting: typeof STARTING_LOADOUT;

  private melee!: MeleeWeapon;
  private primary: Firearm | null = null;
  private secondary: SecondarySlot = { state: 'locked' };
  private activeCategory: LoadoutCategory = 'melee';

  private switchRemaining = 0;
  private quickMeleeRemaining = 0;
  private triggerBuffer = 0;
  private sprintLockout = 0;
  private infiniteAmmo = false;

  constructor(options: WeaponManagerOptions = {}) {
    this.events = options.events ?? new EventBus<WeaponEvents>();
    this.definitions = options.definitions ?? WEAPONS;
    this.starting = options.starting ?? STARTING_LOADOUT;
    this.reset();
  }

  /** Back to the starting loadout (a new run), holding the Primary if there is one. */
  reset(): void {
    const s = this.starting;
    this.melee = new MeleeWeapon(this.meleeDefinition(s.melee));
    this.primary = s.primary === null ? null : this.createFirearm(s.primary);
    this.secondary =
      s.secondary === 'locked'
        ? { state: 'locked' }
        : {
            state: 'unlocked',
            weapon: s.secondary.weapon === null ? null : this.createFirearm(s.secondary.weapon),
          };
    this.activeCategory = this.primary ? 'primary' : 'melee';
    this.switchRemaining = 0;
    this.quickMeleeRemaining = 0;
    this.triggerBuffer = 0;
    this.sprintLockout = 0;
  }

  // ---- queries --------------------------------------------------------------------------------

  get active(): LoadoutCategory {
    return this.activeCategory;
  }

  /** The weapon in the player's hands. Never null: an unavailable category is never active. */
  get activeWeapon(): Weapon {
    return this.weaponIn(this.activeCategory) ?? this.melee;
  }

  get loadout(): LoadoutSnapshot {
    return {
      melee: this.melee.definition.id,
      primary: this.primary?.definition.id ?? null,
      secondary:
        this.secondary.state === 'locked'
          ? 'locked'
          : { weapon: this.secondary.weapon?.definition.id ?? null },
      active: this.activeCategory,
    };
  }

  get isSecondaryLocked(): boolean {
    return this.secondary.state === 'locked';
  }

  /** True while the newly selected weapon is still being raised. */
  get isSwitching(): boolean {
    return this.switchRemaining > 0;
  }

  get switchRemainingTime(): number {
    return this.switchRemaining;
  }

  get isQuickMeleeing(): boolean {
    return this.quickMeleeRemaining > 0;
  }

  /** Firing cancels sprint (GAME_DESIGN §4.2): true for a moment after every attack. */
  get blocksSprint(): boolean {
    return this.sprintLockout > 0;
  }

  get infiniteAmmoEnabled(): boolean {
    return this.infiniteAmmo;
  }

  /** The weapon in a category, or null when it is empty or locked. */
  weaponIn(category: LoadoutCategory): Weapon | null {
    switch (category) {
      case 'melee':
        return this.melee;
      case 'primary':
        return this.primary;
      case 'secondary':
        return this.secondary.state === 'unlocked' ? this.secondary.weapon : null;
    }
  }

  /** Whether a category can be equipped right now (melee always can). */
  isAvailable(category: LoadoutCategory): boolean {
    return this.weaponIn(category) !== null;
  }

  // ---- loadout changes -------------------------------------------------------------------------

  /** Switches to a category. Refused (with an `equipRefused` event) when locked or empty. */
  equip(category: LoadoutCategory): EquipResult {
    const refusal = this.refusalFor(category);
    if (refusal) {
      this.events.emit('equipRefused', { category, reason: refusal });
      return refusal;
    }
    if (category === this.activeCategory) {
      return 'already';
    }
    this.cancelActiveReload();
    this.activeCategory = category;
    const weapon = this.activeWeapon;
    this.switchRemaining = weapon.definition.equipTime;
    this.triggerBuffer = 0;
    this.events.emit('equipped', {
      category,
      weaponId: weapon.definition.id,
      equipTime: weapon.definition.equipTime,
    });
    return 'equipped';
  }

  /**
   * The mouse wheel: steps through the available *firearm* categories (a locked or empty one is
   * skipped). From melee it returns to the first firearm in that direction.
   */
  cycle(direction: 1 | -1): EquipResult | 'none' {
    const available = FIREARM_ORDER.filter((c) => this.isAvailable(c));
    if (available.length === 0) {
      return 'none';
    }
    if (this.activeCategory === 'melee') {
      const target = direction > 0 ? available[0] : available[available.length - 1];
      return target ? this.equip(target) : 'none';
    }
    const index = available.indexOf(this.activeCategory);
    const next = available[(index + direction + available.length) % available.length];
    return next ? this.equip(next) : 'none';
  }

  /**
   * Puts a weapon into the loadout (Supply Terminal purchase, unlock, debug). The weapon goes into
   * `category`, or by default into the first category it fits that is usable and empty, else the
   * first usable one it fits. Whatever was there is replaced (no refund in v1, D-039).
   */
  acquire(id: WeaponId, category?: LoadoutCategory): AcquireResult {
    const def = this.definitionOf(id);
    const fits: readonly LoadoutCategory[] = def.fits;
    const usable = (c: LoadoutCategory) => c !== 'secondary' || this.secondary.state === 'unlocked';
    const target: LoadoutCategory | undefined =
      category ?? fits.find((c) => usable(c) && !this.isAvailable(c)) ?? fits.find(usable);
    if (target === undefined) {
      return { ok: false, reason: fits.includes('secondary') ? 'locked' : 'doesNotFit' };
    }
    if (!fits.includes(target)) {
      return { ok: false, reason: 'doesNotFit' };
    }
    if (!usable(target)) {
      return { ok: false, reason: 'locked' };
    }

    const replaced = this.weaponIn(target)?.definition.id ?? null;
    if (target === 'melee') {
      this.melee = new MeleeWeapon(this.meleeDefinition(id));
    } else {
      const weapon = this.createFirearm(id);
      if (target === 'primary') {
        this.primary = weapon;
      } else {
        this.secondary = { state: 'unlocked', weapon };
      }
    }
    this.events.emit('acquired', { weaponId: id, category: target, replaced });
    if (target === this.activeCategory) {
      // The weapon in the player's hands was swapped: raise the new one.
      this.switchRemaining = def.equipTime;
      this.triggerBuffer = 0;
    }
    return { ok: true, category: target, replaced };
  }

  /** Unlocks the Secondary category (empty). Returns false if it was already unlocked. */
  unlockSecondary(): boolean {
    if (this.secondary.state !== 'locked') {
      return false;
    }
    this.secondary = { state: 'unlocked', weapon: null };
    this.events.emit('secondaryUnlocked');
    return true;
  }

  /** Full magazines and reserves for every firearm (debug `giveAmmo`, Supply Terminal later). */
  refillAmmo(): void {
    for (const firearm of this.firearms()) {
      firearm.refill();
    }
  }

  /** Debug: shots stop consuming ammunition. */
  setInfiniteAmmo(enabled: boolean): void {
    this.infiniteAmmo = enabled;
    for (const firearm of this.firearms()) {
      firearm.infiniteAmmo = enabled;
    }
  }

  // ---- actions ---------------------------------------------------------------------------------

  /**
   * A melee attack with the melee weapon, whatever is held (V). The held weapon stays active; a
   * reload in progress is cancelled. Returns null while the melee weapon is recovering.
   */
  quickMelee(context: AttackContext): MeleeResult | null {
    if (this.quickMeleeRemaining > 0 || !this.melee.canFire()) {
      return null;
    }
    this.cancelActiveReload();
    const result = this.melee.fire(context);
    if (!result) {
      return null;
    }
    const quick = this.activeCategory !== 'melee';
    if (quick) {
      this.quickMeleeRemaining = this.melee.definition.cooldown;
    }
    this.sprintLockout = WEAPON_RULES.sprintLockoutAfterAttack;
    const swing = quick ? { ...result, quick: true } : result;
    this.events.emit('melee', swing);
    return swing;
  }

  /** Starts a reload of the held firearm. Returns whether it started. */
  reload(): boolean {
    const weapon = this.activeWeapon;
    if (this.isQuickMeleeing || !(weapon instanceof Firearm) || !weapon.reload()) {
      return false;
    }
    this.events.emit('reloadStarted', {
      weaponId: weapon.definition.id,
      duration: weapon.definition.reloadTime,
    });
    return true;
  }

  /**
   * One fixed step. `context` is called only when an attack actually happens, so a step without
   * one builds nothing.
   */
  step(input: WeaponInput, context: () => AttackContext, dt: number): void {
    this.advanceTimers(dt);

    if (input.equipPrimary) {
      this.equip('primary');
    } else if (input.equipSecondary) {
      this.equip('secondary');
    } else if (input.equipMelee) {
      this.equip('melee');
    } else if (input.cycle !== 0) {
      this.cycle(input.cycle);
    }

    if (input.quickMelee) {
      this.quickMelee(context());
    }
    if (input.reload) {
      this.reload();
    }

    this.triggerBuffer = input.firePressed
      ? WEAPON_RULES.triggerBufferTime
      : countDown(this.triggerBuffer, dt);
    if (this.isSwitching || this.isQuickMeleeing) {
      return;
    }
    const weapon = this.activeWeapon;
    if (weapon instanceof Firearm) {
      this.pullFirearmTrigger(weapon, input, context);
    } else if (this.triggerBuffer > 0 && weapon.canFire()) {
      this.triggerBuffer = 0;
      this.quickMelee(context()); // melee held: Fire swings it
    }
  }

  // ---- internals -------------------------------------------------------------------------------

  private pullFirearmTrigger(weapon: Firearm, input: WeaponInput, context: () => AttackContext) {
    const pressed = this.triggerBuffer > 0;
    const wants = weapon.definition.fireMode === 'auto' ? input.fireHeld || pressed : pressed;
    if (!wants || weapon.isReloading) {
      return;
    }
    if (weapon.magazine <= 0) {
      if (pressed) {
        this.triggerBuffer = 0;
        this.events.emit('dryFire', { weaponId: weapon.definition.id });
        if (WEAPON_RULES.autoReloadOnEmpty) {
          this.reload();
        }
      }
      return;
    }
    if (!weapon.canFire()) {
      return; // still cycling: a buffered press fires as soon as the weapon is ready
    }
    const shot = weapon.fire(context());
    if (shot) {
      this.triggerBuffer = 0;
      this.sprintLockout = WEAPON_RULES.sprintLockoutAfterAttack;
      this.events.emit('shot', shot);
    }
  }

  private advanceTimers(dt: number): void {
    this.switchRemaining = countDown(this.switchRemaining, dt);
    this.quickMeleeRemaining = countDown(this.quickMeleeRemaining, dt);
    this.sprintLockout = countDown(this.sprintLockout, dt);
    this.melee.update(dt);
    for (const firearm of this.firearms()) {
      if (firearm.update(dt)) {
        this.events.emit('reloaded', {
          weaponId: firearm.definition.id,
          magazine: firearm.magazine,
          reserve: firearm.reserve,
        });
      }
    }
  }

  private cancelActiveReload(): void {
    const weapon = this.activeWeapon;
    if (weapon.cancelReload()) {
      this.events.emit('reloadCancelled', { weaponId: weapon.definition.id });
    }
  }

  private refusalFor(category: LoadoutCategory): EquipRefusal | null {
    if (category === 'secondary' && this.secondary.state === 'locked') {
      return 'locked';
    }
    return this.isAvailable(category) ? null : 'empty';
  }

  private firearms(): Firearm[] {
    const list: Firearm[] = [];
    if (this.primary) {
      list.push(this.primary);
    }
    if (this.secondary.state === 'unlocked' && this.secondary.weapon) {
      list.push(this.secondary.weapon);
    }
    return list;
  }

  private definitionOf(id: WeaponId): WeaponDefinition {
    const def = this.definitions[id] as WeaponDefinition | undefined;
    if (!def) {
      throw new Error(`Unknown weapon "${id}"`);
    }
    return def;
  }

  private createFirearm(id: WeaponId): Firearm {
    const def = this.definitionOf(id);
    if (def.kind !== 'firearm') {
      throw new Error(`"${id}" is not a firearm`);
    }
    const firearm = new Firearm(def);
    firearm.infiniteAmmo = this.infiniteAmmo;
    return firearm;
  }

  private meleeDefinition(id: WeaponId) {
    const def = this.definitionOf(id);
    if (def.kind !== 'melee') {
      throw new Error(`"${id}" is not a melee weapon`);
    }
    return def;
  }
}
