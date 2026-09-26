import { describe, expect, it } from 'vitest';
import { PLAYER_HEALTH } from '../config/player';
import { PlayerHealth, type PlayerHealthEvents } from './PlayerHealth';

type Recorded = {
  [K in keyof PlayerHealthEvents]: { type: K; payload: PlayerHealthEvents[K] };
}[keyof PlayerHealthEvents];

function setup(options: { max?: number; vulnerable?: () => boolean } = {}) {
  const health = new PlayerHealth({
    ...(options.max ? { config: { max: options.max } } : {}),
    ...(options.vulnerable ? { canBeDamaged: options.vulnerable } : {}),
  });
  const events: Recorded[] = [];
  for (const type of ['damaged', 'died', 'healed', 'reset'] as const) {
    health.events.on(type, (payload: unknown) => {
      events.push({ type, payload } as Recorded);
    });
  }
  return { health, events };
}

const enemy = { kind: 'enemy', id: 'walker-1', archetype: 'walker' } as const;

describe('PlayerHealth', () => {
  it('starts at the configured maximum (100)', () => {
    const { health } = setup();
    expect(health.max).toBe(PLAYER_HEALTH.max);
    expect(health.current).toBe(100);
    expect(setup({ max: 150 }).health.current).toBe(150);
  });

  it('takes damage and reports it, with its source and direction', () => {
    const { health, events } = setup();
    expect(health.damage({ amount: 15, source: enemy, direction: [0, 0, 1] })).toBe(15);
    expect(health.current).toBe(85);
    expect(events).toEqual([
      {
        type: 'damaged',
        payload: {
          amount: 15,
          health: 85,
          max: 100,
          source: enemy,
          direction: [0, 0, 1],
          killed: false,
        },
      },
    ]);
  });

  it('dies once, reports the killing blow, then ignores damage', () => {
    const { health, events } = setup();
    health.damage({ amount: 90, source: enemy });
    expect(health.damage({ amount: 30, source: enemy })).toBe(10);
    expect(health.isDead).toBe(true);
    expect(health.vulnerable).toBe(false);
    expect(health.damage({ amount: 30, source: enemy })).toBe(0);
    expect(events.map((e) => e.type)).toEqual(['damaged', 'damaged', 'died']);
    expect(events[1]?.payload).toMatchObject({ amount: 10, health: 0, killed: true });
  });

  it('ignores damage while it cannot be hurt (D-029: outside WAVE_ACTIVE and BOSS)', () => {
    let open = false;
    const { health, events } = setup({ vulnerable: () => open });
    expect(health.vulnerable).toBe(false);
    expect(health.damage({ amount: 50, source: enemy })).toBe(0);
    expect(events).toEqual([]);
    open = true;
    expect(health.damage({ amount: 50, source: enemy })).toBe(50);
  });

  it('god mode ignores damage', () => {
    const { health } = setup();
    health.godMode = true;
    expect(health.damage({ amount: 500, source: { kind: 'debug' } })).toBe(0);
    expect(health.current).toBe(100);
  });

  it('bad amounts change nothing', () => {
    const { health, events } = setup();
    for (const amount of [0, -5, Number.NaN]) {
      expect(health.damage({ amount, source: enemy })).toBe(0);
    }
    expect(events).toEqual([]);
  });

  it('heals up to the maximum, never while dead', () => {
    const { health, events } = setup();
    health.damage({ amount: 30, source: enemy });
    expect(health.heal(50)).toBe(30);
    expect(events.at(-1)).toEqual({
      type: 'healed',
      payload: { amount: 30, health: 100, max: 100 },
    });
    health.damage({ amount: 200, source: enemy });
    expect(health.heal(50)).toBe(0);
  });

  it('reset brings a dead player back at full health (a new run)', () => {
    const { health, events } = setup();
    health.damage({ amount: 200, source: enemy });
    health.reset();
    expect(health.isDead).toBe(false);
    expect(health.current).toBe(100);
    expect(events.at(-1)).toEqual({ type: 'reset', payload: { health: 100, max: 100 } });
    // Can die again, and "died" fires again for the new life.
    health.damage({ amount: 200, source: enemy });
    expect(events.filter((e) => e.type === 'died')).toHaveLength(2);
  });
});
