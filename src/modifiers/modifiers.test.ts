/**
 * The modifier runtime (D-009, D-045): sourced stats, data-declared triggers, the seeded screen
 * schedule, and the router that applies effects atomically and removes them exactly by source.
 */

import { describe, expect, it } from 'vitest';
import type { Effect } from '../config/effects';
import { MUTATIONS } from '../config/mutations';
import { Rng } from '../utils/Rng';
import { Environment } from '../world/Environment';
import { EffectRejectedError, EffectRouter } from './EffectRouter';
import { clampStaticParams, ScreenEffects } from './ScreenEffects';
import { StatRegistry, UnregisteredStatError } from './StatRegistry';
import { TriggerRegistry, UnregisteredActionError } from './TriggerRegistry';

const DT = 1 / 60;
const PHASE7_STATS = ['enemy.moveSpeed', 'enemy.acceleration'] as const;

describe('StatRegistry', () => {
  it('(base + Σ add) × Π mul; the latest override wins; removal is exact by source', () => {
    const stats = new StatRegistry(PHASE7_STATS);
    expect(stats.value('enemy.moveSpeed', 2)).toBe(2);
    stats.add('a', 'enemy.moveSpeed', 'mul', 1.5);
    stats.add('b', 'enemy.moveSpeed', 'add', 1);
    stats.add('b', 'enemy.moveSpeed', 'mul', 2);
    expect(stats.value('enemy.moveSpeed', 2)).toBeCloseTo((2 + 1) * 1.5 * 2);
    expect(stats.multiplier('enemy.moveSpeed')).toBeCloseTo(3);
    stats.add('c', 'enemy.moveSpeed', 'override', 7);
    stats.add('d', 'enemy.moveSpeed', 'override', 9);
    expect(stats.value('enemy.moveSpeed', 2)).toBe(9);
    expect(stats.removeSource('d')).toBe(1);
    expect(stats.value('enemy.moveSpeed', 2)).toBe(7);
    stats.removeSource('c');
    expect(stats.removeSource('b')).toBe(2);
    expect(stats.value('enemy.moveSpeed', 2)).toBeCloseTo(3);
    expect(stats.value('enemy.acceleration', 5)).toBe(5); // other stats untouched
    stats.removeSource('a');
    expect(stats.value('enemy.moveSpeed', 2)).toBe(2);
    expect(stats.sources()).toEqual([]);
  });

  it('refuses stats it does not know (deferred content) and non-finite values', () => {
    const stats = new StatRegistry(PHASE7_STATS);
    expect(() => stats.add('mutation:LOW_GRAVITY', 'world.gravity', 'mul', 0.5)).toThrow(
      UnregisteredStatError,
    );
    expect(() => stats.add('x', 'enemy.moveSpeed', 'mul', Number.NaN)).toThrow(RangeError);
    const lenient = new StatRegistry(PHASE7_STATS, { strict: false });
    expect(lenient.add('x', 'weapon.recoil', 'mul', 2)).toBe(false);
    expect(lenient.sources()).toEqual([]);
  });

  it('version changes with every change (consumers can cache)', () => {
    const stats = new StatRegistry(PHASE7_STATS);
    const v0 = stats.version;
    stats.add('a', 'enemy.moveSpeed', 'mul', 1.2);
    const v1 = stats.version;
    expect(v1).toBeGreaterThan(v0);
    stats.removeSource('missing');
    expect(stats.version).toBe(v1);
    stats.removeSourcesWithPrefix('a');
    expect(stats.version).toBeGreaterThan(v1);
  });
});

describe('TriggerRegistry', () => {
  it('runs registered actions for the events they listen to, with their params; removal by source', () => {
    const triggers = new TriggerRegistry();
    const calls: string[] = [];
    triggers.registerAction('deathCry', (event, payload, params) => {
      calls.push(`${event} ${'id' in payload ? payload.id : ''} r${params.radius}`);
    });
    expect(triggers.add('mutation:SCREAM', 'enemy:died', 'deathCry', { radius: 8 })).toBe(true);
    triggers.dispatch('enemy:died', { id: 'walker-1', position: [0, 0, 0] });
    triggers.dispatch('weapon:shot', { weaponId: 'pistol' });
    expect(calls).toEqual(['enemy:died walker-1 r8']);
    expect(triggers.fired.get('deathCry')).toBe(1);
    expect(triggers.removeSource('mutation:SCREAM')).toBe(1);
    triggers.dispatch('enemy:died', { id: 'walker-2', position: [0, 0, 0] });
    expect(calls).toHaveLength(1);
  });

  it('refuses actions nobody registered (OVERLOAD’s environment pulse)', () => {
    const triggers = new TriggerRegistry();
    expect(() => triggers.add('mutation:OVERLOAD', 'weapon:shot', 'environmentPulse')).toThrow(
      UnregisteredActionError,
    );
    expect(new TriggerRegistry({ strict: false }).add('x', 'weapon:shot', 'environmentPulse')).toBe(
      false,
    );
  });
});

describe('ScreenEffects (STATIC schedule)', () => {
  const params = {
    intervalMin: 6,
    intervalMax: 10,
    durationMin: 0.4,
    durationMax: 0.7,
    opacity: 0.32,
    firstAfter: 4,
  };

  function run(seed: string, seconds: number) {
    const screen = new ScreenEffects();
    const bursts: { start: number; until: number }[] = [];
    screen.onBurst((b) => bursts.push({ start: b.start, until: b.until }));
    screen.startStatic('s', params, new Rng(seed));
    for (let i = 0; i < Math.round(seconds / DT); i++) {
      screen.fixedUpdate(DT);
    }
    return { screen, bursts };
  }

  it('bursts within the rules: none early, the right length, never too close together', () => {
    const { bursts } = run('static', 120);
    expect(bursts.length).toBeGreaterThan(8);
    expect(bursts[0]?.start).toBeGreaterThanOrEqual(params.firstAfter - DT);
    for (const [i, b] of bursts.entries()) {
      const length = b.until - b.start;
      expect(length).toBeGreaterThanOrEqual(params.durationMin - 1e-9);
      expect(length).toBeLessThanOrEqual(params.durationMax + 1e-9);
      const prev = bursts[i - 1];
      if (prev) {
        expect(b.start - prev.until).toBeGreaterThanOrEqual(params.intervalMin - DT);
      }
    }
  });

  it('is deterministic for a seed; a burst shows only while it lasts; stop ends it', () => {
    expect(run('a', 60).bursts).toEqual(run('a', 60).bursts);
    expect(run('a', 60).bursts).not.toEqual(run('b', 60).bursts);
    const screen = new ScreenEffects();
    screen.startStatic('s', params, new Rng('x'));
    const burst = screen.force('s');
    expect(screen.burst).toEqual(burst);
    for (let i = 0; i < 60; i++) {
      screen.fixedUpdate(DT);
    }
    expect(screen.burst).toBeNull();
    screen.stop('s');
    expect(screen.nextIn).toBeNull();
    expect(screen.force('s')).toBeNull();
  });

  it('clamps whatever the data asks for (opacity, length, spacing, quiet start)', () => {
    const p = clampStaticParams({
      intervalMin: 0.1,
      intervalMax: 0.2,
      durationMin: 5,
      durationMax: 9,
      opacity: 1,
      firstAfter: 0,
    });
    expect(p.opacity).toBe(0.35);
    expect(p.durationMax).toBe(0.8);
    expect(p.durationMin).toBeLessThanOrEqual(p.durationMax);
    expect(p.intervalMin).toBe(5);
    expect(p.intervalMax).toBeGreaterThanOrEqual(p.intervalMin);
    expect(p.firstAfter).toBe(2);
    expect(p.glitch).toBeUndefined();
  });

  it('clamps the glitch: small shifts, slight lag, a tear pattern at most 3 times a second', () => {
    const p = clampStaticParams({
      ...MUTATIONS_STATIC_PARAMS(),
      glitch: { tearBands: 40, maxShift: 0.5, chroma: 0.1, ghost: 1, desync: 2, stepRate: 30 },
    });
    expect(p.glitch).toEqual({
      tearBands: 6,
      maxShift: 0.04,
      chroma: 0.006,
      ghost: 0.5,
      desync: 0.25,
      stepRate: 3,
    });
  });

  it('a burst carries its glitch params for the presentation', () => {
    const screen = new ScreenEffects();
    screen.startStatic('s', MUTATIONS_STATIC_PARAMS(), new Rng('glitch'));
    const burst = screen.force('s');
    expect(burst?.glitch?.stepRate).toBeLessThanOrEqual(3);
    expect(burst?.glitch?.desync).toBeGreaterThan(0);
  });
});

function MUTATIONS_STATIC_PARAMS() {
  const e = MUTATIONS.STATIC.effects.find((x) => x.kind === 'screen');
  if (!e) {
    throw new Error('STATIC has no screen effect');
  }
  return e.params;
}

function router() {
  const stats = new StatRegistry(PHASE7_STATS);
  const triggers = new TriggerRegistry();
  const environment = new Environment();
  const screen = new ScreenEffects();
  const cries: number[] = [];
  const params: Record<string, number>[] = [];
  triggers.registerAction('deathCry', (_e, _p, p) => {
    cries.push(p.radius ?? 0);
    params.push({ ...p });
  });
  return {
    stats,
    triggers,
    environment,
    screen,
    cries,
    params,
    router: new EffectRouter({ stats, triggers, environment, screen }),
  };
}

describe('EffectRouter', () => {
  it('applies every v1 mutation and removes it without a trace', () => {
    const t = router();
    for (const id of ['BLACKOUT', 'HUNGER', 'STATIC', 'SCREAM', 'HIVE', 'BLOOD_MOON'] as const) {
      const source = `mutation:${id}`;
      t.router.apply(source, MUTATIONS[id].effects, { rng: new Rng(id) });
      t.router.remove(source, { immediate: true });
    }
    expect(t.router.sources()).toEqual({ stats: [], triggers: [], environment: [], screen: [] });
  });

  it('routes each kind: HUNGER to stats, SCREAM to triggers, BLACKOUT to the environment, STATIC to the screen', () => {
    const t = router();
    t.router.apply('mutation:HUNGER', MUTATIONS.HUNGER.effects);
    expect(t.stats.multiplier('enemy.moveSpeed')).toBeCloseTo(
      MUTATIONS.HUNGER.effects[0]?.kind === 'stat' ? MUTATIONS.HUNGER.effects[0].value : 0,
    );
    expect(t.stats.multiplier('enemy.acceleration')).toBeCloseTo(1.15);
    t.router.apply('mutation:SCREAM', MUTATIONS.SCREAM.effects);
    t.triggers.dispatch('enemy:died', { id: 'w', position: [0, 0, 0] });
    expect(t.cries).toEqual([9]);
    t.router.apply('mutation:BLACKOUT', MUTATIONS.BLACKOUT.effects);
    expect(t.environment.sources()).toEqual(['mutation:BLACKOUT']);
    t.router.apply('mutation:STATIC', MUTATIONS.STATIC.effects, { rng: new Rng('s') });
    expect(t.screen.sources()).toEqual(['mutation:STATIC']);
    // spawnRule effects are for the generator: nothing runs.
    t.router.apply('mutation:HIVE', MUTATIONS.HIVE.effects);
    t.router.removeAllWithPrefix('mutation:', { immediate: true });
    expect(t.router.sources()).toEqual({ stats: [], triggers: [], environment: [], screen: [] });
  });

  it('is all or nothing: a deferred mutation is refused before anything is applied', () => {
    const t = router();
    expect(() => {
      t.router.apply('mutation:OVERLOAD', MUTATIONS.OVERLOAD.effects);
    }).toThrow(EffectRejectedError);
    expect(() => {
      t.router.apply('mutation:LOW_GRAVITY', MUTATIONS.LOW_GRAVITY.effects);
    }).toThrow(EffectRejectedError);
    expect(t.router.sources()).toEqual({ stats: [], triggers: [], environment: [], screen: [] });
    expect(t.router.check(MUTATIONS.HUNGER.effects)).toEqual({ ok: true });
  });

  it('applies by kind (environment first, the rest later) and removes by kind', () => {
    const t = router();
    t.router.apply('mutation:BLOOD_MOON', MUTATIONS.BLOOD_MOON.effects, {
      kinds: ['environment'],
    });
    expect(t.environment.sources()).toEqual(['mutation:BLOOD_MOON']);
    t.router.apply('mutation:HUNGER', MUTATIONS.HUNGER.effects, { kinds: ['environment'] });
    expect(t.stats.sources()).toEqual([]); // HUNGER has no environment effect
    t.router.apply('mutation:HUNGER', MUTATIONS.HUNGER.effects, { kinds: ['stat'] });
    t.router.apply('mutation:HUNGER', MUTATIONS.HUNGER.effects, { kinds: ['stat'] }); // idempotent
    expect(t.stats.multiplier('enemy.moveSpeed')).toBeCloseTo(
      MUTATIONS.HUNGER.effects[0]?.kind === 'stat' ? MUTATIONS.HUNGER.effects[0].value : 0,
    );
    t.router.remove('mutation:HUNGER', { kinds: ['stat'] });
    expect(t.stats.sources()).toEqual([]);
  });

  it('clamps values past the guardrails (a too-fast horde, an oversized death cry)', () => {
    const t = router();
    const wild: Effect[] = [
      { kind: 'stat', target: 'enemy.moveSpeed', op: 'mul', value: 3 },
      {
        kind: 'trigger',
        on: 'enemy:died',
        action: 'deathCry',
        params: {
          radius: 50,
          alertDuration: 60,
          hasteMultiplier: 4,
          hasteDuration: 30,
          frenzyDuration: 60,
          frenzyCooldownScale: 0.01,
          frenzyWindupScale: 0.01,
          frenzyTurnScale: 10,
          frenzyStaggerScale: 10,
        },
      },
    ];
    t.router.apply('debug:wild', wild);
    expect(t.stats.multiplier('enemy.moveSpeed')).toBe(1.25);
    t.triggers.dispatch('enemy:died', { id: 'w', position: [0, 0, 0] });
    expect(t.cries).toEqual([10]);
    expect(t.params[0]).toEqual({
      radius: 10,
      alertDuration: 8,
      hasteMultiplier: 1.25,
      hasteDuration: 3,
      frenzyDuration: 6,
      frenzyCooldownScale: 0.5,
      frenzyWindupScale: 0.7,
      frenzyTurnScale: 2,
      frenzyStaggerScale: 1.6,
    });
  });

  it('a screen effect needs its seeded stream', () => {
    const t = router();
    expect(() => {
      t.router.apply('mutation:STATIC', MUTATIONS.STATIC.effects);
    }).toThrow(EffectRejectedError);
  });
});
