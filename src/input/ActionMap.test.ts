import { describe, expect, it } from 'vitest';
import { DEFAULT_BINDINGS, MouseButton, type InputBindings } from '../config/input';
import { ActionMap } from './ActionMap';
import { InputState } from './InputState';

function setup(bindings: InputBindings = DEFAULT_BINDINGS) {
  const input = new InputState();
  const reader = input.createReader();
  const actions = new ActionMap(reader, bindings);
  return { input, reader, actions };
}

describe('ActionMap', () => {
  it('maps a held physical key to its action', () => {
    const { input, actions } = setup();
    input.keyDown('KeyW');
    expect(actions.isDown('moveForward')).toBe(true);
    expect(actions.isDown('moveBackward')).toBe(false);
  });

  it('works on non-QWERTY layouts: the physical W position is still "forward"', () => {
    // On AZERTY that key prints "z", but its KeyboardEvent.code is still "KeyW".
    const { input, actions } = setup();
    input.keyDown('KeyW');
    expect(actions.isDown('moveForward')).toBe(true);
  });

  it('reports press and release edges per reader window', () => {
    const { input, reader, actions } = setup();
    input.keyDown('KeyR');
    reader.sample();
    expect(actions.wasPressed('reload')).toBe(true);

    input.keyUp('KeyR');
    reader.sample();
    expect(actions.wasPressed('reload')).toBe(false);
    expect(actions.wasReleased('reload')).toBe(true);
  });

  it('treats any of several bindings as the action (left or right Shift sprints)', () => {
    const { input, reader, actions } = setup();
    input.keyDown('ShiftRight');
    reader.sample();
    expect(actions.isDown('sprint')).toBe(true);
    expect(actions.wasPressed('sprint')).toBe(true);
  });

  it('maps mouse buttons', () => {
    const { input, reader, actions } = setup();
    input.buttonDown(MouseButton.LEFT);
    input.buttonDown(MouseButton.RIGHT);
    reader.sample();
    expect(actions.isDown('fire')).toBe(true);
    expect(actions.wasPressed('fire')).toBe(true);
    expect(actions.isDown('aim')).toBe(true);

    input.buttonUp(MouseButton.LEFT);
    reader.sample();
    expect(actions.wasReleased('fire')).toBe(true);
    expect(actions.isDown('fire')).toBe(false);
  });

  it('maps wheel steps to presses, never to held or released', () => {
    const { input, reader, actions } = setup();
    input.wheel(100);
    reader.sample();
    expect(actions.wasPressed('weaponNext')).toBe(true);
    expect(actions.wasPressed('weaponPrevious')).toBe(false);
    expect(actions.isDown('weaponNext')).toBe(false);
    expect(actions.wasReleased('weaponNext')).toBe(false);

    input.wheel(-100);
    reader.sample();
    expect(actions.wasPressed('weaponPrevious')).toBe(true);
    expect(actions.wasPressed('weaponNext')).toBe(false);
  });

  it('follows new bindings after setBindings (rebinding needs no code change)', () => {
    const { input, reader, actions } = setup();
    actions.setBindings({ ...DEFAULT_BINDINGS, crouch: [{ key: 'ControlLeft' }] });
    input.keyDown('ControlLeft');
    input.keyDown('KeyC');
    reader.sample();
    expect(actions.isDown('crouch')).toBe(true);
    input.keyUp('ControlLeft');
    expect(actions.isDown('crouch')).toBe(false); // C no longer bound
  });
});
