import { describe, expect, it } from 'vitest';
import {
  boundKeyCodes,
  CTRL_CROUCH_BINDING,
  DEFAULT_BINDINGS,
  describeBinding,
  findBindingConflicts,
  INPUT_ACTIONS,
  MouseButton,
  type InputBindings,
} from './input';

/** KeyboardEvent.code values are physical-position names, never produced characters. */
const PHYSICAL_CODE = /^(Key[A-Z]|Digit[0-9]|Shift(Left|Right)|Control(Left|Right)|Space|Escape)$/;

describe('default input bindings (GAME_DESIGN §4.1)', () => {
  it('binds every action at least once', () => {
    for (const action of INPUT_ACTIONS) {
      expect(DEFAULT_BINDINGS[action].length, action).toBeGreaterThan(0);
    }
  });

  it('uses physical key codes, not layout-dependent characters', () => {
    for (const code of boundKeyCodes(DEFAULT_BINDINGS)) {
      expect(code).toMatch(PHYSICAL_CODE);
    }
  });

  it('has no input bound to two actions', () => {
    expect(findBindingConflicts(DEFAULT_BINDINGS)).toEqual([]);
  });

  it('matches the documented control scheme', () => {
    const ids = (action: (typeof INPUT_ACTIONS)[number]) =>
      DEFAULT_BINDINGS[action].map(describeBinding);
    expect(ids('moveForward')).toEqual(['key:KeyW']);
    expect(ids('moveLeft')).toEqual(['key:KeyA']);
    expect(ids('moveBackward')).toEqual(['key:KeyS']);
    expect(ids('moveRight')).toEqual(['key:KeyD']);
    expect(ids('fire')).toEqual([`mouse:${MouseButton.LEFT}`]);
    expect(ids('aim')).toEqual([`mouse:${MouseButton.RIGHT}`]);
    expect(ids('reload')).toEqual(['key:KeyR']);
    expect(ids('sprint')).toEqual(['key:ShiftLeft', 'key:ShiftRight']);
    expect(ids('jump')).toEqual(['key:Space']);
    expect(ids('weapon1')).toEqual(['key:Digit1']);
    expect(ids('weapon2')).toEqual(['key:Digit2']);
    expect(ids('weapon3')).toEqual(['key:Digit3']);
    expect(ids('weaponNext')).toEqual(['wheel:down']);
    expect(ids('weaponPrevious')).toEqual(['wheel:up']);
    expect(ids('interact')).toEqual(['key:KeyE']);
    expect(ids('melee')).toEqual(['key:KeyV']);
    expect(ids('pause')).toEqual(['key:Escape']);
  });

  it('crouches on C, never Ctrl by default (Ctrl+W closes the tab, D-017)', () => {
    expect(DEFAULT_BINDINGS.crouch.map(describeBinding)).toEqual(['key:KeyC']);
    expect(boundKeyCodes(DEFAULT_BINDINGS).has('ControlLeft')).toBe(false);
    expect(describeBinding(CTRL_CROUCH_BINDING)).toBe('key:ControlLeft');
  });
});

describe('binding helpers', () => {
  it('finds conflicts introduced by rebinding', () => {
    const rebound: InputBindings = {
      ...DEFAULT_BINDINGS,
      crouch: [CTRL_CROUCH_BINDING, { key: 'KeyR' }],
    };
    expect(findBindingConflicts(rebound)).toEqual([
      { binding: 'key:KeyR', actions: ['crouch', 'reload'] },
    ]);
  });

  it('collects only keyboard codes', () => {
    const codes = boundKeyCodes(DEFAULT_BINDINGS);
    expect(codes.has('KeyW')).toBe(true);
    expect(codes.has('Space')).toBe(true);
    expect([...codes].some((c) => c.startsWith('mouse') || c.startsWith('wheel'))).toBe(false);
  });
});
