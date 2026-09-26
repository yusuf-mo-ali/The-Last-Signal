/**
 * Headless integration of the enemy foundation (Phase 4), wired as main.ts wires it: the real
 * game loop and state machine, level, player, input stack, weapons, combat, player health,
 * enemies and the placeholder run flow. Input goes in as physical keys and mouse buttons.
 *
 *   Weapon → Hitscan → Walker hit zone → damage → Walker Health → stagger / death
 *   Walker → melee attack → player Health → damage / death → GAME_OVER → restart
 */

import { describe, expect, it } from 'vitest';
import { CombatSystem, type DamagedEvent } from '../combat/CombatSystem';
import { ENEMY_STATS } from '../config/enemies';
import { DEFAULT_BINDINGS, MouseButton } from '../config/input';
import { Game } from '../core/Game';
import { ActionMap } from '../input/ActionMap';
import { InputState } from '../input/InputState';
import { attachStepInput } from '../input/stepInput';
import { Player } from '../player/Player';
import { PlayerController } from '../player/PlayerController';
import { PlayerHealth } from '../player/PlayerHealth';
import { createPlayerTarget } from '../player/PlayerTarget';
import { Rng } from '../utils/Rng';
import { Hitscan } from '../weapons/hitscan';
import type { ShotResult } from '../weapons/types';
import { WeaponController } from '../weapons/WeaponController';
import { WeaponManager } from '../weapons/WeaponManager';
import { WeaponSystem } from '../weapons/WeaponSystem';
import { FACILITY } from '../world/levels/facility';
import { World } from '../world/World';
import { EnemyManager } from './EnemyManager';

const W = ENEMY_STATS.walker;

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
  const playing = () => game.state.isIn('PLAYING');
  const player = new Player({
    world: world.collision,
    level: FACILITY,
    intent: () => {
      const intent = controller.read();
      return weapons.blocksSprint && intent.sprint ? { ...intent, sprint: false } : intent;
    },
    active: playing,
  });
  game.addSystem(player);
  // D-029: the player can only be hurt during WAVE_ACTIVE and BOSS.
  const playerHealth = new PlayerHealth({
    canBeDamaged: () => game.state.isIn('WAVE_ACTIVE') || game.state.isIn('BOSS'),
  });
  const playerTarget = createPlayerTarget(player, playerHealth);
  const hitscan = new Hitscan(world.collision);
  const combat = new CombatSystem({ hitscan, weaponEvents: weapons.events });
  const enemies = new EnemyManager({
    world: world.collision,
    level: FACILITY,
    combat,
    targets: () => [playerTarget],
    rng: new Rng(`${seed}:enemies`),
    active: playing,
    strict: true,
  });
  game.addSystem(enemies); // before the weapons: shots meet this step's hit volumes
  const weaponController = new WeaponController(actions);
  game.addSystem(
    new WeaponSystem({
      manager: weapons,
      player,
      hitscan,
      rng: new Rng(seed),
      input: () => weaponController.read(),
      active: playing,
    }),
  );
  game.addSystem(combat);
  game.state.onEnter('PLAYING', () => {
    player.respawn();
    weapons.reset();
    playerHealth.reset();
    enemies.clear();
  });
  // Placeholder run flow until the wave system (Phase 6): straight into an open-ended wave.
  game.state.onEnter('WAVE_START', () => {
    game.state.transition('WAVE_ACTIVE');
  });
  playerHealth.events.on('died', () => {
    game.state.transition('GAME_OVER');
  });
  game.state.transition('MAIN_MENU');

  const hits: DamagedEvent[] = [];
  combat.events.on('damaged', (e) => hits.push(e));
  const shots: ShotResult[] = [];
  weapons.events.on('shot', (s) => shots.push(s));
  const gameOvers: number[] = [];
  game.state.onEnter('GAME_OVER', () => gameOvers.push(game.time.stepCount));

  const frames = (n: number, hz = 60) => {
    for (let i = 0; i < n; i++) {
      game.frame(1 / hz);
    }
  };
  const seconds = (s: number) => {
    frames(Math.round(s * 60));
  };
  const click = () => {
    input.buttonDown(MouseButton.LEFT);
    frames(1);
    input.buttonUp(MouseButton.LEFT);
    frames(11);
  };
  const tapKey = (code: string) => {
    input.keyDown(code);
    frames(1);
    input.keyUp(code);
    frames(1);
  };
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
  return {
    game,
    input,
    player,
    playerHealth,
    playerTarget,
    weapons,
    combat,
    enemies,
    hits,
    shots,
    gameOvers,
    frames,
    seconds,
    click,
    tapKey,
    aimAt,
    startRun,
  };
}

describe('run flow and player health', () => {
  it('a run goes straight into an open-ended wave (WAVE_ACTIVE), where the player can be hurt', () => {
    const g = headlessGame();
    expect(g.playerHealth.vulnerable).toBe(false); // main menu: D-029
    g.startRun();
    expect(g.game.state.current).toBe('WAVE_ACTIVE');
    expect(g.playerHealth.vulnerable).toBe(true);
    expect(g.playerHealth.current).toBe(100);
  });

  it('paused, the player cannot be hurt (time stands still) and nothing moves', () => {
    const g = headlessGame();
    g.startRun();
    const walker = g.enemies.spawn('walker', [0, 0, 11], { alertTo: g.playerTarget });
    g.game.state.pause();
    const at = walker?.motor.position.clone();
    g.seconds(5);
    expect(walker?.motor.position.toArray()).toEqual(at?.toArray());
    expect(g.playerHealth.current).toBe(100);
  });
});

describe('the pistol against a Walker', () => {
  function standingWalker() {
    const g = headlessGame();
    g.startRun();
    // Straight ahead of the spawn (0, 0, 14), facing it, frozen so it stands still to be shot.
    const walker = g.enemies.spawn('walker', [0, 0, 7], { yaw: Math.PI, patrol: false });
    g.enemies.frozen = true;
    return { g, walker };
  }

  it('a headshot: 65, critical, and it staggers (65 ≥ its threshold)', () => {
    const { g, walker } = standingWalker();
    g.click(); // the view from the spawn is level with its head
    expect(g.hits).toEqual([
      expect.objectContaining({
        targetId: 'walker-1',
        zone: 'HEAD',
        critical: true,
        amount: 65,
        health: W.health - 65,
      }),
    ]);
    expect(walker?.state).toBe('STAGGER');
  });

  it('body, arm and leg shots use their zone multipliers', () => {
    const { g } = standingWalker();
    g.aimAt(0, 1.15, 7);
    g.click();
    g.aimAt(0.31, 1.1, 7); // facing us: its left arm is on our right
    g.click();
    g.aimAt(-0.11, 0.45, 7);
    g.click();
    expect(g.hits.map((h) => [h.zone, Number(h.amount.toFixed(6))])).toEqual([
      ['TORSO', 26],
      ['ARM_LEFT', 16.9],
      ['LEG_RIGHT', 13],
    ]);
  });

  it('two headshots kill it; the body is no longer hit and is removed after its corpse time', () => {
    const { g, walker } = standingWalker();
    g.enemies.frozen = false;
    g.click();
    g.click();
    expect(g.hits.map((h) => h.killed)).toEqual([false, true]);
    expect(walker?.state).toBe('DEAD');
    g.click();
    expect(g.hits).toHaveLength(2); // ignored
    expect(g.shots.at(-1)?.pellets[0]?.hit?.kind).toBe('world');
    g.seconds(W.corpseTime + 0.2);
    expect(g.enemies.enemies).toEqual([]);
    expect(g.combat.get('walker-1')).toBeUndefined();
  });

  it('five body shots kill it (Pass-1 intent: 4–5 body shots)', () => {
    const { g } = standingWalker();
    g.aimAt(0, 1.15, 7);
    for (let i = 0; i < 5; i++) {
      g.click();
    }
    expect(g.hits.map((h) => h.killed)).toEqual([false, false, false, false, true]);
  });

  it('V: a quick melee in reach punches it through the same pipeline', () => {
    const g = headlessGame();
    g.startRun();
    g.enemies.spawn('walker', [0, 0, 12.8], { yaw: Math.PI, patrol: false });
    g.enemies.frozen = true;
    g.aimAt(0, 1.15, 12.8);
    g.tapKey('KeyV');
    expect(g.hits).toEqual([
      expect.objectContaining({ targetId: 'walker-1', source: 'melee', quick: true, amount: 15 }),
    ]);
  });
});

describe('a Walker against the player', () => {
  it('detects, chases, attacks: 15 per hit, one hit per attack, a cooldown apart', () => {
    const g = headlessGame();
    g.startRun();
    g.enemies.spawn('walker', [0, 0, 6], { patrol: false });
    const damage: { step: number; health: number }[] = [];
    g.playerHealth.events.on('damaged', (e) =>
      damage.push({ step: g.game.time.stepCount, health: e.health }),
    );
    g.seconds(12);
    expect(damage.length).toBeGreaterThanOrEqual(3);
    expect(damage.map((d) => d.health).slice(0, 3)).toEqual([85, 70, 55]);
    for (let i = 1; i < damage.length; i++) {
      expect((damage[i]?.step ?? 0) - (damage[i - 1]?.step ?? 0)).toBe(
        Math.round(W.attackCooldown * 60),
      );
    }
  });

  it('kills the player once: GAME_OVER once, no damage after death, enemies stop', () => {
    const g = headlessGame();
    g.startRun();
    const walker = g.enemies.spawn('walker', [0, 0, 12], { patrol: false });
    let deaths = 0;
    g.playerHealth.events.on('died', () => deaths++);
    g.seconds(20);
    expect(g.playerHealth.isDead).toBe(true);
    expect(deaths).toBe(1);
    expect(g.gameOvers).toHaveLength(1);
    expect(g.game.state.current).toBe('GAME_OVER');
    const at = walker?.motor.position.clone();
    g.seconds(5);
    expect(walker?.motor.position.toArray()).toEqual(at?.toArray());
    expect(g.playerHealth.current).toBe(0);
  });

  it('a new run after GAME_OVER resets the player and the enemies', () => {
    const g = headlessGame();
    g.startRun();
    g.enemies.spawn('walker', [0, 0, 12], { patrol: false });
    g.seconds(20);
    expect(g.game.state.current).toBe('GAME_OVER');
    g.game.state.transition('LOADING');
    g.game.state.transition('PLAYING');
    expect(g.game.state.current).toBe('WAVE_ACTIVE');
    expect(g.playerHealth.current).toBe(100);
    expect(g.playerHealth.isDead).toBe(false);
    expect(g.enemies.enemies).toEqual([]);
    expect(g.combat.targets).toEqual([]);
    expect(g.player.motor.position.toArray()).toEqual([...FACILITY.spawn.position]);
  });

  it('walls block its attacks: from outside the control room it must come round through the door', () => {
    const g = headlessGame();
    g.startRun();
    g.player.motor.teleport(g.player.motor.position.set(5, 0, -13.2)); // just inside the south wall
    const walker = g.enemies.spawn('walker', [5, 0, -11.2], {
      patrol: false,
      alertTo: g.playerTarget,
    });
    let firstHitZ = Number.NaN;
    g.playerHealth.events.on('damaged', () => {
      if (Number.isNaN(firstHitZ)) {
        firstHitZ = walker?.motor.position.z ?? 0;
      }
    });
    g.seconds(30);
    expect(firstHitZ).toBeLessThan(-12.4); // it was inside the room when it struck
  });

  it('is identical at 30, 60 and 144 Hz rendering: the same health timeline and positions', () => {
    const run = (hz: number) => {
      const g = headlessGame('rates');
      g.startRun();
      g.enemies.spawn('walker', [2, 0, 7], { patrol: false });
      g.enemies.spawn('walker', [-2, 0, 7], { patrol: false });
      const timeline: string[] = [];
      g.playerHealth.events.on('damaged', (e) =>
        timeline.push(`${g.game.time.stepCount}:${e.health}`),
      );
      while (g.game.time.stepCount < 60 * 15) {
        g.game.frame(1 / hz);
      }
      // Compare at an exact step count (frames of other rates overshoot by a few steps).
      expect(g.game.time.stepCount).toBe(60 * 15); // every rate stops on the same step
      return {
        timeline,
        enemies: g.enemies.enemies.map((e) => [e.state, ...e.motor.position.toArray()]),
      };
    };
    const at60 = run(60);
    expect(at60.timeline.length).toBeGreaterThan(3);
    expect(run(30)).toEqual(at60);
    expect(run(144)).toEqual(at60);
  });
});

describe('Phase 2–3 behaviour is unchanged', () => {
  it('with no enemy in the way, a shot from the spawn still hits the tower', () => {
    const g = headlessGame();
    g.startRun();
    g.click();
    expect(g.shots[0]?.pellets[0]?.hit?.kind).toBe('world');
    expect(g.shots[0]?.pellets[0]?.hit?.point[2]).toBeCloseTo(1.2, 3);
  });
});
