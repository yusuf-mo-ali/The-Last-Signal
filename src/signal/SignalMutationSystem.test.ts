/**
 * The Signal Mutation lifecycle headless (D-045): the real state machine, the facility, enemies,
 * spawn director, wave runtime and modifier runtime, wired as `main.ts` wires them. Each mutation
 * is announced at the wave's start, takes hold when it goes active and is removed when it ends,
 * however it ends, without leaving anything behind; its effects are the ones its data describes.
 */

import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { MutationId } from '../config/mutations';
import { GameStateMachine } from '../core/GameState';
import { DT, enemyTestWorld, TestTarget } from '../enemies/testWorld';
import { EffectRouter } from '../modifiers/EffectRouter';
import { ScreenEffects } from '../modifiers/ScreenEffects';
import { StatRegistry } from '../modifiers/StatRegistry';
import { TriggerRegistry } from '../modifiers/TriggerRegistry';
import { Rng } from '../utils/Rng';
import { SpawnDirector } from '../waves/SpawnDirector';
import { WaveManager } from '../waves/WaveManager';
import { mutationSchedule } from '../waves/WaveMutation';
import { Environment } from '../world/Environment';
import { FACILITY } from '../world/levels/facility';
import { World } from '../world/World';
import type { MutationEvents } from './events';
import { SignalMutationSystem } from './SignalMutationSystem';

const facility = new World(FACILITY);
const steps = (seconds: number) => Math.round(seconds / DT);

type Recorded = {
  [K in keyof MutationEvents]: { type: K; payload: MutationEvents[K] };
}[keyof MutationEvents];

function harness(seed = 'mutations') {
  const target = new TestTarget(0, 14);
  target.health = 1e9;
  const stats = new StatRegistry(['enemy.moveSpeed', 'enemy.acceleration']);
  const t = enemyTestWorld({
    targets: [target],
    world: facility.collision,
    level: FACILITY,
    modifiers: stats,
  });
  const state = new GameStateMachine({ strict: true });
  const spawns = new SpawnDirector({
    points: FACILITY.spawnPoints ?? [],
    canStand: (a, at) => t.manager.canStand(a, at),
    lineOfSight: (from, to) => t.manager.lines.lineOfSight(from, to),
    walkable: (from, to, r) => t.manager.lines.walkable(from, to, r),
    rng: new Rng('unused'),
  });
  const view = { eye: new Vector3(0, 1.62, 14), yaw: 0, fovDeg: 100 };
  const waves = new WaveManager({
    state,
    enemies: t.manager,
    spawns,
    target: () => target,
    viewer: () => view,
    seed,
    combat: t.combat.events,
  });
  const triggers = new TriggerRegistry();
  const environment = new Environment();
  const screen = new ScreenEffects();
  const router = new EffectRouter({ stats, triggers, environment, screen });
  const mutations = new SignalMutationSystem({
    state,
    waves,
    enemies: t.manager,
    router,
    triggers,
    screen,
  });
  waves.attach();
  mutations.attach();
  const log: Recorded[] = [];
  for (const type of [
    'mutationAnnounced',
    'mutationApplied',
    'mutationReverted',
    'staticBurst',
  ] as const) {
    mutations.events.on(type, (payload: unknown) => {
      log.push({ type, payload } as Recorded);
    });
  }
  const of = <K extends keyof MutationEvents>(type: K): MutationEvents[K][] =>
    log.flatMap((e) => (e.type === type ? [e.payload as MutationEvents[K]] : []));
  const step = (n = 1) => {
    for (let i = 0; i < n; i++) {
      if (state.isIn('PLAYING')) {
        waves.fixedUpdate(DT);
        t.step();
      }
      environment.fixedUpdate(DT);
      screen.fixedUpdate(DT);
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
  const clearWave = (maxSeconds = 400) =>
    until(() => {
      killWave();
      return state.current !== 'WAVE_ACTIVE';
    }, maxSeconds);
  const startRun = () => {
    state.transition('MAIN_MENU');
    state.transition('LOADING');
    state.transition('PLAYING');
  };
  /** A run whose current wave is `n`, carrying `mutation`, in its intro. */
  const forced = (n: number, mutation: MutationId) => {
    startRun();
    expect(waves.startWave(n, mutation)).toBe(true);
  };
  const toActive = () => until(() => state.current === 'WAVE_ACTIVE');
  const leftovers = () => router.sources();
  return {
    t,
    target,
    state,
    waves,
    stats,
    triggers,
    environment,
    screen,
    router,
    mutations,
    log,
    of,
    step,
    until,
    waveEnemies,
    killWave,
    clearWave,
    startRun,
    forced,
    toActive,
    leftovers,
  };
}

const NONE = { stats: [], triggers: [], environment: [], screen: [] };

describe('SignalMutationSystem: the lifecycle', () => {
  it('announced in the intro (lighting only), applied when active, lifted on the clear', () => {
    const h = harness();
    h.forced(8, 'BLACKOUT');
    expect(h.of('mutationAnnounced')).toEqual([
      expect.objectContaining({ wave: 8, id: 'BLACKOUT', name: 'Blackout' }),
    ]);
    expect(h.mutations.status).toMatchObject({ id: 'BLACKOUT', phase: 'announced' });
    expect(h.leftovers()).toEqual({ ...NONE, environment: ['mutation:BLACKOUT'] });
    // The lights fail during the intro.
    h.toActive();
    expect(h.environment.resolve().ambient).toBeLessThan(0.35);
    expect(h.of('mutationApplied')).toEqual([{ wave: 8, id: 'BLACKOUT' }]);
    h.clearWave();
    expect(h.state.current).toBe('WAVE_COMPLETE');
    expect(h.of('mutationReverted')).toEqual([{ wave: 8, id: 'BLACKOUT', reason: 'cleared' }]);
    expect(h.mutations.status.phase).toBe('lifted');
    // The light comes back during the breather.
    h.step(steps(2.1));
    expect(h.environment.resolve().ambient).toBe(1);
    expect(h.leftovers()).toEqual(NONE);
  });

  it('HUNGER: enemies are faster only while the wave is active', () => {
    const h = harness();
    h.forced(6, 'HUNGER');
    expect(h.stats.multiplier('enemy.moveSpeed')).toBe(1); // not during the intro
    h.toActive();
    expect(h.stats.multiplier('enemy.moveSpeed')).toBeCloseTo(1.2);
    h.until(() => h.waveEnemies().length > 0);
    h.step();
    expect(h.waveEnemies()[0]?.speedMultiplier).toBeCloseTo(1.2);
    h.clearWave();
    expect(h.stats.multiplier('enemy.moveSpeed')).toBe(1);
    expect(h.leftovers().stats).toEqual([]);
  });

  it('DEATH CRY: a kill hastens the enemies around it, calls no reinforcements, and stops with the wave', () => {
    const h = harness();
    h.forced(9, 'SCREAM');
    h.toActive();
    h.until(() => h.waveEnemies().length >= 2, 30);
    const [victim, other] = h.waveEnemies();
    if (!victim || !other) {
      throw new Error('two wave enemies');
    }
    // Put the other right next to the victim, then kill the victim.
    other.motor.teleport(victim.motor.position.clone().add(new Vector3(1.5, 0, 0)));
    const alarms: string[] = [];
    h.t.manager.events.on('alarm', (a) => alarms.push(`${a.kind}:${a.reinforcements}`));
    let pulled = 0;
    h.waves.events.on('reinforcementsPulled', () => pulled++);
    h.t.manager.kill(victim.id);
    expect(alarms).toEqual(['deathCry:false']);
    expect(other.haste(h.t.manager.now)).toBeCloseTo(1.2);
    h.step(2);
    expect(pulled).toBe(0);
    h.clearWave();
    const before = alarms.length;
    // After the wave: no trigger remains, so a kill raises nothing.
    const stray = h.t.manager.spawn('walker', [0, 0, 0]);
    h.t.manager.kill(stray?.id ?? '');
    expect(alarms).toHaveLength(before);
    expect(h.leftovers().triggers).toEqual([]);
  });

  it('STATIC: seeded bursts only while the wave is active, none in the intro', () => {
    const h = harness();
    h.forced(10, 'STATIC');
    h.step(steps(2.9));
    expect(h.of('staticBurst')).toHaveLength(0);
    h.toActive();
    h.until(() => h.of('staticBurst').length >= 3, 60);
    const bursts = h.of('staticBurst');
    expect(bursts.length).toBeGreaterThanOrEqual(3);
    for (const b of bursts) {
      expect(b.until - b.start).toBeLessThanOrEqual(0.8);
      expect(b.intensity).toBeLessThanOrEqual(0.35);
    }
    h.clearWave();
    const count = h.of('staticBurst').length;
    h.step(steps(20));
    expect(h.of('staticBurst')).toHaveLength(count);
    expect(h.leftovers().screen).toEqual([]);
  });

  it('HIVE: two announced surges arrive from their region, never above the wave’s cap', () => {
    const h = harness();
    h.forced(12, 'HIVE');
    const def = h.waves.definition;
    expect(def?.surges).toHaveLength(2);
    const warnings: { region: string; at: number }[] = [];
    const arrivals: { region: string; count: number; at: number }[] = [];
    h.waves.events.on('surgeWarning', (e) =>
      warnings.push({ region: e.region, at: h.waves.status.activeTime }),
    );
    h.waves.events.on('surgeSpawned', (e) =>
      arrivals.push({ region: e.region, count: e.count, at: h.waves.status.activeTime }),
    );
    h.toActive();
    let peak = 0;
    h.until(() => {
      peak = Math.max(peak, h.waveEnemies().length);
      // Thin the wave now and then so it flows.
      if (h.waveEnemies().length >= (def?.maxAlive ?? 0)) {
        const first = h.waveEnemies()[0];
        if (first) {
          h.t.manager.kill(first.id);
        }
      }
      return h.state.current !== 'WAVE_ACTIVE';
    }, 600);
    expect(peak).toBeLessThanOrEqual(def?.maxAlive ?? 0);
    expect(warnings).toHaveLength(2);
    expect(arrivals).toHaveLength(2);
    arrivals.forEach((a, i) => {
      const w = warnings[i];
      expect(a.at - (w?.at ?? 0)).toBeGreaterThanOrEqual(2 - 1e-6);
      expect(a.region).toBe(w?.region);
      expect(a.count).toBeGreaterThan(0);
    });
  });

  it('BLOOD MOON: Elites in the wave, a red sky that lifts after it', () => {
    const h = harness();
    h.forced(10, 'BLOOD_MOON');
    const elites = h.waves.definition?.spawns.filter((s) => s.traits.includes('elite')) ?? [];
    expect(elites.length).toBeGreaterThanOrEqual(1);
    h.toActive();
    expect(h.environment.resolve().tintAmount).toBeGreaterThan(0.3);
    h.clearWave();
    h.step(steps(2.1));
    expect(h.environment.resolve().tintAmount).toBe(0);
  });
});

describe('SignalMutationSystem: every way a wave ends leaves nothing behind', () => {
  it('death: effects removed, the lighting stays as it was; a new run resets it', () => {
    const h = harness();
    h.forced(8, 'BLACKOUT');
    h.toActive();
    h.state.transition('GAME_OVER');
    expect(h.of('mutationReverted').at(-1)).toMatchObject({ reason: 'died' });
    expect(h.leftovers()).toEqual({ ...NONE, environment: ['mutation:BLACKOUT'] });
    h.state.transition('LOADING');
    h.state.transition('PLAYING');
    expect(h.leftovers()).toEqual(NONE);
    expect(h.environment.resolve().ambient).toBe(1);
  });

  it('every v1 mutation: nothing left after the clear, after death, and after a new run', () => {
    for (const id of ['BLACKOUT', 'HUNGER', 'STATIC', 'SCREAM', 'HIVE', 'BLOOD_MOON'] as const) {
      const h = harness(`leak-${id}`);
      h.forced(12, id);
      h.toActive();
      h.step(steps(5));
      h.clearWave();
      h.step(steps(2.5));
      expect(h.leftovers(), `${id} clear`).toEqual(NONE);
      h.until(() => h.state.current === 'WAVE_ACTIVE', 20);
      h.state.transition('GAME_OVER');
      h.state.transition('LOADING');
      h.state.transition('PLAYING');
      expect(h.leftovers(), `${id} new run`).toEqual(NONE);
    }
  });

  it('a debug jump or a forced mutation in the intro replaces the mutation cleanly', () => {
    const h = harness();
    h.forced(8, 'BLACKOUT');
    expect(h.waves.forceMutation('HUNGER')).toBe(true); // still the intro: regenerated
    expect(h.waves.definition?.mutation).toBe('HUNGER');
    expect(h.of('mutationAnnounced').map((e) => e.id)).toEqual(['BLACKOUT', 'HUNGER']);
    expect(h.leftovers().environment).toEqual([]);
    h.toActive();
    expect(h.waves.startWave(14, 'STATIC')).toBe(true); // from WAVE_ACTIVE: a skip
    h.until(() => h.state.current === 'WAVE_START', 5);
    expect(h.waves.wave).toBe(14);
    expect(h.leftovers().stats).toEqual([]);
    expect(h.waves.mutations.map((m) => m.id)).toEqual(['HUNGER', 'STATIC']);
  });

  it('deferred mutations are refused; mutations can be switched off', () => {
    const h = harness();
    h.startRun();
    expect(h.waves.startWave(8, 'OVERLOAD')).toBe(false);
    expect(h.waves.forceMutation('LOW_GRAVITY')).toBe(false);
    h.waves.mutationsEnabled = false;
    h.waves.startWave(8);
    expect(h.waves.definition?.mutation).toBeNull();
    expect(h.mutations.status.phase).toBe('none');
  });
});

describe('SignalMutationSystem: the run’s mutations', () => {
  it('a run played straight through meets exactly the scheduled mutations, recorded in its stats', () => {
    const h = harness('schedule');
    h.startRun();
    const seed = h.waves.seed;
    for (let wave = 1; wave <= 9; wave++) {
      h.toActive();
      h.clearWave();
      h.until(() => h.state.current === 'WAVE_START', 15);
    }
    const expected = mutationSchedule(seed, 9);
    const played = h.waves.mutations;
    for (let n = 1; n <= 9; n++) {
      expect(played.find((m) => m.wave === n)?.id ?? null, `wave ${n}`).toBe(expected[n]);
    }
    const recorded = h.waves.stats.snapshot().mutations;
    expect(recorded.filter((m) => m.wave <= 3).every((m) => m.id === null)).toBe(true);
    expect(recorded.filter((m) => m.wave >= 4 && m.wave <= 9).every((m) => m.id !== null)).toBe(
      true,
    );
  });
});
