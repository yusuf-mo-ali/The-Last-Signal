import { describe, expect, it } from 'vitest';
import { Health } from './Health';

describe('Health', () => {
  it('starts full, or at a configured value clamped to the maximum', () => {
    expect(new Health({ max: 100 }).current).toBe(100);
    expect(new Health({ max: 100, start: 40 }).current).toBe(40);
    expect(new Health({ max: 100, start: 250 }).current).toBe(100);
    expect(new Health({ max: 100, start: -5 }).isAlive).toBe(true);
  });

  it('rejects an unusable maximum', () => {
    for (const max of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => new Health({ max })).toThrow(RangeError);
    }
  });

  it('non-lethal damage reduces health', () => {
    const h = new Health({ max: 100 });
    expect(h.damage(26)).toEqual({ applied: 26, overkill: 0, killed: false, ignored: false });
    expect(h.current).toBe(74);
    expect(h.fraction).toBe(0.74);
    expect(h.isAlive).toBe(true);
  });

  it('lethal damage kills once, clamps to 0 and reports the overkill', () => {
    const h = new Health({ max: 100, start: 30 });
    expect(h.damage(65)).toEqual({ applied: 30, overkill: 35, killed: true, ignored: false });
    expect(h.current).toBe(0);
    expect(h.isDead).toBe(true);
  });

  it('exactly lethal damage kills', () => {
    const h = new Health({ max: 100 });
    h.damage(35);
    expect(h.damage(65).killed).toBe(true);
  });

  it('floating-point dust does not leave a target alive', () => {
    const h = new Health({ max: 0.3 });
    h.damage(0.1);
    h.damage(0.1);
    expect(h.damage(0.1).killed).toBe(true); // 0.3 − 0.1 − 0.1 − 0.1 ≈ 2.8e-17
  });

  it('damage after death is ignored and never kills again', () => {
    const h = new Health({ max: 50 });
    expect(h.damage(80).killed).toBe(true);
    const again = h.damage(80);
    expect(again).toEqual({ applied: 0, overkill: 0, killed: false, ignored: true });
    expect(h.current).toBe(0);
  });

  it('zero, negative and NaN damage change nothing', () => {
    const h = new Health({ max: 100 });
    for (const amount of [0, -10, Number.NaN]) {
      expect(h.damage(amount).ignored).toBe(true);
    }
    expect(h.current).toBe(100);
  });

  it('infinite damage kills', () => {
    const h = new Health({ max: 100 });
    expect(h.damage(Number.POSITIVE_INFINITY).killed).toBe(true);
  });

  it('heals up to the maximum, never while dead', () => {
    const h = new Health({ max: 100, start: 90 });
    expect(h.heal(25)).toBe(10);
    expect(h.current).toBe(100);
    expect(h.heal(-5)).toBe(0);
    expect(h.heal(Number.POSITIVE_INFINITY)).toBe(0);
    h.damage(200);
    expect(h.heal(50)).toBe(0);
    expect(h.isDead).toBe(true);
  });

  it('revives to full or to a given value, and can die again', () => {
    const h = new Health({ max: 100 });
    h.damage(100);
    h.revive();
    expect(h.isAlive).toBe(true);
    expect(h.current).toBe(100);
    h.damage(100);
    h.revive(20);
    expect(h.current).toBe(20);
    expect(h.damage(20).killed).toBe(true);
  });

  it('changes its maximum, clamping or keeping the fraction', () => {
    const h = new Health({ max: 100, start: 80 });
    h.setMax(50);
    expect(h.current).toBe(50);
    h.setMax(200, true);
    expect(h.current).toBe(200);
    h.damage(100);
    h.setMax(100, true);
    expect(h.current).toBe(50);
    expect(() => {
      h.setMax(0);
    }).toThrow(RangeError);
  });
});
