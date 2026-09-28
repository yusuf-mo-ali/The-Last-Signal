/**
 * Headless integration of the wave system (Phase 6), wired as main.ts wires it: the real game loop
 * and state machine, level, player, player health, combat, enemies and the wave runtime with the
 * facility's spawn points.
 *
 *   new run → wave 1 intro → spawns out of view → cleared → breather → wave 2 → …
 *   damage only while a wave is active (D-029); death → GAME_OVER with the wave reached
 *   the same seed spawns the same enemies at the same steps at any frame rate
 */

import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { CombatSystem } from '../combat/CombatSystem';
import { DEFAULT_BINDINGS } from '../config/input';
import { WAVE_RULES } from '../config/waves';
import { Game } from '../core/Game';
import { EnemyManager } from '../enemies/EnemyManager';
import { ActionMap } from '../input/ActionMap';
import { InputState } from '../input/InputState';
import { attachStepInput } from '../input/stepInput';
import { Player } from '../player/Player';
import { PlayerController } from '../player/PlayerController';
import { PlayerHealth } from '../player/PlayerHealth';
import { createPlayerTarget } from '../player/PlayerTarget';
import { Rng } from '../utils/Rng';
import { Hitscan } from '../weapons/hitscan';
import { WeaponManager } from '../weapons/WeaponManager';
import { FACILITY, FACILITY_SPAWN_POINTS } from '../world/levels/facility';
import { World } from '../world/World';
import type { WaveEvents } from './events';
import { SpawnDirector, type SpawnViewer } from './SpawnDirector';
import { WaveManager } from './WaveManager';

const FOV = 100;

function headlessRun(seed = 'integration') {
  const game = new Game({ strict: true });
  const world = new World(FACILITY);
  game.addSystem(world);
  const input = new InputState();
  const stepReader = input.createReader();
  attachStepInput(game, stepReader);
  const controller = new PlayerController(new ActionMap(stepReader, DEFAULT_BINDINGS));
  const playing = () => game.state.isIn('PLAYING');
  const player = new Player({
    world: world.collision,
    level: FACILITY,
    intent: () => controller.read(),
    active: playing,
  });
  game.addSystem(player);
  const playerHealth = new PlayerHealth({
    canBeDamaged: () => game.state.isIn('WAVE_ACTIVE') || game.state.isIn('BOSS'),
  });
  const playerTarget = createPlayerTarget(player, playerHealth);
  const weapons = new WeaponManager();
  const combat = new CombatSystem({
    hitscan: new Hitscan(world.collision),
    weaponEvents: weapons.events,
  });
  const enemies = new EnemyManager({
    world: world.collision,
    level: FACILITY,
    combat,
    targets: () => [playerTarget],
    rng: new Rng(`${seed}:enemies`),
    active: playing,
    strict: true,
  });
  const spawns = new SpawnDirector({
    points: FACILITY_SPAWN_POINTS,
    canStand: (a, at) => enemies.canStand(a, at),
    lineOfSight: (from, to) => enemies.lines.lineOfSight(from, to),
    walkable: (from, to, r) => enemies.lines.walkable(from, to, r),
    rng: new Rng(`${seed}:spawn-points`),
  });
  const eye = new Vector3();
  const viewer = (): SpawnViewer => {
    const p = player.motor.position;
    eye.set(p.x, p.y + player.motor.eyeHeight, p.z);
    return { eye, yaw: player.look.yaw, fovDeg: FOV };
  };
  const waves = new WaveManager({
    state: game.state,
    enemies,
    spawns,
    target: () => playerTarget,
    viewer,
    seed,
    combat: combat.events,
    player: playerHealth.events,
  });
  waves.attach();
  game.addSystem(waves); // before the enemies: a group spawns before anything moves
  game.addSystem(enemies);
  game.addSystem(combat);
  game.state.onEnter('PLAYING', () => {
    player.respawn();
    weapons.reset();
    playerHealth.reset();
    enemies.clear();
  });
  playerHealth.events.on('died', () => {
    game.state.transition('GAME_OVER');
  });
  game.state.transition('MAIN_MENU');

  const spawned: (WaveEvents['enemySpawned'] & { step: number })[] = [];
  waves.events.on('enemySpawned', (e) => spawned.push({ ...e, step: game.time.stepCount }));
  const damageStates: string[] = [];
  playerHealth.events.on('damaged', () => damageStates.push(game.state.current));

  const frames = (n: number, hz = 60) => {
    for (let i = 0; i < n; i++) {
      game.frame(1 / hz);
    }
  };
  const until = (done: () => boolean, maxSeconds = 300, hz = 60) => {
    for (let i = 0; i < maxSeconds * hz; i++) {
      if (done()) {
        return true;
      }
      frames(1, hz);
    }
    return done();
  };
  const killWave = () => {
    for (const e of enemies.enemies) {
      if (e.alive && waves.isWaveEnemy(e.id)) {
        enemies.kill(e.id);
      }
    }
  };
  const startRun = () => {
    game.state.transition('LOADING');
    game.state.transition('PLAYING');
  };
  return {
    game,
    player,
    playerHealth,
    enemies,
    waves,
    spawns,
    viewer,
    spawned,
    damageStates,
    frames,
    until,
    killWave,
    startRun,
  };
}

describe('waves integration: a run through the first waves', () => {
  it('waves 1–3 are announced, spawn fairly, clear, rest and hand over to the next', () => {
    const r = headlessRun();
    const checked = new Set<string>();
    r.startRun();
    for (const wave of [1, 2, 3]) {
      expect(r.game.state.current).toBe('WAVE_START');
      expect(r.waves.wave).toBe(wave);
      expect(r.until(() => r.game.state.current === 'WAVE_ACTIVE', 10)).toBe(true);
      // Kill wave enemies as they arrive; each must have entered out of the player's view.
      const cleared = r.until(() => {
        for (const s of r.spawned.filter((e) => e.wave === wave && !checked.has(e.id))) {
          checked.add(s.id);
          const point = FACILITY_SPAWN_POINTS.find((p) => p.id === s.spawnPointId);
          expect(point).toBeDefined();
          if (point) {
            expect(r.spawns.status(point, r.viewer())).toBe('eligible');
          }
        }
        r.killWave();
        return r.game.state.current === 'WAVE_COMPLETE';
      });
      expect(cleared).toBe(true);
      const count = r.spawned.filter((e) => e.wave === wave).length;
      expect(count).toBe(r.waves.definition?.spawns.length);
      // The breather: nothing spawns, then the next wave's intro.
      const before = r.spawned.length;
      expect(r.until(() => r.game.state.current === 'WAVE_START', WAVE_RULES.breather + 1)).toBe(
        true,
      );
      expect(r.spawned.length).toBe(before);
    }
    expect(r.waves.wave).toBe(4);
    expect(r.waves.stats.snapshot().wavesCleared).toBe(3);
    expect(r.enemies.enemies.filter((e) => e.alive)).toHaveLength(0);
  });

  it('the player can only be hurt while a wave is active (D-029)', () => {
    const r = headlessRun();
    r.startRun();
    const hit = () => {
      r.playerHealth.damage({ amount: 5, source: { kind: 'debug' } });
    };
    hit(); // intro
    expect(r.playerHealth.current).toBe(r.playerHealth.max);
    r.until(() => r.game.state.current === 'WAVE_ACTIVE', 10);
    hit();
    expect(r.playerHealth.current).toBe(r.playerHealth.max - 5);
    r.until(() => {
      r.killWave();
      return r.game.state.current === 'WAVE_COMPLETE';
    });
    hit(); // breather
    expect(r.playerHealth.current).toBe(r.playerHealth.max - 5);
    expect(r.damageStates.every((s) => s === 'WAVE_ACTIVE')).toBe(true);
  });

  it('death ends the run on the wave reached; nothing spawns after; a new run starts at wave 1', () => {
    const r = headlessRun();
    r.startRun();
    r.until(() => {
      r.killWave();
      return r.waves.wave === 2 && r.game.state.current === 'WAVE_ACTIVE';
    });
    r.until(() => r.spawned.some((e) => e.wave === 2), 10);
    r.playerHealth.damage({ amount: r.playerHealth.max, source: { kind: 'debug' } });
    r.frames(1);
    expect(r.game.state.current).toBe('GAME_OVER');
    expect(r.waves.stats.snapshot().waveReached).toBe(2);
    const before = r.spawned.length;
    r.frames(600);
    expect(r.spawned.length).toBe(before);
    r.startRun();
    expect(r.game.state.current).toBe('WAVE_START');
    expect(r.waves.wave).toBe(1);
    expect(r.waves.stats.snapshot().waveReached).toBe(1);
    expect(r.enemies.enemies.filter((e) => e.alive)).toHaveLength(0);
  });
});

describe('waves integration: frame-rate independence', () => {
  it('the same seed spawns the same enemies at the same steps at 30, 60 and 144 Hz', () => {
    const timeline = (hz: number) => {
      const r = headlessRun('timeline');
      r.playerHealth.godMode = true;
      r.startRun();
      r.waves.startWave(6);
      r.until(() => r.spawned.length >= 8, 120, hz);
      return r.spawned
        .slice(0, 8)
        .map((e) => `${e.step}:${e.archetype}:${e.traits.join('+')}:${e.spawnPointId}`);
    };
    const at60 = timeline(60);
    expect(at60).toHaveLength(8);
    expect(timeline(30)).toEqual(at60);
    expect(timeline(144)).toEqual(at60);
  });
});
