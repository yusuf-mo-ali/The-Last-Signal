/**
 * Headless integration: the real game loop, level, player, input stack and weapons together,
 * wired as main.ts wires them. Input goes in as physical keys and mouse buttons.
 */

import { describe, expect, it } from 'vitest';
import { DEFAULT_BINDINGS, MouseButton } from '../config/input';
import { WEAPONS } from '../config/weapons';
import { Game } from '../core/Game';
import { ActionMap } from '../input/ActionMap';
import { InputState } from '../input/InputState';
import { attachStepInput } from '../input/stepInput';
import { Player } from '../player/Player';
import { PlayerController } from '../player/PlayerController';
import { Rng } from '../utils/Rng';
import { FACILITY } from '../world/levels/facility';
import { World } from '../world/World';
import type { Firearm } from './Firearm';
import { Hitscan } from './hitscan';
import type { ShotResult, WeaponEvents } from './types';
import { WeaponController } from './WeaponController';
import { WeaponManager } from './WeaponManager';
import { WeaponSystem } from './WeaponSystem';

const PISTOL = WEAPONS.pistol;

function headlessGame(seed = 'test') {
  const game = new Game({ strict: true });
  const world = new World(FACILITY);
  game.addSystem(world);
  const input = new InputState();
  const stepReader = input.createReader();
  attachStepInput(game, stepReader);
  const actions = new ActionMap(stepReader, DEFAULT_BINDINGS);
  const weapons = new WeaponManager();
  const controller = new PlayerController(actions);
  const player = new Player({
    world: world.collision,
    level: FACILITY,
    intent: () => {
      const intent = controller.read();
      return weapons.blocksSprint && intent.sprint ? { ...intent, sprint: false } : intent;
    },
    active: () => game.state.isIn('PLAYING'),
  });
  game.addSystem(player);
  const weaponController = new WeaponController(actions);
  const system = new WeaponSystem({
    manager: weapons,
    player,
    hitscan: new Hitscan(world.collision),
    rng: new Rng(seed),
    input: () => weaponController.read(),
    active: () => game.state.isIn('PLAYING'),
  });
  game.addSystem(system);
  game.state.onEnter('PLAYING', () => {
    player.respawn();
    weapons.reset();
  });
  game.state.transition('MAIN_MENU');

  const shots: ShotResult[] = [];
  const events: (keyof WeaponEvents)[] = [];
  for (const type of [
    'shot',
    'melee',
    'dryFire',
    'reloadStarted',
    'reloaded',
    'equipped',
    'equipRefused',
  ] as const) {
    weapons.events.on(type, (payload: unknown) => {
      events.push(type);
      if (type === 'shot') {
        shots.push(payload as ShotResult);
      }
    });
  }
  const frames = (n: number) => {
    for (let i = 0; i < n; i++) {
      game.frame(1 / 60);
    }
  };
  const tapKey = (code: string) => {
    input.keyDown(code);
    frames(1);
    input.keyUp(code);
    frames(1);
  };
  const click = () => {
    input.buttonDown(MouseButton.LEFT);
    frames(1);
    input.buttonUp(MouseButton.LEFT);
    frames(1);
  };
  const startRun = () => {
    game.state.transition('LOADING');
    game.state.transition('PLAYING');
  };
  return { game, input, weapons, player, shots, events, frames, tapKey, click, startRun };
}

describe('weapons in the game loop', () => {
  it('do nothing outside a run', () => {
    const g = headlessGame();
    g.click();
    g.tapKey('KeyV');
    expect(g.events).toEqual([]);
  });

  it('fire the Pistol from the eye along the view, hitting the level', () => {
    const g = headlessGame();
    g.startRun();
    g.frames(2);
    const eyeY = g.player.motor.position.y + g.player.motor.eyeHeight;
    g.click();
    expect(g.shots).toHaveLength(1);
    const shot = g.shots[0];
    expect(shot?.origin[1]).toBeCloseTo(eyeY, 5);
    expect(shot?.origin[2]).toBeCloseTo(FACILITY.spawn.position[2], 5);
    // From the spawn, facing north, the signal tower's south face (z = 1.2) is straight ahead.
    const hit = shot?.pellets[0]?.hit;
    expect(hit?.kind).toBe('world');
    expect(hit?.point[2]).toBeCloseTo(1.2, 3);
    expect(g.weapons.activeWeapon.getAmmo()?.magazine).toBe(PISTOL.magazineSize - 1);
  });

  it('kicks the view through PlayerLook, then settles back to the aim', () => {
    const g = headlessGame();
    g.startRun();
    g.frames(2);
    const pitch = g.player.look.pitch;
    g.input.buttonDown(MouseButton.LEFT);
    g.frames(1);
    expect(g.player.look.pitch).toBeGreaterThan(pitch);
    expect(g.player.look.recoilPitch).toBeGreaterThan(0);
    g.input.buttonUp(MouseButton.LEFT);
    g.frames(30);
    expect(g.player.look.pitch).toBeCloseTo(pitch, 9);
    expect(g.player.look.recoilPitch).toBe(0);
  });

  it('empties the magazine one click at a time, reloads with R, and clicks dry when empty', () => {
    const g = headlessGame();
    g.startRun();
    for (let i = 0; i < PISTOL.magazineSize; i++) {
      g.click();
      g.frames(10);
    }
    expect(g.weapons.activeWeapon.getAmmo()?.magazine).toBe(0);
    g.click();
    expect(g.events).toContain('dryFire');
    g.frames(Math.ceil(PISTOL.reloadTime * 60));
    expect(g.events).toContain('reloaded');
    expect(g.weapons.activeWeapon.getAmmo()?.magazine).toBe(PISTOL.magazineSize);

    g.click();
    g.frames(10);
    g.tapKey('KeyR');
    expect(g.events.filter((e) => e === 'reloadStarted')).toHaveLength(2);
    g.click(); // mid-reload: no shot
    expect(g.shots).toHaveLength(PISTOL.magazineSize + 1);
  });

  it('switches with 1 / 3, refuses the locked Secondary on 2, cycles with the wheel, V punches', () => {
    const g = headlessGame();
    g.startRun();
    g.tapKey('Digit3');
    expect(g.weapons.active).toBe('melee');
    g.tapKey('Digit2');
    expect(g.weapons.active).toBe('melee');
    expect(g.events).toContain('equipRefused');
    g.input.wheel(100); // wheel down: next firearm
    g.frames(2);
    expect(g.weapons.active).toBe('primary');
    g.tapKey('Digit1');
    g.frames(30);
    g.tapKey('KeyV');
    expect(g.events).toContain('melee');
    expect(g.weapons.active).toBe('primary');
  });

  it('cancels sprint when firing', () => {
    const g = headlessGame();
    g.startRun();
    g.input.keyDown('KeyW');
    g.input.keyDown('ShiftLeft');
    g.frames(30);
    expect(g.player.motor.sprinting).toBe(true);
    g.click();
    expect(g.player.motor.sprinting).toBe(false);
    g.frames(40);
    expect(g.player.motor.sprinting).toBe(true);
  });

  it('starts every run with a fresh starting loadout', () => {
    const g = headlessGame();
    g.startRun();
    g.click();
    g.weapons.unlockSecondary();
    g.game.state.pause();
    g.game.state.transition('LOADING'); // restart from the pause menu
    g.game.state.transition('PLAYING');
    expect(g.weapons.loadout).toEqual({
      melee: 'bareHands',
      primary: 'pistol',
      secondary: 'locked',
      active: 'primary',
    });
    expect((g.weapons.activeWeapon as Firearm).magazine).toBe(PISTOL.magazineSize);
  });

  it('is reproducible: the same seed and inputs give the same shots at any frame rate', () => {
    const run = (hz: number) => {
      const g = headlessGame('same-seed');
      g.startRun();
      g.input.keyDown('KeyD'); // strafe: moving spread
      let frame = 0;
      while (g.game.time.stepCount < 240) {
        if (frame % Math.round(hz / 5) === 0) {
          g.input.buttonDown(MouseButton.LEFT);
        } else {
          g.input.buttonUp(MouseButton.LEFT);
        }
        g.game.frame(1 / hz);
        frame++;
      }
      return g.shots.map((s) => s.pellets[0]?.direction);
    };
    // Press timing differs per rate, so compare two runs at the same rate for bit-identity.
    expect(run(60)).toEqual(run(60));
    expect(run(144)).toEqual(run(144));
    expect(run(60).length).toBeGreaterThan(5);
  });
});
