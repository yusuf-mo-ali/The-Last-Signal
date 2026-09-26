/**
 * Headless integration of the whole combat pipeline, wired as main.ts wires it: the real game
 * loop, level, player, input stack and weapons, plus combat, the training range and pickups.
 * Input goes in as physical keys and mouse buttons:
 *
 *   click → WeaponManager → Hitscan (level + rigs) → CombatSystem → Health → events → drops
 */

import { describe, expect, it } from 'vitest';
import { DEFAULT_BINDINGS, MouseButton } from '../config/input';
import { TRAINING_DUMMIES, TRAINING_RANGE } from '../config/training';
import { WEAPONS, type WeaponDefinition, type WeaponId } from '../config/weapons';
import { Game } from '../core/Game';
import { ActionMap } from '../input/ActionMap';
import { InputState } from '../input/InputState';
import { attachStepInput } from '../input/stepInput';
import { Player } from '../player/Player';
import { PlayerController } from '../player/PlayerController';
import { Rng } from '../utils/Rng';
import type { Firearm } from '../weapons/Firearm';
import { Hitscan } from '../weapons/hitscan';
import type { ShotResult } from '../weapons/types';
import { WeaponController } from '../weapons/WeaponController';
import { WeaponManager } from '../weapons/WeaponManager';
import { WeaponSystem } from '../weapons/WeaponSystem';
import { FACILITY } from '../world/levels/facility';
import { PickupManager } from '../world/PickupManager';
import { World } from '../world/World';
import { CombatSystem, type CombatEvents } from './CombatSystem';
import { TrainingRange } from './training/TrainingRange';

type Recorded = {
  [K in keyof CombatEvents]: { type: K; payload: CombatEvents[K] };
}[keyof CombatEvents];

interface Options {
  readonly seed?: string;
  readonly dropRng?: Rng;
  readonly definitions?: Readonly<Record<WeaponId, WeaponDefinition>>;
}

function headlessGame(options: Options = {}) {
  const game = new Game({ strict: true });
  const world = new World(FACILITY);
  game.addSystem(world);
  const input = new InputState();
  const stepReader = input.createReader();
  attachStepInput(game, stepReader);
  const actions = new ActionMap(stepReader, DEFAULT_BINDINGS);
  const weapons = new WeaponManager(
    options.definitions ? { definitions: options.definitions } : {},
  );
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
  const hitscan = new Hitscan(world.collision);
  game.addSystem(
    new WeaponSystem({
      manager: weapons,
      player,
      hitscan,
      rng: new Rng(options.seed ?? 'test'),
      input: () => weaponController.read(),
      active: () => game.state.isIn('PLAYING'),
    }),
  );
  const combat = new CombatSystem({ hitscan, weaponEvents: weapons.events });
  game.addSystem(combat);
  const pickups = new PickupManager({
    collector: () => (game.state.isIn('PLAYING') ? player.motor.position : null),
    collect: (pickup) => weapons.addAmmo(pickup.definition.magazines) > 0,
  });
  const training = new TrainingRange({
    combat,
    rng: options.dropRng ?? new Rng('drops'),
    pickups,
  });
  training.reset();
  game.addSystem(training);
  game.addSystem(pickups);
  game.state.onEnter('PLAYING', () => {
    player.respawn();
    weapons.reset();
    training.reset();
    pickups.clear();
  });
  game.state.transition('MAIN_MENU');

  const events: Recorded[] = [];
  for (const type of ['damaged', 'staggered', 'killed', 'revived'] as const) {
    combat.events.on(type, (payload: unknown) => {
      events.push({ type, payload } as Recorded);
    });
  }
  const shots: ShotResult[] = [];
  weapons.events.on('shot', (s) => shots.push(s));

  const frames = (n: number) => {
    for (let i = 0; i < n; i++) {
      game.frame(1 / 60);
    }
  };
  const seconds = (s: number) => {
    frames(Math.round(s * 60));
  };
  const click = () => {
    input.buttonDown(MouseButton.LEFT);
    frames(1);
    input.buttonUp(MouseButton.LEFT);
    frames(11); // past the Pistol's fire interval
  };
  const tapKey = (code: string) => {
    input.keyDown(code);
    frames(1);
    input.keyUp(code);
    frames(1);
  };
  /** Turns the view to a point, as `tls.aimAt` does. */
  const aimAt = (x: number, y: number, z: number) => {
    const p = player.motor.position;
    const dx = x - p.x;
    const dy = y - (p.y + player.motor.eyeHeight);
    const dz = z - p.z;
    player.look.setAngles(Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz)));
  };
  const startRun = () => {
    game.state.transition('LOADING');
    game.state.transition('PLAYING');
    seconds(0.5); // the Pistol is raised at the start of a run
  };
  const damaged = () => events.flatMap((e) => (e.type === 'damaged' ? [e.payload] : []));
  const count = (type: keyof CombatEvents) => events.filter((e) => e.type === type).length;
  return {
    game,
    input,
    weapons,
    player,
    combat,
    training,
    pickups,
    events,
    shots,
    frames,
    seconds,
    click,
    tapKey,
    aimAt,
    startRun,
    damaged,
    count,
  };
}

const SPAWN_Z = FACILITY.spawn.position[2];

describe('combat in the game loop (training range)', () => {
  it('nothing is damaged outside a run', () => {
    const g = headlessGame();
    g.click();
    expect(g.events).toEqual([]);
  });

  it('from the spawn, a click is a headshot on the dummy straight ahead; two kill it', () => {
    const g = headlessGame();
    g.startRun();
    g.click();
    expect(g.damaged()).toEqual([
      expect.objectContaining({
        targetId: 'dummy-1',
        zone: 'HEAD',
        critical: true,
        amount: 65,
        weaponId: 'pistol',
      }),
    ]);
    g.click();
    expect(g.count('killed')).toBe(1);
    expect(g.training.get('dummy-1')?.health.isDead).toBe(true);
  });

  it('shots after the kill pass through the fallen dummy and hit the tower behind it', () => {
    const g = headlessGame();
    g.startRun();
    g.click();
    g.click();
    const before = g.events.length;
    g.click();
    expect(g.events.length).toBe(before);
    const last = g.shots.at(-1)?.pellets[0]?.hit;
    expect(last?.kind).toBe('world');
    expect(last?.point[2]).toBeCloseTo(1.2, 3); // the signal tower's south face
  });

  it('body, arm and leg shots from the spawn use their multipliers', () => {
    const g = headlessGame();
    g.startRun();
    const [x, , z] = TRAINING_RANGE.dummies[1]?.position ?? [0, 0, 0]; // the zoned dummy
    g.aimAt(x, 1.15, z);
    g.click();
    g.aimAt(x + 0.31, 1.1, z); // facing us: its left arm is on our right
    g.click();
    g.aimAt(x - 0.11, 0.45, z); // its right leg
    g.click();
    expect(g.damaged().map((d) => [d.targetId, d.zone, Number(d.amount.toFixed(6))])).toEqual([
      ['dummy-2', 'TORSO', 26],
      ['dummy-2', 'ARM_LEFT', 16.9],
      ['dummy-2', 'LEG_RIGHT', 13],
    ]);
  });

  it('a dead dummy stands up again after its respawn delay', () => {
    const g = headlessGame();
    g.startRun();
    g.click();
    g.click();
    g.seconds(TRAINING_DUMMIES.standard.respawnDelay + 0.1);
    expect(g.count('revived')).toBe(1);
    g.click();
    expect(g.damaged().at(-1)).toMatchObject({ targetId: 'dummy-1', zone: 'HEAD', health: 35 });
  });

  it('reloading works as before while fighting', () => {
    const g = headlessGame();
    g.startRun();
    g.click();
    g.tapKey('KeyR');
    expect(g.weapons.activeWeapon.getState().state).toBe('reloading');
    g.click(); // mid-reload: no shot, no damage
    expect(g.damaged()).toHaveLength(1);
    g.seconds(WEAPONS.pistol.reloadTime);
    expect(g.weapons.activeWeapon.getAmmo()?.magazine).toBe(WEAPONS.pistol.magazineSize);
    g.click();
    expect(g.count('killed')).toBe(1);
  });

  it('V (quick melee) hits a dummy within reach through the same pipeline', () => {
    const g = headlessGame();
    g.startRun();
    g.player.motor.position.set(0, 0, 9.2); // 1.2 m in front of dummy-1
    g.aimAt(0, 1.15, 8);
    g.tapKey('KeyV');
    expect(g.damaged()).toEqual([
      expect.objectContaining({
        targetId: 'dummy-1',
        source: 'melee',
        quick: true,
        weaponId: 'bareHands',
        zone: 'TORSO',
        amount: 15,
      }),
    ]);
    expect(g.weapons.active).toBe('primary');
  });

  it('a quick melee out of reach hits nothing', () => {
    const g = headlessGame();
    g.startRun();
    g.tapKey('KeyV');
    expect(g.events).toEqual([]);
  });

  it('walls block dummies behind them', () => {
    const g = headlessGame();
    g.startRun();
    g.training.clear();
    g.training.spawn('standard', [0, 0, -4], 0); // behind the signal tower
    g.click();
    expect(g.events).toEqual([]);
    expect(g.shots[0]?.pellets[0]?.hit?.kind).toBe('world');
  });

  it('with dummies in line, the nearest is hit', () => {
    const g = headlessGame();
    g.startRun();
    g.training.spawn('standard', [0, 0, 11], Math.PI); // in front of dummy-1
    g.click();
    expect(g.damaged()[0]?.targetId).toBe('dummy-4');
  });

  it('a kill can drop ammunition; walking over it refills a limited reserve', () => {
    const g = headlessGame({
      dropRng: { next: () => 0 } as unknown as Rng, // every roll drops
      definitions: { ...WEAPONS, pistol: { ...WEAPONS.pistol, reserveAmmo: 0 } },
    });
    g.startRun();
    const pistol = g.weapons.weaponIn('primary') as Firearm;
    expect(pistol.reserve).toBe(0);
    g.click();
    g.click();
    expect(g.pickups.active).toHaveLength(1);
    // Walk forward (north) onto it.
    g.input.keyDown('KeyW');
    g.seconds(1.5);
    g.input.keyUp('KeyW');
    g.frames(2);
    expect(g.pickups.active).toHaveLength(0);
    expect(pistol.reserve).toBe(WEAPONS.pistol.magazineSize);
  });

  it('with the unlimited Pistol, a dropped pickup is not needed and stays', () => {
    const g = headlessGame({ dropRng: { next: () => 0 } as unknown as Rng });
    g.startRun();
    g.click();
    g.click();
    g.player.motor.position.set(0, 0, 8.3);
    g.frames(2);
    expect(g.pickups.active).toHaveLength(1);
  });

  it('a new run restores the range and clears pickups', () => {
    const g = headlessGame({ dropRng: { next: () => 0 } as unknown as Rng });
    g.startRun();
    g.click();
    g.click();
    g.training.spawn('zoned', [5, 0, 5]);
    g.game.state.pause();
    g.game.state.transition('LOADING');
    g.game.state.transition('PLAYING');
    expect(g.training.dummies).toHaveLength(TRAINING_RANGE.dummies.length);
    expect(g.training.dummies.every((d) => d.health.isAlive)).toBe(true);
    expect(g.pickups.active).toHaveLength(0);
    expect(g.player.motor.position.z).toBe(SPAWN_Z);
  });

  it('pausing freezes respawns', () => {
    const g = headlessGame();
    g.startRun();
    g.click();
    g.click();
    g.game.state.pause();
    g.seconds(10);
    expect(g.training.get('dummy-1')?.health.isDead).toBe(true);
    g.game.state.resume();
    g.seconds(TRAINING_DUMMIES.standard.respawnDelay);
    expect(g.training.get('dummy-1')?.health.isAlive).toBe(true);
  });

  it('is deterministic: the same seed and inputs give identical combat events', () => {
    const run = () => {
      const g = headlessGame({ seed: 'same', dropRng: new Rng('same-drops') });
      g.startRun();
      g.input.keyDown('KeyD'); // strafing: moving spread
      for (let i = 0; i < 30; i++) {
        g.aimAt(-3.5 + (i % 7) * 1.1, 1.0 + (i % 5) * 0.2, 9);
        g.click();
      }
      return JSON.stringify({ events: g.events, pickups: g.pickups.active.length });
    };
    const first = run();
    expect(first).toContain('"damaged"');
    expect(run()).toBe(first);
  });
});
