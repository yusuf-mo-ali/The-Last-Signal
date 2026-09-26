import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { WEAPONS } from '../../config/weapons';
import { CollisionWorld } from '../../physics/CollisionWorld';
import { Rng } from '../../utils/Rng';
import { boxTriangles } from '../../world/levels/geometry';
import { Hitscan } from '../hitscan';
import type { AttackContext } from '../types';
import { MeleeWeapon } from './MeleeWeapon';

const HANDS = WEAPONS.bareHands;
/** A wall whose near face is at z = −1 (within reach). */
const HITSCAN = new Hitscan(new CollisionWorld(boxTriangles([-5, 0, -2], [5, 3, -1])));

function context(direction = new Vector3(0, 0, -1)): AttackContext {
  return {
    origin: new Vector3(0, 1.6, 0),
    direction,
    stance: { crouched: false, grounded: true, speedRatio: 0 },
    rng: new Rng(1),
    hitscan: HITSCAN,
  };
}

describe('MeleeWeapon (Bare Hands)', () => {
  it('uses no ammunition and never reloads', () => {
    const hands = new MeleeWeapon(HANDS);
    expect(hands.getAmmo()).toBeNull();
    expect(hands.reload()).toBe(false);
    expect(hands.cancelReload()).toBe(false);
    expect(hands.getState()).toEqual({
      id: 'bareHands',
      kind: 'melee',
      state: 'ready',
      ammo: null,
      reloadProgress: 0,
    });
  });

  it('reports what it touched within reach, with its damage', () => {
    const swing = new MeleeWeapon(HANDS).fire(context());
    expect(swing).toMatchObject({ weaponId: 'bareHands', damage: HANDS.damage, quick: false });
    expect(swing?.hit?.kind).toBe('world');
    expect(swing?.hit?.distance).toBeCloseTo(1);
  });

  it('reaches only `reach` metres', () => {
    const swing = new MeleeWeapon(HANDS).fire(context(new Vector3(0, 0, 1)));
    expect(swing).not.toBeNull();
    expect(swing?.hit).toBeNull();
  });

  it('recovers for `cooldown` seconds between swings', () => {
    const hands = new MeleeWeapon(HANDS);
    hands.fire(context());
    expect(hands.canFire()).toBe(false);
    expect(hands.getState().state).toBe('cooldown');
    expect(hands.fire(context())).toBeNull();
    const steps = Math.round(HANDS.cooldown * 60);
    for (let i = 0; i < steps; i++) {
      hands.update(1 / 60);
    }
    expect(hands.canFire()).toBe(true);
  });
});
