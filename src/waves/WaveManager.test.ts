/**
 * The wave runtime (D-044) headless: the real state machine, the facility, the enemy manager and
 * combat. Transitions and their timing to the step, pacing under the concurrency cap, completion,
 * the breather, victory and endless, death and new runs, pause, the alarm pull-forward, stragglers,
 * deferral and the relaxed fallback, run stats, determinism.
 */

import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { HitInput } from '../combat/CombatSystem';
import { WAVE_RULES, type WaveRules } from '../config/waves';
import { GameStateMachine } from '../core/GameState';
import { DT, enemyTestWorld, TestTarget } from '../enemies/testWorld';
import { Rng } from '../utils/Rng';
import { FACILITY, FACILITY_SPAWN_POINTS } from '../world/levels/facility';
import type { SpawnPointDefinition } from '../world/levels/types';
import { World } from '../world/World';
import type { WaveEvents } from './events';
import { SpawnDirector, type SpawnViewer } from './SpawnDirector';
import { WaveManager } from './WaveManager';

const facility = new World(FACILITY);
const steps = (seconds: number) => Math.round(seconds / DT);

type Recorded = { [K in keyof WaveEvents]: { type: K; payload: WaveEvents[K] } }[keyof WaveEvents];

function harness(
  options: {
    endless?: boolean;
    seed?: string;
    rules?: WaveRules;
    points?: readonly SpawnPointDefinition[];
    viewer?: SpawnViewer;
  } = {},
) {
  const target = new TestTarget(0, 14);
  target.health = 1e9;
  const t = enemyTestWorld({ targets: [target], world: facility.collision, level: FACILITY });
  const state = new GameStateMachine({ strict: true });
  const spawns = new SpawnDirector({
    points: options.points ?? FACILITY_SPAWN_POINTS,
    canStand: (a, at) => t.manager.canStand(a, at),
    lineOfSight: (from, to) => t.manager.lines.lineOfSight(from, to),
    walkable: (from, to, r) => t.manager.lines.walkable(from, to, r),
    rng: new Rng('unused'),
    ...(options.rules ? { rules: options.rules } : {}),
  });
  const view = options.viewer ?? { eye: new Vector3(0, 1.62, 14), yaw: 0, fovDeg: 100 };
  const waves = new WaveManager({
    state,
    enemies: t.manager,
    spawns,
    target: () => target,
    viewer: () => view,
    seed: options.seed ?? 'waves',
    combat: t.combat.events,
    endless: options.endless ?? false,
    ...(options.rules ? { rules: options.rules } : {}),
  });
  waves.attach();
  const log: Recorded[] = [];
  for (const type of [
    'waveStarting',
    'waveStarted',
    'enemySpawned',
    'spawnDeferred',
    'waveCompleted',
    'runVictory',
    'stragglers',
    'reinforcementsPulled',
  ] as const) {
    waves.events.on(type, (payload: unknown) => {
      log.push({ type, payload } as Recorded);
    });
  }
  const of = <K extends keyof WaveEvents>(type: K): WaveEvents[K][] =>
    log.flatMap((e) => (e.type === type ? [e.payload as WaveEvents[K]] : []));
  let stepCount = 0;
  const step = (n = 1) => {
    for (let i = 0; i < n; i++) {
      if (state.isIn('PLAYING')) {
        waves.fixedUpdate(DT);
        t.step();
      }
      stepCount++;
    }
  };
  const until = (done: () => boolean, maxSeconds = 120) => {
    for (let i = 0; i < steps(maxSeconds); i++) {
      if (done()) {
        return i;
      }
      step();
    }
    return -1;
  };
  const waveEnemies = () => t.manager.enemies.filter((e) => e.alive && waves.isWaveEnemy(e.id));
  const killWave = () => {
    for (const e of waveEnemies()) {
      t.manager.kill(e.id);
    }
  };
  /** Kills wave enemies as they appear until the wave completes. */
  const clearWave = (maxSeconds = 300) =>
    until(() => {
      killWave();
      return state.current !== 'WAVE_ACTIVE';
    }, maxSeconds);
  const startRun = () => {
    state.transition('MAIN_MENU');
    state.transition('LOADING');
    state.transition('PLAYING');
  };
  return {
    t,
    target,
    state,
    waves,
    spawns,
    log,
    of,
    step,
    until,
    waveEnemies,
    killWave,
    clearWave,
    startRun,
    get stepCount() {
      return stepCount;
    },
  };
}

describe('WaveManager: the wave cycle', () => {
  it('a run opens on wave 1: announced, then active after exactly the intro', () => {
    const h = harness();
    h.startRun();
    expect(h.state.current).toBe('WAVE_START');
    expect(h.waves.wave).toBe(1);
    expect(h.of('waveStarting')).toHaveLength(1);
    expect(h.of('waveStarting')[0]?.definition.enemyBudget).toBe(6);
    const intro = h.until(() => h.state.current === 'WAVE_ACTIVE');
    expect(intro).toBe(steps(WAVE_RULES.introTime));
    expect(h.of('waveStarted')).toEqual([{ wave: 1 }]);
  });

  it('the first group arrives after its delay; the whole wave spawns once, each enemy once', () => {
    const h = harness();
    h.startRun();
    h.until(() => h.state.current === 'WAVE_ACTIVE');
    const first = h.until(() => h.of('enemySpawned').length > 0);
    expect(first).toBe(steps(WAVE_RULES.firstGroupDelay));
    h.clearWave();
    const def = h.waves.definition;
    const spawned = h.of('enemySpawned');
    expect(spawned.map((s) => s.archetype)).toEqual(def?.spawns.map((s) => s.archetype));
    expect(new Set(spawned.map((s) => s.id)).size).toBe(spawned.length);
    expect(spawned.every((s) => !s.relaxed)).toBe(true);
  });

  it('every wave enemy knows where the player is the moment it spawns, and does not patrol', () => {
    const h = harness();
    const checked: string[] = [];
    h.waves.events.on('enemySpawned', (e) => {
      const enemy = h.t.manager.get(e.id);
      expect(enemy?.target?.id).toBe(h.target.id);
      expect(enemy?.patrols).toBe(false);
      checked.push(e.id);
    });
    h.startRun();
    h.waves.startWave(5);
    h.until(() => h.state.current === 'WAVE_ACTIVE');
    h.clearWave();
    expect(checked.length).toBe(h.waves.definition?.spawns.length);
  });

  it('spawns out of the player’s view and never close to them', () => {
    const h = harness();
    h.startRun();
    h.waves.startWave(10);
    h.clearWave();
    const view = { eye: new Vector3(0, 1.62, 14), yaw: 0, fovDeg: 100 };
    for (const s of h.of('enemySpawned')) {
      const point = FACILITY_SPAWN_POINTS.find((p) => p.id === s.spawnPointId);
      expect(point).toBeDefined();
      if (point) {
        expect(h.spawns.inView(point, view)).toBe(false);
        expect(Math.hypot(point.position[0], point.position[2] - 14)).toBeGreaterThanOrEqual(12);
      }
    }
  });

  it('never more wave enemies alive than the wave allows; more come as others die', () => {
    const h = harness();
    h.startRun();
    h.waves.startWave(12); // budget 40, maxAlive 17
    h.until(() => h.state.current === 'WAVE_ACTIVE');
    let peak = 0;
    for (let i = 0; i < steps(60); i++) {
      h.step();
      peak = Math.max(peak, h.waveEnemies().length);
    }
    const def = h.waves.definition;
    expect(peak).toBe(def?.maxAlive);
    expect(h.waves.status.queued).toBeGreaterThan(0); // held back by the cap
    const before = h.waves.status.spawned;
    h.killWave();
    h.step(steps(5));
    expect(h.waves.status.spawned).toBeGreaterThan(before);
  });

  it('completes when the last wave enemy dies; a breather, then the next wave', () => {
    const h = harness();
    h.startRun();
    h.until(() => h.state.current === 'WAVE_ACTIVE');
    h.clearWave();
    expect(h.state.current).toBe('WAVE_COMPLETE');
    expect(h.of('waveCompleted')).toEqual([
      expect.objectContaining({ wave: 1, kills: 6, finale: false }),
    ]);
    const breather = h.until(() => h.state.current !== 'WAVE_COMPLETE');
    expect(breather).toBe(steps(WAVE_RULES.breather));
    // UPGRADE_SELECTION passes straight through (Phase 9 fills it).
    expect(h.state.current).toBe('WAVE_START');
    expect(h.waves.wave).toBe(2);
    expect(h.waves.definition?.enemyBudget).toBe(8);
  });

  it('enemies spawned outside the wave never hold it open; a wave enemy that falls out counts', () => {
    const h = harness();
    h.startRun();
    h.until(() => h.state.current === 'WAVE_ACTIVE');
    h.t.manager.spawn('walker', [20, 0, -20], { patrol: false }); // a debug spawn
    h.until(() => h.waveEnemies().length > 0);
    const [first] = h.waveEnemies();
    if (first) {
      h.t.manager.despawn(first.id);
    }
    expect(h.waves.isWaveEnemy(first?.id ?? '')).toBe(false);
    h.clearWave();
    expect(h.state.current).toBe('WAVE_COMPLETE');
  });
});

describe('WaveManager: the end of a run', () => {
  it('clearing the final wave is a victory', () => {
    const h = harness();
    h.startRun();
    expect(h.waves.startWave(20)).toBe(true);
    expect(h.waves.definition?.finale).toBe(true);
    h.until(() => h.state.current === 'WAVE_ACTIVE');
    h.clearWave(600);
    expect(h.state.current).toBe('VICTORY');
    expect(h.of('runVictory')).toEqual([expect.objectContaining({ wave: 20 })]);
  });

  it('in endless mode the run goes on past the final wave', () => {
    const h = harness({ endless: true });
    h.startRun();
    h.waves.startWave(20);
    h.until(() => h.state.current === 'WAVE_ACTIVE');
    h.clearWave(600);
    expect(h.state.current).toBe('WAVE_COMPLETE');
    h.until(() => h.state.current === 'WAVE_START');
    expect(h.waves.wave).toBe(21);
    expect(h.of('runVictory')).toEqual([]);
  });

  it('death stops the waves; a new run starts over at wave 1 with fresh stats', () => {
    const h = harness();
    h.startRun();
    h.until(() => h.state.current === 'WAVE_ACTIVE');
    h.until(() => h.waveEnemies().length > 0);
    h.killWave();
    h.state.transition('GAME_OVER');
    const spawned = h.waves.status.spawned;
    for (let i = 0; i < steps(10); i++) {
      h.waves.fixedUpdate(DT); // even if something kept stepping it
    }
    expect(h.waves.status.spawned).toBe(spawned);
    expect(h.waves.stats.kills).toBeGreaterThan(0);
    h.state.transition('LOADING');
    h.state.transition('PLAYING');
    expect(h.waves.wave).toBe(1);
    expect(h.waves.stats.kills).toBe(0);
    expect(h.waves.stats.waveReached).toBe(1);
  });

  it('paused, nothing moves on; resumed, it carries on where it was', () => {
    const h = harness();
    h.startRun();
    h.step(steps(1));
    h.state.pause();
    const timer = h.waves.status.timer;
    h.step(steps(5));
    expect(h.waves.status.timer).toBe(timer);
    h.state.resume();
    expect(h.state.current).toBe('WAVE_START');
    const rest = h.until(() => h.state.current === 'WAVE_ACTIVE');
    expect(rest).toBe(steps(WAVE_RULES.introTime - 1));
  });
});

describe('WaveManager: alarms, stragglers and fallbacks', () => {
  it('an alarm pulls the next group forward, toward it, without adding to the wave', () => {
    const h = harness();
    h.startRun();
    h.waves.startWave(9); // budget 29
    h.until(() => h.state.current === 'WAVE_ACTIVE');
    h.until(() => h.waves.status.spawned > 0);
    h.step(); // the next group is now a while away
    const spawnedBefore = h.waves.status.spawned;
    h.t.manager.events.emit('alarm', {
      sourceId: 'screamer-x',
      kind: 'scream',
      reinforcements: true,
      position: [20, 0, -20],
      radius: 18,
      targetId: 'player',
      targetPosition: [0, 0, 14],
      alertDuration: 8,
      alertMode: 'live',
      haste: null,
      frenzy: null,
      time: 0,
    });
    h.step();
    expect(h.waves.status.spawned).toBeGreaterThan(spawnedBefore);
    expect(h.of('reinforcementsPulled')).toEqual([
      expect.objectContaining({ alarmSourceId: 'screamer-x' }),
    ]);
    h.clearWave(600);
    expect(h.of('enemySpawned')).toHaveLength(h.waves.definition?.spawns.length ?? -1);
  });

  it('stragglers that stop making progress are moved to a fresh spawn point', () => {
    const rules: WaveRules = {
      ...WAVE_RULES,
      stragglers: { maxRemaining: 2, timeout: 5, farDistance: 0 },
    };
    const h = harness({ rules });
    h.startRun();
    h.until(() => h.state.current === 'WAVE_ACTIVE');
    h.until(() => h.waves.status.queued === 0);
    const alive = h.waveEnemies();
    for (const e of alive.slice(0, alive.length - 1)) {
      h.t.manager.kill(e.id);
    }
    const last = h.waveEnemies()[0];
    const before = last?.motor.position.clone();
    h.t.manager.frozen = true; // it gets nowhere
    h.until(() => h.of('stragglers').length > 0, 10);
    const moved = h.of('stragglers')[0]?.ids ?? [];
    expect(moved).toHaveLength(1);
    expect(h.waves.isWaveEnemy(moved[0] ?? '')).toBe(true);
    expect(h.waveEnemies()).toHaveLength(1);
    // Re-spawned (a pooled id may be reused) somewhere else: at a spawn point, away from the old spot.
    const after = h.t.manager.get(moved[0] ?? '')?.motor.position;
    expect(after && before && after.distanceTo(before)).toBeGreaterThan(1);
    expect(h.waves.stats.stragglersMoved).toBe(1);
    expect(h.state.current).toBe('WAVE_ACTIVE'); // still the same wave
  });

  it('no fair point: the group waits, then spawns with the view rule relaxed', () => {
    const point = FACILITY_SPAWN_POINTS.find((p) => p.id === 'yard-nw');
    if (!point) {
      throw new Error('yard-nw');
    }
    // The only point, in plain view.
    const viewer: SpawnViewer = {
      eye: new Vector3(0, 1.62, 14),
      yaw: Math.atan2(14, 23),
      fovDeg: 100,
    };
    const h = harness({ points: [point], viewer });
    h.startRun();
    h.until(() => h.state.current === 'WAVE_ACTIVE');
    const waited = h.until(() => h.of('enemySpawned').length > 0, 20);
    expect(h.of('spawnDeferred')).toHaveLength(1);
    expect(waited).toBeGreaterThanOrEqual(
      steps(WAVE_RULES.firstGroupDelay + WAVE_RULES.spawn.relaxAfter) - 1,
    );
    expect(h.of('enemySpawned')[0]?.relaxed).toBe(true);
    expect(h.waves.stats.relaxedSpawns).toBe(1);
  });
});

describe('WaveManager: stats and determinism', () => {
  it('counts kills, headshots and cleared waves', () => {
    const h = harness();
    h.startRun();
    h.until(() => h.state.current === 'WAVE_ACTIVE');
    h.until(() => h.waveEnemies().length > 0);
    const [first] = h.waveEnemies();
    const hit: HitInput = {
      targetId: first?.id ?? '',
      zone: 'HEAD',
      weaponId: 'pistol',
      source: 'shot',
      quick: false,
      baseDamage: 26,
      falloff: 1,
      headshotMultiplier: 2.5,
      point: [0, 1.6, 0],
      direction: [0, 0, -1],
      distance: 10,
    };
    h.t.combat.applyHit(hit);
    expect(h.waves.stats.headshots).toBe(1);
    h.clearWave();
    expect(h.waves.stats.snapshot()).toMatchObject({
      waveReached: 1,
      wavesCleared: 1,
      kills: 6,
      killsByArchetype: { walker: 6 },
      headshots: 1,
    });
    expect(h.waves.stats.waveTimes).toHaveLength(1);
  });

  it('counts Elite kills from the traits a death reports', () => {
    const h = harness();
    h.startRun();
    h.waves.startWave(20);
    h.until(() => h.state.current === 'WAVE_ACTIVE');
    const elites = h.waves.definition?.spawns.filter((s) => s.traits.includes('elite')).length;
    expect(elites).toBeGreaterThan(0);
    h.clearWave(600);
    expect(h.waves.stats.eliteKills).toBe(elites);
  });

  it('the same seed gives the same spawns: what, where and when', () => {
    const run = () => {
      const h = harness({ seed: 'same' });
      const timeline: string[] = [];
      h.waves.events.on('enemySpawned', (e) => {
        timeline.push(`${h.stepCount} ${e.archetype} ${e.spawnPointId}`);
      });
      h.startRun();
      h.waves.startWave(8);
      h.until(() => h.state.current === 'WAVE_ACTIVE');
      h.clearWave();
      return timeline;
    };
    const a = run();
    expect(a.length).toBeGreaterThan(10);
    expect(run()).toEqual(a);
  });

  it('debug jumps: startWave from any wave phase, completeWave, skipTimer', () => {
    const h = harness();
    expect(h.waves.startWave(3)).toBe(false); // not in a run
    h.startRun();
    expect(h.waves.startWave(5)).toBe(true); // from WAVE_START
    expect(h.waves.wave).toBe(5);
    expect(h.waves.skipTimer()).toBe(true);
    h.step();
    expect(h.state.current).toBe('WAVE_ACTIVE');
    h.until(() => h.waveEnemies().length > 0);
    expect(h.waves.startWave(7)).toBe(true); // from WAVE_ACTIVE: its enemies removed, no stats
    expect(h.state.current).toBe('WAVE_START');
    expect(h.waves.wave).toBe(7);
    expect(h.waves.stats.wavesCleared).toBe(0);
    expect(h.waveEnemies()).toEqual([]);
    h.waves.skipTimer();
    h.step();
    h.until(() => h.waveEnemies().length > 0);
    expect(h.waves.completeWave()).toBeGreaterThan(0);
    h.step();
    expect(h.state.current).toBe('WAVE_COMPLETE');
    expect(h.waves.stats.wavesCleared).toBe(1);
  });
});
