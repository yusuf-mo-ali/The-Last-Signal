import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import {
  STARTING_LOADOUT,
  WEAPON_RULES,
  WEAPONS,
  type FirearmDefinition,
  type WeaponDefinition,
  type WeaponId,
} from '../config/weapons';
import { CollisionWorld } from '../physics/CollisionWorld';
import { Rng } from '../utils/Rng';
import { boxTriangles } from '../world/levels/geometry';
import type { Firearm } from './Firearm';
import { Hitscan } from './hitscan';
import type { AttackContext, WeaponEvents } from './types';
import { NO_WEAPON_INPUT, WeaponManager, type WeaponInput } from './WeaponManager';

const DT = 1 / 60;
const PISTOL = WEAPONS.pistol;
const HANDS = WEAPONS.bareHands;
const HITSCAN = new Hitscan(
  new CollisionWorld([
    ...boxTriangles([-50, -1, -50], [50, 0, 50]),
    ...boxTriangles([-50, 0, -11], [50, 10, -10]),
  ]),
);

function makeContext(rng = new Rng(1)): () => AttackContext {
  const ctx: AttackContext = {
    origin: new Vector3(0, 1.6, 0),
    direction: new Vector3(0, 0, -1),
    stance: { crouched: false, grounded: true, speedRatio: 0 },
    rng,
    hitscan: HITSCAN,
  };
  return () => ctx;
}

type Recorded = {
  [K in keyof WeaponEvents]: { type: K; payload: WeaponEvents[K] };
}[keyof WeaponEvents];

/** A manager with every event recorded, and helpers to drive it step by step. */
function rig(options: ConstructorParameters<typeof WeaponManager>[0] = {}) {
  const manager = new WeaponManager(options);
  const events: Recorded[] = [];
  for (const type of [
    'shot',
    'melee',
    'dryFire',
    'reloadStarted',
    'reloaded',
    'reloadCancelled',
    'equipped',
    'equipRefused',
    'acquired',
    'secondaryUnlocked',
  ] as const) {
    manager.events.on(type, (payload: unknown) => {
      events.push({ type, payload } as Recorded);
    });
  }
  const context = makeContext();
  const step = (input: Partial<WeaponInput> = {}, count = 1) => {
    for (let i = 0; i < count; i++) {
      manager.step({ ...NO_WEAPON_INPUT, ...input }, context, DT);
    }
  };
  /** Advances `seconds` with no input. */
  const wait = (seconds: number) => {
    step({}, Math.round(seconds * 60));
  };
  const count = (type: keyof WeaponEvents) => events.filter((e) => e.type === type).length;
  const pistolAmmo = () => (manager.weaponIn('primary') as Firearm).magazine;
  return { manager, events, step, wait, count, context, pistolAmmo };
}

const press = { firePressed: true, fireHeld: true } as const;

/** The payload of the first recorded event of a type (fails the test if there is none). */
function first<K extends keyof WeaponEvents>(events: Recorded[], type: K): WeaponEvents[K] {
  const event = events.find((e) => e.type === type);
  if (!event) {
    throw new Error(`no "${type}" event`);
  }
  return event.payload as WeaponEvents[K];
}

describe('WeaponManager', () => {
  describe('starting loadout (D-039)', () => {
    it('is Bare Hands, the Pistol as Primary, and a locked Secondary, holding the Pistol', () => {
      const { manager } = rig();
      expect(manager.loadout).toEqual({
        melee: 'bareHands',
        primary: 'pistol',
        secondary: 'locked',
        active: 'primary',
      });
      expect(manager.isSecondaryLocked).toBe(true);
      expect(manager.activeWeapon.definition.id).toBe('pistol');
      expect(manager.weaponIn('melee')?.definition.id).toBe('bareHands');
      expect(manager.weaponIn('secondary')).toBeNull();
    });

    it('holds melee when a starting loadout has no Primary, and can start with Secondary open', () => {
      const { manager } = rig({
        starting: { melee: 'bareHands', primary: null, secondary: { weapon: 'pistol' } },
      });
      expect(manager.active).toBe('melee');
      expect(manager.loadout.secondary).toEqual({ weapon: 'pistol' });
    });

    it('reset() restores the starting loadout, state and ammunition', () => {
      const { manager, step } = rig();
      step(press);
      manager.unlockSecondary();
      manager.equip('melee');
      manager.reset();
      expect(manager.loadout).toEqual({
        melee: 'bareHands',
        primary: 'pistol',
        secondary: 'locked',
        active: 'primary',
      });
      expect((manager.activeWeapon as Firearm).magazine).toBe(PISTOL.magazineSize);
      expect(manager.isSwitching).toBe(false);
    });

    it('matches the approved STARTING_LOADOUT data', () => {
      expect(STARTING_LOADOUT).toEqual({
        melee: 'bareHands',
        primary: 'pistol',
        secondary: 'locked',
      });
    });
  });

  describe('equip (1 / 2 / 3)', () => {
    it('switches to melee and back, raising each weapon for its equipTime', () => {
      const { manager, events, step } = rig();
      expect(manager.equip('melee')).toBe('equipped');
      expect(manager.active).toBe('melee');
      expect(manager.isSwitching).toBe(true);
      expect(manager.switchRemainingTime).toBeCloseTo(HANDS.equipTime);
      step({}, Math.round(HANDS.equipTime * 60));
      expect(manager.isSwitching).toBe(false);
      expect(manager.equip('primary')).toBe('equipped');
      expect(manager.switchRemainingTime).toBeCloseTo(PISTOL.equipTime);
      expect(events.filter((e) => e.type === 'equipped').map((e) => e.payload)).toEqual([
        { category: 'melee', weaponId: 'bareHands', equipTime: HANDS.equipTime },
        { category: 'primary', weaponId: 'pistol', equipTime: PISTOL.equipTime },
      ]);
    });

    it('does nothing when the category is already held', () => {
      const { manager, count } = rig();
      expect(manager.equip('primary')).toBe('already');
      expect(manager.isSwitching).toBe(false);
      expect(count('equipped')).toBe(0);
    });

    it('refuses the locked Secondary, with an event, and keeps the weapon in hand', () => {
      const { manager, events, step } = rig();
      step({ equipSecondary: true });
      expect(manager.active).toBe('primary');
      expect(manager.isSwitching).toBe(false);
      expect(events).toEqual([
        { type: 'equipRefused', payload: { category: 'secondary', reason: 'locked' } },
      ]);
    });

    it('refuses an unlocked but empty Secondary as "empty"', () => {
      const { manager } = rig();
      manager.unlockSecondary();
      expect(manager.equip('secondary')).toBe('empty');
      expect(manager.active).toBe('primary');
    });

    it('maps the input actions to categories: 1 Primary, 2 Secondary, 3 Melee', () => {
      const { manager, step } = rig();
      step({ equipMelee: true });
      expect(manager.active).toBe('melee');
      step({ equipPrimary: true });
      expect(manager.active).toBe('primary');
      manager.unlockSecondary();
      manager.acquire('pistol', 'secondary');
      step({ equipSecondary: true });
      expect(manager.active).toBe('secondary');
    });

    it('cannot fire while the new weapon is being raised', () => {
      const { manager, step, count, pistolAmmo } = rig();
      manager.equip('melee');
      step({}, 20);
      step({ equipPrimary: true, ...press });
      expect(count('shot')).toBe(0);
      expect(pistolAmmo()).toBe(PISTOL.magazineSize);
    });

    it('cancels a reload in progress when switching away', () => {
      const { manager, step, wait, count, pistolAmmo } = rig();
      step(press);
      step({ reload: true });
      expect(count('reloadStarted')).toBe(1);
      step({ equipMelee: true });
      expect(count('reloadCancelled')).toBe(1);
      wait(3);
      expect(count('reloaded')).toBe(0);
      manager.equip('primary');
      expect(pistolAmmo()).toBe(PISTOL.magazineSize - 1);
    });
  });

  describe('cycle (mouse wheel: firearms only)', () => {
    it('stays on the Primary when it is the only firearm', () => {
      const { manager } = rig();
      expect(manager.cycle(1)).toBe('already');
      expect(manager.cycle(-1)).toBe('already');
      expect(manager.active).toBe('primary');
    });

    it('returns from melee to a firearm', () => {
      const { manager, step } = rig();
      manager.equip('melee');
      step({ cycle: 1 });
      expect(manager.active).toBe('primary');
    });

    it('steps between Primary and Secondary once both hold firearms, skipping melee', () => {
      const { manager } = rig();
      manager.unlockSecondary();
      manager.acquire('pistol', 'secondary');
      expect(manager.cycle(1)).toBe('equipped');
      expect(manager.active).toBe('secondary');
      expect(manager.cycle(1)).toBe('equipped');
      expect(manager.active).toBe('primary');
      expect(manager.cycle(-1)).toBe('equipped');
      expect(manager.active).toBe('secondary');
      manager.equip('melee');
      expect(manager.cycle(-1)).toBe('equipped');
      expect(manager.active).toBe('secondary'); // wheel up from melee: the last firearm
    });

    it('does nothing when there is no firearm at all', () => {
      const { manager } = rig({
        starting: { melee: 'bareHands', primary: null, secondary: 'locked' },
      });
      expect(manager.cycle(1)).toBe('none');
      expect(manager.active).toBe('melee');
    });
  });

  describe('Pistol trigger (semi-automatic)', () => {
    it('fires one shot per press, not while held', () => {
      const { step, count, pistolAmmo } = rig();
      step(press);
      step({ fireHeld: true }, 60);
      expect(count('shot')).toBe(1);
      expect(pistolAmmo()).toBe(PISTOL.magazineSize - 1);
    });

    it('fires at most fireRate shots per second however fast the clicks come', () => {
      const { step, count } = rig();
      for (let i = 0; i < 60; i++) {
        step(press); // a new press every step for one second
      }
      expect(count('shot')).toBe(PISTOL.fireRate);
    });

    it('buffers a press made just before the Pistol is ready', () => {
      const { step, count } = rig();
      step(press);
      const interval = Math.round(60 / PISTOL.fireRate);
      step({}, interval - 4); // press 4 steps (67 ms) early, within the 120 ms buffer
      step(press);
      expect(count('shot')).toBe(1);
      step({}, 3);
      expect(count('shot')).toBe(2);
    });

    it('forgets a press made too long before the Pistol is ready', () => {
      const { step, count } = rig({
        definitions: { ...WEAPONS, pistol: { ...PISTOL, fireRate: 2 } },
      });
      step(press);
      step({}, 5);
      step(press); // 0.4 s before it is ready: longer than the buffer
      step({}, 40);
      expect(count('shot')).toBe(1);
    });

    it('reports the shot with its hit, and kicks through recoil data', () => {
      const { events, step } = rig();
      step(press);
      const shot = first(events, 'shot');
      expect(shot.weaponId).toBe('pistol');
      expect(shot.pellets[0]?.hit?.kind).toBe('world');
      expect(shot.recoil.pitch).toBeGreaterThan(0);
    });
  });

  describe('automatic trigger (framework support for future weapons)', () => {
    const RIFLE: FirearmDefinition = {
      ...PISTOL,
      fireMode: 'auto',
      fireRate: 10,
      magazineSize: 30,
    };

    it('keeps firing while held, at the fire rate', () => {
      const { step, count } = rig({ definitions: { ...WEAPONS, pistol: RIFLE } });
      step(press);
      step({ fireHeld: true }, 59);
      expect(count('shot')).toBe(10);
    });
  });

  describe('magazine, dry fire and reload', () => {
    it('clicks empty, then reloads automatically, and fires again once reloaded', () => {
      const { step, wait, count, events, pistolAmmo } = rig();
      for (let i = 0; i < PISTOL.magazineSize; i++) {
        step(press);
        wait(0.2);
      }
      expect(pistolAmmo()).toBe(0);
      step(press);
      expect(count('dryFire')).toBe(1);
      expect(count('reloadStarted')).toBe(WEAPON_RULES.autoReloadOnEmpty ? 1 : 0);
      wait(PISTOL.reloadTime);
      expect(events.at(-1)).toEqual({
        type: 'reloaded',
        payload: { weaponId: 'pistol', magazine: PISTOL.magazineSize, reserve: Infinity },
      });
      step(press);
      expect(count('shot')).toBe(PISTOL.magazineSize + 1);
    });

    it('does not fire during a reload, and does not fire afterwards from a stale press', () => {
      const { step, wait, count, pistolAmmo } = rig();
      step(press);
      wait(0.2);
      step({ reload: true });
      wait(0.3);
      step(press); // pressed mid-reload: ignored
      wait(PISTOL.reloadTime);
      expect(count('shot')).toBe(1);
      expect(pistolAmmo()).toBe(PISTOL.magazineSize);
    });

    it('does not start a reload with a full magazine', () => {
      const { step, count } = rig();
      step({ reload: true });
      expect(count('reloadStarted')).toBe(0);
    });

    it('keeps the unlimited reserve for the starter Pistol through any number of reloads', () => {
      const { manager, step, wait } = rig();
      for (let round = 0; round < 5; round++) {
        for (let i = 0; i < PISTOL.magazineSize; i++) {
          step(press);
          wait(0.2);
        }
        step({ reload: true });
        wait(PISTOL.reloadTime);
      }
      expect(manager.activeWeapon.getAmmo()).toEqual({
        magazine: PISTOL.magazineSize,
        magazineSize: PISTOL.magazineSize,
        reserve: Infinity,
      });
    });

    it('refills ammunition and can make it infinite (debug)', () => {
      const { manager, step, pistolAmmo } = rig();
      step(press);
      manager.refillAmmo();
      expect(pistolAmmo()).toBe(PISTOL.magazineSize);
      manager.setInfiniteAmmo(true);
      step(press);
      expect(pistolAmmo()).toBe(PISTOL.magazineSize);
      manager.unlockSecondary();
      manager.acquire('pistol', 'secondary'); // new weapons inherit the setting
      expect((manager.weaponIn('secondary') as Firearm).infiniteAmmo).toBe(true);
    });

    it('addAmmo gives whole magazines to limited reserves only (ammo pickups)', () => {
      const { manager } = rig();
      expect(manager.addAmmo(1)).toBe(0); // the Pistol's reserve is unlimited: nothing needed
      const limited = rig({ definitions: { ...WEAPONS, pistol: { ...PISTOL, reserveAmmo: 24 } } });
      expect(limited.manager.addAmmo(1)).toBe(PISTOL.magazineSize);
      expect((limited.manager.weaponIn('primary') as Firearm).reserve).toBe(
        24 + PISTOL.magazineSize,
      );
      limited.manager.unlockSecondary();
      limited.manager.acquire('pistol', 'secondary');
      expect(limited.manager.addAmmo(2)).toBe(PISTOL.magazineSize * 4);
      for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
        expect(limited.manager.addAmmo(bad)).toBe(0);
      }
    });
  });

  describe('melee', () => {
    it('quick melee (V) swings Bare Hands without leaving the Pistol', () => {
      const { manager, events, step } = rig();
      step({ quickMelee: true });
      const swing = first(events, 'melee');
      expect(swing).toMatchObject({ weaponId: 'bareHands', quick: true, damage: HANDS.damage });
      expect(manager.active).toBe('primary');
      expect(manager.isQuickMeleeing).toBe(true);
    });

    it('blocks firing until the quick melee is over, then the Pistol fires normally', () => {
      const { step, wait, count } = rig();
      step({ quickMelee: true });
      step(press);
      expect(count('shot')).toBe(0);
      wait(HANDS.cooldown);
      step(press);
      expect(count('shot')).toBe(1);
    });

    it('cannot be spammed faster than the melee cooldown', () => {
      const { step, count } = rig();
      for (let i = 0; i < 60; i++) {
        step({ quickMelee: true });
      }
      expect(count('melee')).toBe(Math.round(1 / HANDS.cooldown));
    });

    it('cancels a reload in progress', () => {
      const { step, count } = rig();
      step(press);
      step({ reload: true });
      step({ quickMelee: true });
      expect(count('reloadCancelled')).toBe(1);
      expect(count('melee')).toBe(1);
    });

    it('is always available, even with no firearm at all', () => {
      const { manager, step, count } = rig({
        starting: { melee: 'bareHands', primary: null, secondary: 'locked' },
      });
      step({ quickMelee: true });
      expect(count('melee')).toBe(1);
      expect(manager.equip('primary')).toBe('empty');
      expect(manager.isAvailable('melee')).toBe(true);
    });

    it('with melee held (3), Fire swings it', () => {
      const { manager, step, wait, events } = rig();
      manager.equip('melee');
      wait(HANDS.equipTime);
      step(press);
      const swing = first(events, 'melee');
      expect(swing).toMatchObject({ weaponId: 'bareHands', quick: false });
    });

    it('blocks sprint for a moment after any attack (firing cancels sprint)', () => {
      const { manager, step, wait } = rig();
      expect(manager.blocksSprint).toBe(false);
      step(press);
      expect(manager.blocksSprint).toBe(true);
      wait(WEAPON_RULES.sprintLockoutAfterAttack);
      expect(manager.blocksSprint).toBe(false);
      step({ quickMelee: true });
      expect(manager.blocksSprint).toBe(true);
    });
  });

  describe('acquire and unlockSecondary (Supply Terminal, unlocks, debug)', () => {
    it('refuses to put a firearm in the locked Secondary', () => {
      const { manager, count } = rig();
      expect(manager.acquire('pistol', 'secondary')).toEqual({ ok: false, reason: 'locked' });
      expect(count('acquired')).toBe(0);
    });

    it('replaces the Primary with a fresh weapon (no refund), re-raising it if held', () => {
      const { manager, step, events } = rig();
      step(press);
      expect(manager.acquire('pistol')).toEqual({
        ok: true,
        category: 'primary',
        replaced: 'pistol',
      });
      expect((manager.activeWeapon as Firearm).magazine).toBe(PISTOL.magazineSize);
      expect(manager.isSwitching).toBe(true);
      expect(events.at(-1)).toEqual({
        type: 'acquired',
        payload: { weaponId: 'pistol', category: 'primary', replaced: 'pistol' },
      });
    });

    it('places a weapon into an empty category it fits before replacing anything', () => {
      const { manager } = rig();
      expect(manager.unlockSecondary()).toBe(true);
      expect(manager.unlockSecondary()).toBe(false);
      expect(manager.acquire('pistol')).toEqual({
        ok: true,
        category: 'secondary',
        replaced: null,
      });
      expect(manager.loadout.secondary).toEqual({ weapon: 'pistol' });
      expect(manager.active).toBe('primary'); // not in hand, so nothing to raise
      expect(manager.isSwitching).toBe(false);
    });

    it('refuses a category the weapon does not fit', () => {
      const { manager } = rig();
      expect(manager.acquire('bareHands', 'primary')).toEqual({ ok: false, reason: 'doesNotFit' });
      expect(manager.acquire('pistol', 'melee')).toEqual({ ok: false, reason: 'doesNotFit' });
    });

    it('replaces the melee weapon, which is never left empty', () => {
      const { manager } = rig();
      expect(manager.acquire('bareHands')).toEqual({
        ok: true,
        category: 'melee',
        replaced: 'bareHands',
      });
      expect(manager.weaponIn('melee')).not.toBeNull();
    });

    it('supports a future melee weapon (e.g. a Knife) as pure data', () => {
      const knife: WeaponDefinition = {
        ...HANDS,
        id: 'bareHands',
        name: 'Test Knife',
        damage: 45,
        reach: 1.9,
      };
      const { manager, events, step } = rig({ definitions: { ...WEAPONS, bareHands: knife } });
      step({ quickMelee: true });
      const swing = first(events, 'melee');
      expect(swing.damage).toBe(45);
      expect(manager.weaponIn('melee')?.definition.name).toBe('Test Knife');
    });

    it('rejects an unknown weapon id, and firearm/melee kind mismatches', () => {
      const { manager } = rig();
      expect(() => manager.acquire('laser' as WeaponId)).toThrow(/Unknown weapon/);
      expect(
        () =>
          new WeaponManager({
            starting: { melee: 'pistol', primary: null, secondary: 'locked' },
          }),
      ).toThrow(/not a melee weapon/);
      expect(
        () =>
          new WeaponManager({
            starting: { melee: 'bareHands', primary: 'bareHands', secondary: 'locked' },
          }),
      ).toThrow(/not a firearm/);
    });

    it('announces the Secondary unlock once', () => {
      const { manager, count } = rig();
      manager.unlockSecondary();
      manager.unlockSecondary();
      expect(count('secondaryUnlocked')).toBe(1);
      expect(manager.isSecondaryLocked).toBe(false);
    });
  });

  describe('determinism', () => {
    it('produces identical results for the same seed and inputs', () => {
      const run = (seed: string) => {
        const manager = new WeaponManager();
        const shots: unknown[] = [];
        manager.events.on('shot', (s) => shots.push(s));
        const context = makeContext(new Rng(seed));
        for (let i = 0; i < 300; i++) {
          manager.step(
            { ...NO_WEAPON_INPUT, firePressed: i % 7 === 0, fireHeld: true, reload: i === 150 },
            context,
            DT,
          );
        }
        return shots;
      };
      expect(run('a')).toEqual(run('a'));
      expect(run('a')).not.toEqual(run('b'));
      expect(run('a').length).toBeGreaterThan(10);
    });
  });
});
