import { describe, expect, it } from 'vitest';
import { normaliseSeed, Rng } from './Rng';

/**
 * Independent reference implementation of sfc32 (Chris Doty-Humphrey's PractRand), written from
 * the C source: `tmp = a + b + counter++; a = b ^ (b >> 9); b = c + (c << 3);
 * c = rotl(c, 21) + tmp; return tmp;`.
 */
function referenceSfc32(state: readonly [number, number, number, number]): () => number {
  let [a, b, c, d] = state;
  return () => {
    const tmp = (a + b + d) >>> 0;
    d = (d + 1) >>> 0;
    a = (b ^ (b >>> 9)) >>> 0;
    b = (c + ((c << 3) >>> 0)) >>> 0;
    c = ((((c << 21) | (c >>> 11)) >>> 0) + tmp) >>> 0;
    return tmp;
  };
}

function take(rng: Rng, n: number): number[] {
  return Array.from({ length: n }, () => rng.nextUint32());
}

describe('Rng', () => {
  describe('determinism', () => {
    it('produces fixed golden values for known seeds (guards against algorithm changes)', () => {
      expect(take(new Rng(12345), 5)).toEqual([
        2345461488, 1344865159, 2974739204, 3448212715, 1746298622,
      ]);
      expect(take(new Rng('the-last-signal'), 5)).toEqual([
        1540039781, 1937081226, 2199055511, 2008552797, 1665987283,
      ]);
    });

    it('matches an independent sfc32 reference implementation from any state', () => {
      const states: [number, number, number, number][] = [
        [0, 0, 0, 1],
        [0xdeadbeef, 0x12345678, 0xffffffff, 0x80000000],
        new Rng(987654).getState() as [number, number, number, number],
      ];
      for (const state of states) {
        const rng = Rng.fromState(state);
        const reference = referenceSfc32(state);
        for (let i = 0; i < 1000; i++) {
          expect(rng.nextUint32()).toBe(reference());
        }
      }
    });

    it('repeats the exact sequence for the same seed', () => {
      const a = new Rng(2024);
      const b = new Rng(2024);
      expect(take(a, 1000)).toEqual(take(b, 1000));
    });

    it('produces different sequences for different, even adjacent, seeds', () => {
      expect(take(new Rng(1), 8)).not.toEqual(take(new Rng(2), 8));
      expect(take(new Rng('wave-1'), 8)).not.toEqual(take(new Rng('wave-2'), 8));
    });

    it('replays exactly from a saved state', () => {
      const rng = new Rng(77);
      take(rng, 123);
      const saved = rng.getState();
      const expected = take(rng, 50);

      expect(take(Rng.fromState(saved), 50)).toEqual(expected);

      rng.setState(saved);
      expect(take(rng, 50)).toEqual(expected);
    });

    it('rejects an invalid saved state', () => {
      const rng = new Rng(1);
      const bad = [
        [1, 2, 3],
        [1, 2, 3, -1],
        [1, 2, 3, 2 ** 32],
        [1, 2, 3, 1.5],
      ] as unknown as [number, number, number, number][];
      for (const state of bad) {
        expect(() => {
          rng.setState(state);
        }).toThrow(RangeError);
      }
    });

    it('forks deterministic, independent child streams', () => {
      const parentA = new Rng(5);
      const parentB = new Rng(5);
      const childA = parentA.fork();
      const childB = parentB.fork();

      expect(take(childA, 20)).toEqual(take(childB, 20));
      // Consuming the child does not shift the parent.
      expect(take(parentA, 20)).toEqual(take(parentB, 20));
      // The child is not a copy of the parent's stream.
      expect(take(new Rng(5).fork(), 20)).not.toEqual(take(new Rng(5), 20));
    });
  });

  describe('seeds', () => {
    it('normalises numeric seeds to unsigned 32-bit integers', () => {
      expect(new Rng(42).seed).toBe(42);
      expect(normaliseSeed(-1)).toBe(0xffffffff);
      expect(normaliseSeed(2 ** 32 + 5)).toBe(5);
      expect(normaliseSeed(3.9)).toBe(3);
      expect(take(new Rng(2 ** 32 + 5), 5)).toEqual(take(new Rng(5), 5));
    });

    it('hashes string seeds with 32-bit FNV-1a (published test vectors)', () => {
      expect(normaliseSeed('')).toBe(0x811c9dc5);
      expect(normaliseSeed('a')).toBe(0xe40c292c);
      expect(normaliseSeed('foobar')).toBe(0xbf9cf968);
    });

    it('rejects non-finite numeric seeds', () => {
      expect(() => new Rng(Number.NaN)).toThrow(RangeError);
      expect(() => new Rng(Number.POSITIVE_INFINITY)).toThrow(RangeError);
    });
  });

  describe('next / range', () => {
    it('next() stays in [0, 1) and averages 0.5', () => {
      const rng = new Rng(1);
      let sum = 0;
      const n = 100_000;
      for (let i = 0; i < n; i++) {
        const x = rng.next();
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThan(1);
        sum += x;
      }
      expect(sum / n).toBeCloseTo(0.5, 2);
    });

    it('range() stays in [min, max)', () => {
      const rng = new Rng(2);
      for (let i = 0; i < 10_000; i++) {
        const x = rng.range(-3, 7);
        expect(x).toBeGreaterThanOrEqual(-3);
        expect(x).toBeLessThan(7);
      }
      expect(rng.range(4, 4)).toBe(4);
    });

    it('range() rejects invalid bounds', () => {
      const rng = new Rng(3);
      expect(() => rng.range(5, 1)).toThrow(RangeError);
      expect(() => rng.range(0, Number.NaN)).toThrow(RangeError);
      expect(() => rng.range(Number.NEGATIVE_INFINITY, 0)).toThrow(RangeError);
    });
  });

  describe('int', () => {
    it('includes both bounds and is roughly uniform', () => {
      const rng = new Rng(4);
      const counts = new Map<number, number>();
      const n = 60_000;
      for (let i = 0; i < n; i++) {
        const x = rng.int(1, 6);
        counts.set(x, (counts.get(x) ?? 0) + 1);
      }
      expect([...counts.keys()].sort()).toEqual([1, 2, 3, 4, 5, 6]);
      for (const count of counts.values()) {
        expect(count / n).toBeGreaterThan(1 / 6 - 0.01);
        expect(count / n).toBeLessThan(1 / 6 + 0.01);
      }
    });

    it('handles single-value and negative ranges', () => {
      const rng = new Rng(5);
      expect(rng.int(9, 9)).toBe(9);
      for (let i = 0; i < 1000; i++) {
        const x = rng.int(-2, 2);
        expect(Number.isInteger(x)).toBe(true);
        expect(x).toBeGreaterThanOrEqual(-2);
        expect(x).toBeLessThanOrEqual(2);
      }
    });

    it('rejects invalid bounds', () => {
      const rng = new Rng(6);
      expect(() => rng.int(3, 1)).toThrow(RangeError);
      expect(() => rng.int(0.5, 3)).toThrow(RangeError);
      expect(() => rng.int(0, Number.NaN)).toThrow(RangeError);
      expect(() => rng.int(0, 2 ** 32)).toThrow(RangeError);
    });
  });

  describe('chance', () => {
    it('never succeeds at p <= 0 and always succeeds at p >= 1', () => {
      const rng = new Rng(7);
      for (let i = 0; i < 1000; i++) {
        expect(rng.chance(0)).toBe(false);
        expect(rng.chance(-1)).toBe(false);
        expect(rng.chance(1)).toBe(true);
        expect(rng.chance(2)).toBe(true);
      }
    });

    it('succeeds at about the requested rate', () => {
      const rng = new Rng(8);
      let hits = 0;
      const n = 50_000;
      for (let i = 0; i < n; i++) {
        if (rng.chance(0.25)) {
          hits++;
        }
      }
      expect(hits / n).toBeCloseTo(0.25, 2);
    });

    it('rejects NaN', () => {
      expect(() => new Rng(9).chance(Number.NaN)).toThrow(RangeError);
    });
  });

  describe('pick / weighted / shuffle', () => {
    it('pick() returns every element eventually and throws on an empty array', () => {
      const rng = new Rng(10);
      const items = ['walker', 'runner', 'tank'] as const;
      const seen = new Set<string>();
      for (let i = 0; i < 200; i++) {
        seen.add(rng.pick(items));
      }
      expect(seen).toEqual(new Set(items));
      expect(() => rng.pick([])).toThrow(RangeError);
    });

    it('weighted() follows the weights and never picks zero-weight entries', () => {
      const rng = new Rng(11);
      const entries = [
        { item: 'common', weight: 3 },
        { item: 'never', weight: 0 },
        { item: 'rare', weight: 1 },
      ];
      const counts: Record<string, number> = { common: 0, never: 0, rare: 0 };
      const n = 40_000;
      for (let i = 0; i < n; i++) {
        const item = rng.weighted(entries);
        counts[item] = (counts[item] ?? 0) + 1;
      }
      expect(counts.never).toBe(0);
      expect((counts.common ?? 0) / n).toBeCloseTo(0.75, 1);
      expect((counts.rare ?? 0) / n).toBeCloseTo(0.25, 1);
    });

    it('weighted() rejects empty, all-zero, negative and non-finite weights', () => {
      const rng = new Rng(12);
      expect(() => rng.weighted([])).toThrow(RangeError);
      expect(() => rng.weighted([{ item: 'a', weight: 0 }])).toThrow(RangeError);
      expect(() => rng.weighted([{ item: 'a', weight: -1 }])).toThrow(RangeError);
      expect(() => rng.weighted([{ item: 'a', weight: Number.NaN }])).toThrow(RangeError);
      expect(() => rng.weighted([{ item: 'a', weight: Number.POSITIVE_INFINITY }])).toThrow(
        RangeError,
      );
    });

    it('shuffle() is an in-place, deterministic permutation', () => {
      const original = Array.from({ length: 20 }, (_, i) => i);
      const a = [...original];
      const b = [...original];

      const result = new Rng(13).shuffle(a);
      new Rng(13).shuffle(b);

      expect(result).toBe(a);
      expect(a).toEqual(b);
      expect([...a].sort((x, y) => x - y)).toEqual(original);
      expect(a).not.toEqual(original);
    });

    it('shuffle() handles empty and single-element arrays', () => {
      const rng = new Rng(14);
      expect(rng.shuffle([])).toEqual([]);
      expect(rng.shuffle(['only'])).toEqual(['only']);
    });
  });
});
