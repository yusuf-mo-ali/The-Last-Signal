import { describe, expect, it } from 'vitest';
import { DEFAULT_BINDINGS, MouseButton, type InputAction } from '../config/input';
import { ActionMap } from '../input/ActionMap';
import { InputState } from '../input/InputState';
import type { ActionSource } from '../player/PlayerController';
import { WeaponController } from './WeaponController';
import { NO_WEAPON_INPUT } from './WeaponManager';

function source(pressed: InputAction[], down: InputAction[] = []): ActionSource {
  return { isDown: (a) => down.includes(a), wasPressed: (a) => pressed.includes(a) };
}

describe('WeaponController', () => {
  it('reads nothing when nothing is pressed', () => {
    expect(new WeaponController(source([])).read()).toEqual(NO_WEAPON_INPUT);
  });

  it('maps loadout actions to categories, and the wheel to a direction', () => {
    const input = new WeaponController(
      source(['equipPrimary', 'equipSecondary', 'equipMelee', 'weaponNext', 'melee', 'reload']),
    ).read();
    expect(input).toMatchObject({
      equipPrimary: true,
      equipSecondary: true,
      equipMelee: true,
      cycle: 1,
      quickMelee: true,
      reload: true,
    });
    expect(new WeaponController(source(['weaponPrevious'])).read().cycle).toBe(-1);
    expect(new WeaponController(source(['weaponNext', 'weaponPrevious'])).read().cycle).toBe(0);
  });

  it('reports the fire press edge and the held state separately', () => {
    expect(new WeaponController(source(['fire'], ['fire'])).read()).toMatchObject({
      firePressed: true,
      fireHeld: true,
    });
    expect(new WeaponController(source([], ['fire'])).read()).toMatchObject({
      firePressed: false,
      fireHeld: true,
    });
  });

  it('works through the default bindings: 1 / 2 / 3, left mouse, wheel, R, V', () => {
    const state = new InputState();
    const reader = state.createReader();
    const controller = new WeaponController(new ActionMap(reader, DEFAULT_BINDINGS));
    state.keyDown('Digit3');
    state.keyDown('KeyV');
    state.keyDown('KeyR');
    state.buttonDown(MouseButton.LEFT);
    state.wheel(-100); // wheel up
    reader.sample();
    expect(controller.read()).toEqual({
      firePressed: true,
      fireHeld: true,
      reload: true,
      equipPrimary: false,
      equipSecondary: false,
      equipMelee: true,
      cycle: -1,
      quickMelee: true,
    });
  });
});
