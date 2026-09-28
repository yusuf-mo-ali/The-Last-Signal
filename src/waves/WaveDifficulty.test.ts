/**
 * The wave difficulty curves (D-044) against independently written values (BALANCING §2.14).
 */

import { describe, expect, it } from 'vitest';
import { FINAL_WAVE } from '../config/waves';
import {
  eliteMax,
  isUnlocked,
  traitChance,
  waveBudget,
  waveCap,
  waveGroupMax,
  waveMaxAlive,
  waveSpawnRate,
  waveTier,
} from './WaveDifficulty';

describe('wave difficulty: the run (waves 1–20)', () => {
  it('budget follows the table', () => {
    const expected = [6, 8, 11, 13, 16, 19, 22, 25, 29, 32, 36, 40, 44, 48, 52, 57, 62, 67, 72, 77];
    expect(expected.map((_, i) => waveBudget(i + 1))).toEqual(expected);
  });

  it('concurrency grows from 6 to the cap of 24', () => {
    expect([1, 5, 10, 18, 19, 20].map((n) => waveMaxAlive(n))).toEqual([6, 10, 15, 23, 24, 24]);
  });

  it('spawn rate grows gently', () => {
    expect(waveSpawnRate(1)).toBeCloseTo(0.55, 9);
    expect(waveSpawnRate(20)).toBeCloseTo(1.5, 9);
  });

  it('groups grow from singles to fours', () => {
    expect([1, 5, 6, 12, 18, 20, 40].map((n) => waveGroupMax(n))).toEqual([1, 1, 2, 3, 4, 4, 4]);
  });

  it('tiers follow the plan (§13)', () => {
    expect([1, 3, 4, 7, 8, 12, 13, 19, 20, 21].map(waveTier)).toEqual([
      'introduction',
      'introduction',
      'variety',
      'variety',
      'pressure',
      'pressure',
      'complex',
      'complex',
      'boss',
      'complex',
    ]);
  });

  it('archetypes unlock in order: Walker 1, Runner 3, Screamer 4, Tank 6', () => {
    expect(isUnlocked('walker', 1)).toBe(true);
    expect([isUnlocked('runner', 2), isUnlocked('runner', 3)]).toEqual([false, true]);
    expect([isUnlocked('screamer', 3), isUnlocked('screamer', 4)]).toEqual([false, true]);
    expect([isUnlocked('tank', 5), isUnlocked('tank', 6)]).toEqual([false, true]);
  });

  it('caps: Screamers and Tanks per wave; none before their unlock; Walkers uncapped', () => {
    expect([3, 4, 8, 9, 14, 19].map((n) => waveCap('screamer', n))).toEqual([0, 1, 1, 2, 3, 4]);
    expect([5, 6, 9, 10, 14, 18].map((n) => waveCap('tank', n))).toEqual([0, 1, 1, 2, 3, 4]);
    expect(waveCap('walker', 1)).toBe(Number.POSITIVE_INFINITY);
  });

  it('traits: Armored and Helmeted from wave 8, Elite from 13, with caps', () => {
    expect(traitChance('armored', 7)).toBe(0);
    expect(traitChance('armored', 8)).toBeCloseTo(0.04, 9);
    expect(traitChance('helmeted', 12)).toBeCloseTo(0.2, 9);
    expect(traitChance('armored', 19)).toBe(0.25);
    expect(traitChance('elite', 12)).toBe(0);
    expect(traitChance('elite', 13)).toBeCloseTo(0.03, 9);
    expect(traitChance('elite', 20)).toBe(0.12);
    expect([12, 13, 15, 16, 19, 20].map((n) => eliteMax(n))).toEqual([0, 1, 1, 2, 2, 3]);
  });
});

describe('wave difficulty: unlimited waves', () => {
  it('after the final wave the budget grows linearly at the final slope', () => {
    expect(waveBudget(FINAL_WAVE + 1)).toBe(Math.round(77 + 5.2));
    expect(waveBudget(30)).toBe(Math.round(77 + 52));
  });

  it('concurrency and spawn rate stay capped', () => {
    expect(waveMaxAlive(21)).toBe(24);
    expect(waveMaxAlive(25)).toBe(25);
    expect(waveMaxAlive(1000)).toBe(32);
    expect(waveSpawnRate(1000)).toBe(2);
  });

  it('every curve is finite, monotonic and sane up to wave 10 000', () => {
    let previous = { budget: 0, alive: 0, rate: 0, elite: 0 };
    for (let n = 1; n <= 10_000; n += n < 100 ? 1 : 97) {
      const now = {
        budget: waveBudget(n),
        alive: waveMaxAlive(n),
        rate: waveSpawnRate(n),
        elite: eliteMax(n),
      };
      for (const v of Object.values(now)) {
        expect(Number.isFinite(v), `wave ${n}`).toBe(true);
      }
      expect(now.budget).toBeGreaterThanOrEqual(previous.budget);
      expect(now.alive).toBeGreaterThanOrEqual(previous.alive);
      expect(now.rate).toBeGreaterThanOrEqual(previous.rate);
      expect(now.elite).toBeGreaterThanOrEqual(previous.elite);
      expect(now.alive).toBeLessThanOrEqual(32);
      previous = now;
    }
  });

  it('bad wave numbers read as wave 1', () => {
    expect(waveBudget(0)).toBe(6);
    expect(waveBudget(-5)).toBe(6);
    expect(waveBudget(Number.NaN)).toBe(6);
    expect(waveBudget(2.7)).toBe(8);
  });
});
