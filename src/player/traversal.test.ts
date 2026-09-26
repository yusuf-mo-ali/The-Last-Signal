/**
 * Headless integration: the real game loop, world, player and input stack together.
 * - A scripted walk through every area of the blockout (plan §8 acceptance: "walk around the
 *   complete prototype map").
 * - Movement is identical at any display refresh rate, because it runs in fixed steps.
 */

import { describe, expect, it } from 'vitest';
import { DEFAULT_BINDINGS } from '../config/input';
import { Game } from '../core/Game';
import { ActionMap } from '../input/ActionMap';
import { InputState } from '../input/InputState';
import { attachStepInput } from '../input/stepInput';
import { FACILITY, FACILITY_ROUTE } from '../world/levels/facility';
import { World } from '../world/World';
import { Player } from './Player';
import { PlayerController } from './PlayerController';

/** The game as main.ts wires it, minus the browser: keys go straight into `InputState`. */
function headlessGame() {
  const game = new Game({ strict: true });
  const world = new World(FACILITY);
  game.addSystem(world);
  const input = new InputState();
  const stepReader = input.createReader();
  attachStepInput(game, stepReader);
  const controller = new PlayerController(new ActionMap(stepReader, DEFAULT_BINDINGS));
  const player = new Player({
    world: world.collision,
    level: FACILITY,
    intent: () => controller.read(),
    active: () => game.state.isIn('PLAYING'),
  });
  game.addSystem(player);
  game.state.onEnter('PLAYING', () => {
    player.respawn();
  });
  game.state.transition('MAIN_MENU');
  return { game, input, player };
}

function startRun(game: Game): void {
  game.state.transition('LOADING');
  game.state.transition('PLAYING');
}

describe('player in the game loop', () => {
  it('only moves while a run is being played', () => {
    const { game, input, player } = headlessGame();
    input.keyDown('KeyW');
    for (let i = 0; i < 60; i++) {
      game.frame(1 / 60);
    }
    expect(player.motor.position.toArray()).toEqual(FACILITY.spawn.position);

    startRun(game);
    for (let i = 0; i < 30; i++) {
      game.frame(1 / 60);
    }
    const moved = player.motor.position.clone();
    expect(moved.z).toBeLessThan(FACILITY.spawn.position[2] - 1);

    game.state.pause();
    for (let i = 0; i < 60; i++) {
      game.frame(1 / 60);
    }
    expect(player.motor.position.equals(moved)).toBe(true);
  });

  it('respawns at the start of a new run, facing the spawn direction', () => {
    const { game, input, player } = headlessGame();
    startRun(game);
    input.keyDown('KeyD');
    for (let i = 0; i < 60; i++) {
      game.frame(1 / 60);
    }
    player.look.setAngles(1.2, 0.3);
    game.state.pause();
    game.state.transition('LOADING'); // restart from the pause menu
    game.state.transition('PLAYING');
    expect(player.motor.position.toArray()).toEqual(FACILITY.spawn.position);
    expect(player.look.yaw).toBe(FACILITY.spawn.yaw);
    expect(player.look.pitch).toBe(0);
  });

  it.each([30, 60, 75, 144, 240])(
    'moves the same distance per simulated second at %i Hz rendering',
    (hz) => {
      const { game, input, player } = headlessGame();
      startRun(game);
      input.keyDown('KeyW');
      input.keyDown('ShiftLeft');
      // Jump once, then run: exercises acceleration, sprint, gravity and landing.
      input.keyDown('Space');
      let frames = 0;
      while (game.time.stepCount < 120) {
        game.frame(1 / hz);
        frames++;
        if (frames === 2) {
          input.keyUp('Space');
        }
      }
      // Same number of steps, same inputs: the same place, whatever the frame rate. 120 steps is
      // a whole number of frames at every rate tested, so no step is split across a boundary.
      expect(game.time.stepCount).toBe(120);
      const reference = headlessReference();
      expect(player.motor.position.distanceTo(reference)).toBeLessThan(1e-9);
    },
  );

  it('walks the complete blockout: every area, crouching through the duct and jumping onto the dock', () => {
    const { game, input, player } = headlessGame();
    startRun(game);
    const m = player.motor;
    const hold = (code: string, down: boolean): void => {
      if (down) {
        input.keyDown(code);
      } else {
        input.keyUp(code);
      }
    };
    const visited: string[] = [];
    for (const wp of FACILITY_ROUTE) {
      let frames = 0;
      let jumped = false;
      for (;;) {
        const dx = wp.x - m.position.x;
        const dz = wp.z - m.position.z;
        const distance = Math.hypot(dx, dz);
        if (distance < 0.3 && m.grounded) {
          break;
        }
        expect(frames++, `stuck on the way to ${wp.area}`).toBeLessThan(60 * 15);
        player.look.setAngles(Math.atan2(-dx, -dz), 0); // steer like a player aiming the mouse
        hold('KeyW', distance >= 0.3);
        hold('KeyC', wp.crouch ?? false);
        const jumpNow: boolean = (wp.jump ?? false) && !jumped && distance < 3.2 && m.grounded;
        hold('Space', jumpNow);
        jumped ||= jumpNow;
        game.frame(1 / 60);
      }
      expect(m.position.y, wp.area).toBeCloseTo(wp.y, 2);
      expect(m.respawns, wp.area).toBe(0);
      visited.push(wp.area);
    }
    hold('KeyW', false);
    expect(visited).toHaveLength(FACILITY_ROUTE.length);
    expect(m.groundDistance).toBeGreaterThan(200);
  });
});

/** Where the scripted 120-step sprint-jump ends when rendered at exactly the step rate. */
function headlessReference() {
  const { game, input, player } = headlessGame();
  startRun(game);
  input.keyDown('KeyW');
  input.keyDown('ShiftLeft');
  input.keyDown('Space');
  let frames = 0;
  while (game.time.stepCount < 120) {
    game.frame(1 / 60);
    frames++;
    if (frames === 2) {
      input.keyUp('Space');
    }
  }
  return player.motor.position.clone();
}
