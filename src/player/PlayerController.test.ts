import { describe, expect, it } from 'vitest';
import { DEFAULT_BINDINGS, type InputAction } from '../config/input';
import { ActionMap } from '../input/ActionMap';
import { InputState } from '../input/InputState';
import { PlayerController, type ActionSource } from './PlayerController';

function source(down: InputAction[], pressed: InputAction[] = []): ActionSource {
  return {
    isDown: (a) => down.includes(a),
    wasPressed: (a) => pressed.includes(a),
  };
}

describe('PlayerController', () => {
  it('maps movement actions to axes, opposite keys cancelling', () => {
    expect(new PlayerController(source(['moveForward', 'moveRight'])).read()).toMatchObject({
      forward: 1,
      right: 1,
    });
    expect(new PlayerController(source(['moveBackward', 'moveLeft'])).read()).toMatchObject({
      forward: -1,
      right: -1,
    });
    expect(
      new PlayerController(source(['moveForward', 'moveBackward', 'moveLeft', 'moveRight'])).read(),
    ).toMatchObject({ forward: 0, right: 0 });
  });

  it('holds sprint and crouch, and treats jump as a press', () => {
    expect(new PlayerController(source(['sprint', 'crouch', 'jump'])).read()).toMatchObject({
      sprint: true,
      crouch: true,
      jump: false, // held, not pressed this step
    });
    expect(new PlayerController(source([], ['jump'])).read().jump).toBe(true);
  });

  it('works through the real input stack and default bindings (physical keys)', () => {
    const input = new InputState();
    const reader = input.createReader();
    const controller = new PlayerController(new ActionMap(reader, DEFAULT_BINDINGS));
    input.keyDown('KeyW');
    input.keyDown('KeyA');
    input.keyDown('ShiftLeft');
    input.keyDown('Space');
    reader.sample();
    expect(controller.read()).toEqual({
      forward: 1,
      right: -1,
      sprint: true,
      crouch: false,
      jump: true,
    });
    // Next step: Space still held, so no new jump.
    reader.sample();
    expect(controller.read().jump).toBe(false);
    input.keyDown('KeyC');
    input.keyUp('KeyW');
    reader.sample();
    expect(controller.read()).toMatchObject({ forward: 0, crouch: true });
  });
});
