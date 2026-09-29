/**
 * Enemy hooks for mutations (D-045): HUNGER's speed and acceleration multipliers with the speed
 * cap (never above 90 % of the player's sprint unless already faster, never stacked on haste,
 * never on a leap), and alarms raised by kind: a DEATH CRY hastens and alerts nearby enemies,
 * takes the larger haste rather than stacking, and never asks for reinforcements.
 */

import { describe, expect, it } from 'vitest';
import { ENEMY_STATS } from '../config/enemies';
import { PLAYER_MOVEMENT } from '../config/player';
import { DT, enemyTestWorld, TestTarget } from './testWorld';

const CAP = PLAYER_MOVEMENT.walkSpeed * PLAYER_MOVEMENT.sprintMultiplier * 0.9;
const hunger = (mult = 1.2) => ({ multiplier: () => mult });

describe('HUNGER: faster zombies, within the cap', () => {
  it('the cap is 90 % of the player’s sprint (6.75 m/s)', () => {
    expect(enemyTestWorld().manager.effectSpeedCap).toBeCloseTo(CAP);
    expect(CAP).toBeCloseTo(6.75);
  });

  it('Walker, Runner and Tank cruise 20 % faster; an Elite Runner stops at the cap', () => {
    const t = enemyTestWorld({ targets: [new TestTarget(0, 60)], modifiers: hunger() });
    const walker = t.manager.spawn('walker', [0, 0, 0]);
    const runner = t.manager.spawn('runner', [3, 0, 0]);
    const tank = t.manager.spawn('tank', [-3, 0, 0]);
    const elite = t.manager.spawn('runner', [6, 0, 0], { traits: ['elite'] });
    t.step();
    expect(walker?.cruiseSpeed(0)).toBeCloseTo(ENEMY_STATS.walker.moveSpeed * 1.2);
    expect(runner?.cruiseSpeed(0)).toBeCloseTo(ENEMY_STATS.runner.moveSpeed * 1.2);
    expect(runner?.cruiseSpeed(0)).toBeLessThan(CAP);
    expect(tank?.cruiseSpeed(0)).toBeCloseTo(ENEMY_STATS.tank.moveSpeed * 1.2);
    expect(elite?.cruiseSpeed(0)).toBeCloseTo(CAP);
    expect(elite?.cruiseSpeed(0)).toBeGreaterThan(ENEMY_STATS.runner.moveSpeed * 1.1);
  });

  it('a hastened enemy already faster than the cap gains nothing more from it', () => {
    const t = enemyTestWorld({ targets: [new TestTarget(0, 60)], modifiers: hunger() });
    const runner = t.manager.spawn('runner', [0, 0, 0]);
    t.step();
    if (!runner) {
      throw new Error('spawn');
    }
    runner.hasteMultiplier = 1.35;
    runner.hasteUntil = 100;
    const hasted = ENEMY_STATS.runner.moveSpeed * 1.35; // 7.02, already above the cap
    expect(runner.cruiseSpeed(0)).toBeCloseTo(hasted);
  });

  it('its top speed and acceleration really change while running; the leap does not', () => {
    const plain = enemyTestWorld({ targets: [new TestTarget(0, 60)] });
    const hungry = enemyTestWorld({ targets: [new TestTarget(0, 60)], modifiers: hunger() });
    const top = (t: ReturnType<typeof enemyTestWorld>) => {
      const target = t.targets[0];
      const w = t.manager.spawn('walker', [0, 0, 0], {
        patrol: false,
        ...(target ? { alertTo: target } : {}),
      });
      let best = 0;
      for (let i = 0; i < 180; i++) {
        t.step();
        const v = w?.motor.velocity;
        best = Math.max(best, v ? Math.hypot(v.x, v.z) : 0);
      }
      return best;
    };
    expect(top(hungry) / top(plain)).toBeCloseTo(1.2, 1);
    // A leap sets its own scale: the multiplier does not touch it.
    const t = enemyTestWorld({ modifiers: hunger() });
    const runner = t.manager.spawn('runner', [0, 0, 0]);
    t.step();
    if (!runner) {
      throw new Error('spawn');
    }
    runner.speedScale = 9 / ENEMY_STATS.runner.moveSpeed;
    runner.accelerationScale = 20;
    runner.applySpeed(0);
    expect(runner.walkSpeed).toBeCloseTo(9);
    runner.speedScale = 1;
    runner.accelerationScale = 1;
    runner.applySpeed(0);
    expect(runner.walkSpeed).toBeCloseTo(ENEMY_STATS.runner.moveSpeed * 1.2);
  });

  it('without the mutation nothing changes (multiplier 1)', () => {
    const t = enemyTestWorld({ targets: [new TestTarget(0, 60)] });
    const walker = t.manager.spawn('walker', [0, 0, 0]);
    t.step();
    expect(walker?.speedMultiplier).toBe(1);
    expect(walker?.cruiseSpeed(0)).toBeCloseTo(ENEMY_STATS.walker.moveSpeed);
  });
});

describe('alarms by kind (D-045)', () => {
  it('a DEATH CRY alerts and hastens enemies within reach only, and asks for no reinforcements', () => {
    const t = enemyTestWorld({ targets: [new TestTarget(0, 40)] });
    const near = t.manager.spawn('walker', [5, 0, 0], { patrol: false });
    const far = t.manager.spawn('walker', [20, 0, 0], { patrol: false });
    t.step();
    const alarm = t.manager.raiseAlarm({
      sourceId: 'walker-x',
      kind: 'deathCry',
      reinforcements: false,
      position: [0, 0, 0],
      radius: 8,
      alertDuration: 6,
      haste: { multiplier: 1.2, duration: 2.5 },
    });
    expect(alarm).toMatchObject({
      kind: 'deathCry',
      reinforcements: false,
      targetId: 'player',
      time: t.manager.now,
    });
    expect(t.of('alarm')).toEqual([alarm]);
    expect(near?.haste(t.manager.now)).toBeCloseTo(1.2);
    expect(near?.target?.id).toBe('player');
    expect(far?.haste(t.manager.now)).toBe(1);
    expect(far?.target).toBeNull();
    t.step(Math.round(2.6 / DT));
    expect(near?.haste(t.manager.now)).toBe(1);
  });

  it('haste takes the larger boost; a death cry never stacks on a Screamer’s scream', () => {
    const t = enemyTestWorld({ targets: [new TestTarget(0, 40)] });
    const walker = t.manager.spawn('walker', [2, 0, 0], { patrol: false });
    t.step();
    const at = [0, 0, 0] as const;
    t.manager.raiseAlarm({
      sourceId: 'screamer-1',
      kind: 'scream',
      reinforcements: true,
      position: at,
      radius: 18,
      alertDuration: 8,
      haste: { multiplier: 1.35, duration: 6 },
    });
    t.manager.raiseAlarm({
      sourceId: 'walker-9',
      kind: 'deathCry',
      reinforcements: false,
      position: at,
      radius: 8,
      alertDuration: 6,
      haste: { multiplier: 1.2, duration: 2.5 },
    });
    expect(walker?.haste(t.manager.now)).toBeCloseTo(1.35);
  });
});
