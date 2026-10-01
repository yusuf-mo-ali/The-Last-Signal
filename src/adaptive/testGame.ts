/**
 * The full headless game with the Adaptive system (D-047), wired as `main.ts` wires it: the game loop
 * and state machine, level, player, player health, weapons, combat, enemies and their acid, waves,
 * the modifier runtime, the mutation system and the adaptive system. For integration tests only
 * (never imported by the game); a sibling of `enemies/testWorld.ts`.
 *
 * Also a scripted defender (as the mutation tripwire's) and helpers to place the player.
 */

import { Vector3 } from 'three';
import { CombatSystem, type HitInput } from '../combat/CombatSystem';
import { DEFAULT_BINDINGS } from '../config/input';
import { PLAYER_MOVEMENT } from '../config/player';
import { WEAPONS } from '../config/weapons';
import { Game } from '../core/Game';
import { EnemyManager } from '../enemies/EnemyManager';
import { EnemyProjectiles } from '../enemies/EnemyProjectiles';
import { ActionMap } from '../input/ActionMap';
import { InputState } from '../input/InputState';
import { attachStepInput } from '../input/stepInput';
import { EffectRouter } from '../modifiers/EffectRouter';
import { ScreenEffects } from '../modifiers/ScreenEffects';
import { StatRegistry } from '../modifiers/StatRegistry';
import { TriggerRegistry } from '../modifiers/TriggerRegistry';
import { Player } from '../player/Player';
import { PlayerController } from '../player/PlayerController';
import { PlayerHealth } from '../player/PlayerHealth';
import { createPlayerTarget } from '../player/PlayerTarget';
import { SignalMutationSystem } from '../signal/SignalMutationSystem';
import { Rng } from '../utils/Rng';
import { SpawnDirector, type SpawnViewer } from '../waves/SpawnDirector';
import { WaveManager } from '../waves/WaveManager';
import { Hitscan } from '../weapons/hitscan';
import { WeaponManager } from '../weapons/WeaponManager';
import { Environment } from '../world/Environment';
import { FACILITY } from '../world/levels/facility';
import { World } from '../world/World';
import type { CompositionModifier } from '../config/waves';
import { AdaptiveSystem } from './AdaptiveSystem';
import { firearmsOwned } from './BehaviorTelemetry';

const PISTOL = WEAPONS.pistol;

export type HeadlessGame = ReturnType<typeof headlessGame>;

export function headlessGame(seed = 'adaptive-run', { adaptive: withAdaptive = true } = {}) {
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
  const stats = new StatRegistry(['enemy.moveSpeed', 'enemy.acceleration']);
  const triggers = new TriggerRegistry();
  const environment = new Environment();
  const screen = new ScreenEffects();
  const router = new EffectRouter({ stats, triggers, environment, screen });
  const enemies = new EnemyManager({
    world: world.collision,
    level: FACILITY,
    combat,
    targets: () => [playerTarget],
    rng: new Rng(`${seed}:enemies`),
    active: playing,
    strict: true,
    modifiers: stats,
  });
  const spawns = new SpawnDirector({
    points: FACILITY.spawnPoints ?? [],
    canStand: (a, at) => enemies.canStand(a, at),
    lineOfSight: (from, to) => enemies.lines.lineOfSight(from, to),
    walkable: (from, to, r) => enemies.lines.walkable(from, to, r),
    rng: new Rng(`${seed}:spawn-points`),
  });
  const eye = new Vector3();
  const viewer = (): SpawnViewer => {
    const p = player.motor.position;
    eye.set(p.x, p.y + player.motor.eyeHeight, p.z);
    return { eye, yaw: player.look.yaw, fovDeg: 100 };
  };
  const waves: WaveManager = new WaveManager({
    state: game.state,
    enemies,
    spawns,
    target: () => playerTarget,
    viewer,
    seed,
    combat: combat.events,
    player: playerHealth.events,
    modifiers: (wave): readonly CompositionModifier[] => adaptive.modifiers(wave),
  });
  const mutations = new SignalMutationSystem({
    state: game.state,
    waves,
    enemies,
    router,
    triggers,
    screen,
  });
  const adaptive: AdaptiveSystem = new AdaptiveSystem({
    state: game.state,
    waves,
    enemies,
    combat: combat.events,
    player: playerHealth.events,
    weapons: weapons.events,
    body: () => (playing() ? player.motor : null),
    walkSpeed: PLAYER_MOVEMENT.walkSpeed,
    firearmsOwned: () => firearmsOwned(weapons.loadout),
    spawnPoints: FACILITY.spawnPoints ?? [],
    fixedDt: game.time.fixedDt,
  });
  waves.attach();
  mutations.attach();
  if (withAdaptive) {
    adaptive.attach();
  }
  game.addSystem(waves);
  game.addSystem(adaptive);
  game.addSystem(environment);
  game.addSystem(screen);
  // The Spitter's acid, as `main.ts` wires it (D-046).
  const projectiles = new EnemyProjectiles({
    world: world.collision,
    targets: () => [playerTarget],
    active: playing,
    killPlaneY: FACILITY.killPlaneY,
    enemyEvents: enemies.events,
  });
  game.addSystem(enemies);
  game.addSystem(projectiles);
  game.addSystem(combat);
  projectiles.bindToRun(game.state);
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

  const timeline: string[] = [];
  waves.events.on('enemySpawned', (e) =>
    timeline.push(`${game.time.stepCount} spawn ${e.archetype} ${e.spawnPointId}`),
  );
  waves.events.on('surgeWarning', (e) => timeline.push(`${game.time.stepCount} surge ${e.region}`));
  enemies.events.on('alarm', (e) => timeline.push(`${game.time.stepCount} alarm ${e.kind}`));
  enemies.events.on('frenzied', (e) =>
    timeline.push(`${game.time.stepCount} frenzy ${e.id} ${e.kind} ${e.until.toFixed(4)}`),
  );
  enemies.events.on('spat', (e) =>
    timeline.push(
      `${game.time.stepCount} spit ${e.id} ${e.velocity.map((v) => v.toFixed(4)).join(',')}`,
    ),
  );
  projectiles.events.on('projectileImpact', (e) =>
    timeline.push(
      `${game.time.stepCount} acid ${e.kind} ${e.amount} ${e.position.map((v) => v.toFixed(4)).join(',')}`,
    ),
  );
  mutations.events.on('staticBurst', (e) =>
    timeline.push(`${game.time.stepCount} burst ${e.until.toFixed(4)}`),
  );

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

  /**
   * A scripted defender at the spawn: every `interval` seconds it shoots a wave enemy it can see
   * within `range`, one headshot in every `headshotEvery` shots and body shots otherwise, with the
   * Pistol (no god mode). Like a real player it picks its targets (D-046): a melee enemy about to
   * reach it first (within `close`), then priority targets (the nearest visible enemy that does
   * not fight in melee: a Screamer, a Spitter), else the nearest.
   */
  let shotClock = 0;
  let shots = 0;
  const defend = ({ interval = 0.3, headshotEvery = 2, range = 40, close = 5 } = {}) => {
    shotClock += 1 / 60;
    if (shotClock < interval) {
      return;
    }
    const from = viewer().eye;
    let best: { id: string; d: number; head: Vector3; priority: number } | null = null;
    for (const e of enemies.enemies) {
      if (!e.alive || !waves.isWaveEnemy(e.id)) {
        continue;
      }
      const head = e.motor.position.clone();
      head.y += e.config.body.height * 0.9;
      const d = head.distanceTo(from);
      const melee = e.config.behavior === 'melee';
      const priority = melee ? (d < close ? 0 : 2) : 1;
      const better =
        !best || priority < best.priority || (priority === best.priority && d < best.d);
      if (d < range && better && enemies.lines.lineOfSight(from, head)) {
        best = { id: e.id, d, head, priority };
      }
    }
    if (!best) {
      return;
    }
    shotClock = 0;
    const headshot = shots++ % headshotEvery === 0;
    const dir = best.head.clone().sub(from).normalize();
    const hit: HitInput = {
      targetId: best.id,
      zone: headshot ? 'HEAD' : 'TORSO',
      weaponId: 'pistol',
      source: 'shot',
      quick: false,
      baseDamage: PISTOL.damage,
      falloff: 1,
      headshotMultiplier: PISTOL.headshotMultiplier,
      point: [best.head.x, best.head.y, best.head.z],
      direction: [dir.x, dir.y, dir.z],
      distance: best.d,
    };
    combat.applyHit(hit);
  };

  /** Puts the player at (x, y, z), standing still. */
  const place = (x: number, y: number, z: number) => {
    player.motor.teleport(new Vector3(x, y, z));
  };

  return {
    game,
    adaptive,
    place,
    weapons,
    combat,
    player,
    playerHealth,
    enemies,
    projectiles,
    waves,
    mutations,
    router,
    environment,
    screen,
    stats,
    timeline,
    frames,
    until,
    killWave,
    startRun,
    defend,
  };
}
