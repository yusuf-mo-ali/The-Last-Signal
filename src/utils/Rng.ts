/**
 * Seeded pseudo-random number generator for all gameplay randomness (D-014).
 *
 * Algorithm: sfc32 (Small Fast Counting, 128-bit state), seeded through splitmix32. It is fast,
 * passes PractRand, and is fully deterministic across browsers and Node because it only uses
 * 32-bit integer operations. `Math.random()` is reserved for purely cosmetic presentation effects.
 *
 * The same seed always yields the same sequence. That makes tests deterministic and bug reports
 * reproducible ("seed 1234, wave 7").
 */

/** The complete generator state; `setState` with a saved value replays the sequence exactly. */
export type RngState = readonly [number, number, number, number];

export interface WeightedEntry<T> {
  readonly item: T;
  readonly weight: number;
}

const UINT32_RANGE = 0x1_0000_0000;
/** Outputs discarded after seeding so that similar seeds diverge immediately. */
const WARM_UP_ROUNDS = 12;

export class Rng {
  /** The normalised 32-bit seed this generator started from. */
  readonly seed: number;

  private a = 0;
  private b = 0;
  private c = 0;
  private d = 0;

  /**
   * @param seed A finite number (reduced to an unsigned 32-bit integer) or any string (hashed).
   */
  constructor(seed: number | string) {
    this.seed = normaliseSeed(seed);
    let sm = this.seed;
    const nextSplitMix = (): number => {
      sm = (sm + 0x9e3779b9) | 0;
      let z = sm;
      z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
      z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
      return (z ^ (z >>> 16)) >>> 0;
    };
    this.a = nextSplitMix();
    this.b = nextSplitMix();
    this.c = nextSplitMix();
    this.d = nextSplitMix();
    for (let i = 0; i < WARM_UP_ROUNDS; i++) {
      this.nextUint32();
    }
  }

  /** Creates a generator that continues from a saved state. */
  static fromState(state: RngState): Rng {
    const rng = new Rng(0);
    rng.setState(state);
    return rng;
  }

  /** Uniform integer in [0, 2^32). */
  nextUint32(): number {
    // tmp = a + b + counter++  (the counter's value before incrementing)
    const t = (((this.a + this.b) | 0) + this.d) | 0;
    this.d = (this.d + 1) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (((this.c << 21) | (this.c >>> 11)) + t) | 0;
    return t >>> 0;
  }

  /** Uniform float in [0, 1). */
  next(): number {
    return this.nextUint32() / UINT32_RANGE;
  }

  /** Uniform float in [min, max). */
  range(min: number, max: number): number {
    if (!Number.isFinite(min) || !Number.isFinite(max) || max < min) {
      throw new RangeError(`Rng.range: invalid bounds [${min}, ${max})`);
    }
    return min + this.next() * (max - min);
  }

  /** Uniform integer in [min, max], both inclusive. */
  int(min: number, max: number): number {
    if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || max < min) {
      throw new RangeError(`Rng.int: invalid bounds [${min}, ${max}]`);
    }
    const span = max - min + 1;
    if (span > UINT32_RANGE) {
      throw new RangeError('Rng.int: range wider than 2^32 is not supported');
    }
    return min + Math.floor(this.next() * span);
  }

  /** True with probability `p` (clamped to [0, 1]). */
  chance(p: number): boolean {
    if (Number.isNaN(p)) {
      throw new RangeError('Rng.chance: probability is NaN');
    }
    return this.next() < p;
  }

  /** A uniformly chosen element. Throws on an empty array. */
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) {
      throw new RangeError('Rng.pick: cannot pick from an empty array');
    }
    return items[this.int(0, items.length - 1)] as T;
  }

  /**
   * An element chosen with probability proportional to its weight. Entries with a weight of 0 are
   * never chosen. Throws if no entry has a positive weight, or a weight is negative or not finite.
   */
  weighted<T>(entries: readonly WeightedEntry<T>[]): T {
    let total = 0;
    for (const entry of entries) {
      if (!Number.isFinite(entry.weight) || entry.weight < 0) {
        throw new RangeError(`Rng.weighted: invalid weight ${entry.weight}`);
      }
      total += entry.weight;
    }
    if (total <= 0) {
      throw new RangeError('Rng.weighted: no entry has a positive weight');
    }

    let roll = this.next() * total;
    let last: WeightedEntry<T> | undefined;
    for (const entry of entries) {
      if (entry.weight === 0) {
        continue;
      }
      last = entry;
      if (roll < entry.weight) {
        return entry.item;
      }
      roll -= entry.weight;
    }
    // Only reachable through floating-point rounding: fall back to the last positive-weight entry.
    if (last === undefined) {
      throw new Error('Rng.weighted: unreachable (no positive-weight entry)');
    }
    return last.item;
  }

  /** Shuffles `items` in place (Fisher–Yates) and returns it. */
  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      const tmp = items[i] as T;
      items[i] = items[j] as T;
      items[j] = tmp;
    }
    return items;
  }

  /**
   * A new, independent generator seeded from this one. Deterministic: the same parent state always
   * yields the same child. Use it to give a subsystem its own stream (e.g. waves vs. loot) so that
   * consuming numbers in one does not shift the other.
   */
  fork(): Rng {
    return new Rng(this.nextUint32());
  }

  getState(): RngState {
    return [this.a >>> 0, this.b >>> 0, this.c >>> 0, this.d >>> 0];
  }

  setState(state: RngState): void {
    // Checked at runtime too: saved states arrive from storage, not only from typed code.
    const values: readonly number[] = state;
    if (
      values.length !== 4 ||
      !values.every((v) => Number.isInteger(v) && v >= 0 && v < UINT32_RANGE)
    ) {
      throw new RangeError('Rng.setState: state must be four unsigned 32-bit integers');
    }
    [this.a, this.b, this.c, this.d] = state.map((v) => v | 0) as [number, number, number, number];
  }
}

/** Reduces a seed to an unsigned 32-bit integer. Strings are hashed with 32-bit FNV-1a. */
export function normaliseSeed(seed: number | string): number {
  if (typeof seed === 'string') {
    let hash = 0x811c9dc5;
    for (let i = 0; i < seed.length; i++) {
      hash ^= seed.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    return hash >>> 0;
  }
  if (!Number.isFinite(seed)) {
    throw new RangeError(`Rng: seed must be finite, got ${seed}`);
  }
  return Math.trunc(seed) >>> 0;
}
