/**
 * Signal Mutations in the full headless game (D-045), wired as `main.ts` wires them: the game loop
 * and state machine, level, player, player health, combat, enemies, waves, the modifier runtime
 * and the mutation system.
 *
 *   mutated waves play out and clear; nothing leaks between waves or runs
 *   the same seed gives the same mutated wave at 30, 60 and 144 Hz
 *   pausing freezes every mutation clock; the damage window (D-029) is untouched
 *   no mutation silently makes a wave impossible (a scripted defender's tripwire)
 */

import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { CombatSystem, type HitInput } from '../combat/CombatSystem';
import { DEFAULT_BINDINGS } from '../config/input';
import { ENEMY_STATS } from '../config/enemies';
import { ENABLED_MUTATION_IDS, MUTATIONS, type MutationId } from '../config/mutations';
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
import { Rng } from '../utils/Rng';
import { SpawnDirector, type SpawnViewer } from '../waves/SpawnDirector';
import { WaveManager } from '../waves/WaveManager';
import { Hitscan } from '../weapons/hitscan';
import { WeaponManager } from '../weapons/WeaponManager';
import { Environment } from '../world/Environment';
import { FACILITY } from '../world/levels/facility';
import { World } from '../world/World';
import { SignalMutationSystem } from './SignalMutationSystem';

const PISTOL = { damage: 26, headshotMultiplier: 2.5 };

function headlessGame(seed = 'mutation-run') {
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
  const mutations = new SignalMutationSystem({
    state: game.state,
    waves,
    enemies,
    router,
    triggers,
    screen,
  });
  waves.attach();
  mutations.attach();
  game.addSystem(waves);
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

  return {
    game,
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

const NONE = { stats: [], triggers: [], environment: [], screen: [] };

describe('mutations integration: a run through mutated waves', () => {
  it('waves 4–8 each carry a mutation, announced, applied, lifted; nothing leaks', () => {
    const g = headlessGame('mutated-run');
    g.playerHealth.godMode = true;
    g.startRun();
    const seen: string[] = [];
    g.mutations.events.on('mutationApplied', (e) => seen.push(`${e.wave}:${e.id}`));
    for (let wave = 1; wave <= 8; wave++) {
      expect(g.until(() => g.game.state.current === 'WAVE_ACTIVE', 15)).toBe(true);
      expect(
        g.until(() => {
          g.killWave();
          return g.game.state.current === 'WAVE_COMPLETE';
        }, 600),
      ).toBe(true);
      // By the end of the breather the lighting has faded back and nothing of the mutation
      // remains (checked before the next wave announces its own).
      g.frames(60 * 3);
      expect(g.router.sources(), `after wave ${wave}`).toEqual(NONE);
      g.until(() => g.game.state.current === 'WAVE_START', 15);
    }
    expect(seen.map((s) => Number(s.split(':')[0]))).toEqual([4, 5, 6, 7, 8]);
    expect(g.waves.stats.snapshot().mutations.filter((m) => m.wave <= 8 && m.id).length).toBe(5);
  });

  it('the damage window is untouched: nothing hurts during the intro or the breather (D-029)', () => {
    const g = headlessGame();
    g.startRun();
    g.waves.startWave(9, 'SCREAM');
    g.playerHealth.damage({ amount: 5, source: { kind: 'debug' } });
    expect(g.playerHealth.current).toBe(g.playerHealth.max);
    g.until(() => g.game.state.current === 'WAVE_ACTIVE', 10);
    g.playerHealth.godMode = true;
    g.until(() => {
      g.killWave();
      return g.game.state.current === 'WAVE_COMPLETE';
    }, 600);
    g.playerHealth.godMode = false;
    g.playerHealth.damage({ amount: 5, source: { kind: 'debug' } });
    expect(g.playerHealth.current).toBe(g.playerHealth.max);
  });

  it('pausing freezes the lighting fade, the STATIC schedule and the surge warning', () => {
    const g = headlessGame();
    g.playerHealth.godMode = true;
    g.startRun();
    g.waves.startWave(10, 'BLACKOUT');
    g.frames(60); // one second into the fade
    const faded = g.environment.resolve().ambient;
    g.game.state.pause();
    g.frames(240);
    expect(g.environment.resolve().ambient).toBe(faded);
    g.game.state.resume();
    g.frames(120);
    expect(g.environment.resolve().ambient).toBeLessThan(faded);

    const s = headlessGame('static-pause');
    s.playerHealth.godMode = true;
    s.startRun();
    s.waves.startWave(10, 'STATIC');
    s.until(() => s.game.state.current === 'WAVE_ACTIVE', 10);
    const next = s.screen.nextIn;
    s.game.state.pause();
    s.frames(600);
    expect(s.screen.nextIn).toBe(next);
  });

  it('death during a mutated wave: effects removed, the prompt can name the mutation, a new run is clean', () => {
    const g = headlessGame();
    g.startRun();
    g.waves.startWave(8, 'HUNGER');
    g.until(() => g.game.state.current === 'WAVE_ACTIVE', 10);
    expect(g.stats.multiplier('enemy.moveSpeed')).toBeCloseTo(1.15);
    g.playerHealth.damage({ amount: g.playerHealth.max, source: { kind: 'debug' } });
    g.frames(1);
    expect(g.game.state.current).toBe('GAME_OVER');
    expect(g.waves.status.mutation).toBe('HUNGER');
    expect(g.stats.multiplier('enemy.moveSpeed')).toBe(1);
    g.startRun();
    expect(g.router.sources()).toEqual(NONE);
    expect(g.waves.status.mutation).toBeNull();
  });
});

describe('the Spitter’s acid in the run (D-046)', () => {
  it('acid in flight never outlives its wave, the run, or survives into a new run', () => {
    const g = headlessGame('acid-lifecycle');
    g.playerHealth.godMode = true;
    g.startRun();
    g.waves.startWave(12, 'none');
    g.until(() => g.game.state.current === 'WAVE_ACTIVE', 10);
    const acid = ENEMY_STATS.spitter.projectile;
    if (!acid) {
      throw new Error('no projectile');
    }
    // Hanging in the air for good: only clearing can remove it.
    const hanging = { ...acid, gravity: 0, lifetime: 1e6 };
    const lob = () => g.projectiles.fire('spitter-x', 'spitter', [0, 20, 0], [0, 0, 0], hanging);
    lob();
    g.frames(120);
    expect(g.projectiles.count).toBe(1);
    // The wave ends: gone at once, no impact.
    g.killWave();
    g.until(() => {
      g.killWave();
      return g.game.state.current !== 'WAVE_ACTIVE';
    }, 120);
    expect(g.game.state.current).toBe('WAVE_COMPLETE');
    expect(g.projectiles.count).toBe(0);
    // Death ends the run: gone.
    g.waves.startWave(13, 'none');
    g.until(() => g.game.state.current === 'WAVE_ACTIVE', 10);
    lob();
    g.frames(30);
    expect(g.projectiles.count).toBe(1);
    g.playerHealth.godMode = false;
    g.playerHealth.damage({ amount: g.playerHealth.max, source: { kind: 'debug' } });
    g.frames(1);
    expect(g.game.state.current).toBe('GAME_OVER');
    expect(g.projectiles.count).toBe(0);
    // And a new run starts with none.
    lob();
    expect(g.projectiles.count).toBe(1);
    g.startRun();
    expect(g.projectiles.count).toBe(0);
  });
});

describe('mutations integration: determinism', () => {
  it('the same seed gives the same mutated wave at 30, 60 and 144 Hz', () => {
    const run = (hz: number, mutation: MutationId) => {
      const g = headlessGame(`det-${mutation}`);
      g.playerHealth.godMode = true;
      g.startRun();
      g.waves.startWave(14, mutation);
      // Kill every other wave enemy as it arrives, so deaths, cries and surges all happen. In a
      // fixed-step system: input has to be in simulated time for the frame rate not to matter.
      let n = 0;
      g.game.addSystem({
        fixedUpdate: () => {
          for (const e of g.enemies.enemies) {
            if (e.alive && g.waves.isWaveEnemy(e.id) && n++ % 2 === 0) {
              g.enemies.kill(e.id);
            }
          }
        },
      });
      g.until(() => g.timeline.length >= 40, 200, hz);
      return g.timeline.slice(0, 40);
    };
    for (const mutation of ['HIVE', 'SCREAM', 'STATIC'] as const) {
      const at60 = run(60, mutation);
      expect(at60, mutation).toHaveLength(40);
      expect(run(30, mutation), mutation).toEqual(at60);
      expect(run(144, mutation), mutation).toEqual(at60);
    }
  });

  it('Spitter volleys, death-cry frenzies and last-known rushes are identical at 30, 60 and 144 Hz', () => {
    const run = (hz: number) => {
      const g = headlessGame('det-spitter');
      g.playerHealth.godMode = true;
      g.startRun();
      g.waves.startWave(16, 'SCREAM');
      // Kill a wave enemy every 3 s of simulated time: cries, frenzies and rushes keep coming.
      let clock = 0;
      g.game.addSystem({
        fixedUpdate: (dt) => {
          clock += dt;
          if (clock >= 3) {
            clock = 0;
            const victim = g.enemies.enemies.find((e) => e.alive && g.waves.isWaveEnemy(e.id));
            if (victim) {
              g.enemies.kill(victim.id);
            }
          }
        },
      });
      g.until(
        () =>
          g.timeline.filter((l) => l.includes(' acid ')).length >= 3 &&
          g.timeline.some((l) => l.includes(' frenzy ')),
        240,
        hz,
      );
      return [...g.timeline];
    };
    const at60 = run(60);
    expect(at60.filter((l) => l.includes(' spit ')).length).toBeGreaterThanOrEqual(3);
    expect(at60.some((l) => l.includes(' frenzy ') && l.includes('deathCry'))).toBe(true);
    expect(run(30)).toEqual(at60);
    expect(run(144)).toEqual(at60);
  }, 60_000);
});

describe('mutations integration: no mutation silently makes a wave impossible', () => {
  /**
   * A competent but imperfect defender: it stands at the spawn (it never retreats or kites) and
   * shoots the nearest enemy it can see within 22 m every 0.35 s, alternating headshots and body
   * shots. It clears the unmutated waves 6, 9 and 12 unhurt; a mutated wave can hurt it (a slower
   * trigger, 0.35 s, already loses 60 health on one unmutated wave-12 seed). Ten seeds per wave,
   * because a defender that cannot move is a chaotic proxy: one seed decides little.
   */
  const DEFENDER = { interval: 0.33, headshotEvery: 2, range: 22 };
  /** Most damage the defender may take on an unmutated wave: it must clear them comfortably. */
  const COMFORTABLE = 50;
  const SEEDS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

  /** Wave `n` from full health, no healing: cleared, or the defender died. */
  const defended = (n: number, mutation: MutationId | 'none', seed: number) => {
    const g = headlessGame(`tripwire-${n}-${seed}`);
    g.startRun();
    g.waves.startWave(n, mutation);
    g.until(() => g.game.state.current === 'WAVE_ACTIVE', 10);
    let taken = 0;
    g.playerHealth.events.on('damaged', (e) => (taken += e.amount));
    g.until(() => {
      g.defend(DEFENDER);
      return g.game.state.current !== 'WAVE_ACTIVE';
    }, 400);
    return { cleared: g.game.state.current === 'WAVE_COMPLETE', taken };
  };

  it('a defender that clears every unmutated wave comfortably survives every mutated one', () => {
    const rows: { n: number; id: string; runs: ReturnType<typeof defended>[] }[] = [];
    for (const n of [6, 9, 12]) {
      for (const id of ['none', ...ENABLED_MUTATION_IDS] as const) {
        if (id !== 'none' && n < MUTATIONS[id].minWave) {
          continue;
        }
        // Tuning runs: `BALANCE_REPORT=1 ONLY=12-HIVE,12-SCREAM` measures just those rows.
        if (process.env.ONLY && !process.env.ONLY.split(',').includes(`${n}-${id}`)) {
          continue;
        }
        rows.push({ n, id, runs: SEEDS.map((seed) => defended(n, id, seed)) });
      }
    }
    if (process.env.BALANCE_REPORT) {
      console.log(
        `health lost by the scripted defender (seeds ${SEEDS.join(', ')})\n${rows
          .map(
            (r) =>
              `wave ${r.n} ${r.id}: ${r.runs.map((x) => (x.cleared ? Math.round(x.taken) : 'died')).join(' / ')}`,
          )
          .join('\n')}`,
      );
    }
    // Not vacuous: the defender is hurt somewhere, so extra pressure does show.
    expect(Math.max(...rows.flatMap((r) => r.runs.map((x) => x.taken)))).toBeGreaterThan(0);
    for (const r of rows) {
      const base = rows.find((b) => b.n === r.n && b.id === 'none');
      r.runs.forEach((run, k) => {
        expect(run.cleared, `${r.id} wave ${r.n} seed ${k}: the defender died`).toBe(true);
        if (r.id === 'none') {
          expect(run.taken, `wave ${r.n} seed ${k} is comfortable`).toBeLessThanOrEqual(
            COMFORTABLE,
          );
        }
        if (r.id === 'BLACKOUT' || r.id === 'STATIC') {
          // Visual only: the simulation is exactly the unmutated one.
          expect(run.taken, `${r.id} wave ${r.n}`).toBe(base?.runs[k]?.taken);
        }
      });
    }
  }, 300_000);
});
