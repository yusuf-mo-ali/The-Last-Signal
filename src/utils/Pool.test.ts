import { describe, expect, it, vi } from 'vitest';
import { Pool } from './Pool';

interface Particle {
  id: number;
  x: number;
  alive: boolean;
}

function createPool(options: { initialSize?: number; maxFree?: number } = {}) {
  let nextId = 0;
  const create = vi.fn((): Particle => ({ id: nextId++, x: 0, alive: false }));
  const reset = vi.fn((p: Particle) => {
    p.x = 0;
    p.alive = false;
  });
  const dispose = vi.fn();
  const pool = new Pool<Particle>({ create, reset, dispose, ...options });
  return { pool, create, reset, dispose };
}

describe('Pool', () => {
  describe('acquire and release', () => {
    it('creates objects on demand when empty', () => {
      const { pool, create } = createPool();
      const a = pool.acquire();
      const b = pool.acquire();

      expect(a).not.toBe(b);
      expect(create).toHaveBeenCalledTimes(2);
      expect(pool.inUse).toBe(2);
      expect(pool.available).toBe(0);
      expect(pool.totalCreated).toBe(2);
    });

    it('reuses a released object instead of creating a new one', () => {
      const { pool, create } = createPool();
      const first = pool.acquire();
      pool.release(first);

      const second = pool.acquire();

      expect(second).toBe(first);
      expect(create).toHaveBeenCalledOnce();
    });

    it('stops allocating once warm: a steady acquire/release cycle creates nothing new', () => {
      const { pool } = createPool();
      const batch = Array.from({ length: 10 }, () => pool.acquire());
      batch.forEach((p) => {
        pool.release(p);
      });

      for (let frame = 0; frame < 100; frame++) {
        const items = Array.from({ length: 10 }, () => pool.acquire());
        items.forEach((p) => {
          pool.release(p);
        });
      }

      expect(pool.totalCreated).toBe(10);
    });

    it('tracks in-use and available counts', () => {
      const { pool } = createPool();
      const a = pool.acquire();
      const b = pool.acquire();
      pool.release(a);

      expect(pool.inUse).toBe(1);
      expect(pool.available).toBe(1);

      pool.release(b);
      expect(pool.inUse).toBe(0);
      expect(pool.available).toBe(2);
    });
  });

  describe('reset', () => {
    it('resets an object when it is released, so acquired objects are always clean', () => {
      const { pool, reset } = createPool();
      const p = pool.acquire();
      p.x = 42;
      p.alive = true;

      pool.release(p);

      expect(reset).toHaveBeenCalledWith(p);
      expect(p).toMatchObject({ x: 0, alive: false });
      expect(pool.acquire()).toMatchObject({ x: 0, alive: false });
    });

    it('does not reset objects on acquire', () => {
      const { pool, reset } = createPool({ initialSize: 3 });
      pool.acquire();
      expect(reset).not.toHaveBeenCalled();
    });

    it('works without a reset function', () => {
      const pool = new Pool({ create: () => ({ value: 1 }) });
      const item = pool.acquire();
      item.value = 5;
      pool.release(item);
      expect(pool.acquire().value).toBe(5);
    });
  });

  describe('misuse', () => {
    it('throws when an object is released twice, without corrupting the pool', () => {
      const { pool } = createPool();
      const p = pool.acquire();
      pool.release(p);

      expect(() => {
        pool.release(p);
      }).toThrow(/not in use/);
      expect(pool.available).toBe(1);

      // Two acquires must never return the same object.
      expect(pool.acquire()).not.toBe(pool.acquire());
    });

    it('throws when releasing an object that did not come from this pool', () => {
      const { pool } = createPool();
      const other = createPool().pool.acquire();
      expect(() => {
        pool.release(other);
      }).toThrow(/not in use/);
      expect(pool.available).toBe(0);
    });
  });

  describe('prewarm, limits and cleanup', () => {
    it('prewarms initialSize objects up front', () => {
      const { pool, create } = createPool({ initialSize: 5 });
      expect(create).toHaveBeenCalledTimes(5);
      expect(pool.available).toBe(5);

      Array.from({ length: 5 }, () => pool.acquire());
      expect(pool.totalCreated).toBe(5);
    });

    it('prewarm() tops up to the requested count without over-creating', () => {
      const { pool } = createPool({ initialSize: 2 });
      pool.prewarm(6);
      expect(pool.available).toBe(6);
      pool.prewarm(3);
      expect(pool.available).toBe(6);
      expect(pool.totalCreated).toBe(6);
    });

    it('keeps at most maxFree idle objects and disposes the rest', () => {
      const { pool, dispose } = createPool({ maxFree: 2 });
      const items = Array.from({ length: 4 }, () => pool.acquire());

      items.forEach((p) => {
        pool.release(p);
      });

      expect(pool.available).toBe(2);
      expect(dispose).toHaveBeenCalledTimes(2);
      expect(dispose).toHaveBeenCalledWith(items[2]);
      expect(dispose).toHaveBeenCalledWith(items[3]);
    });

    it('never prewarms beyond maxFree', () => {
      const { pool } = createPool({ initialSize: 10, maxFree: 3 });
      expect(pool.available).toBe(3);
    });

    it('releaseAll() resets and returns every object in use', () => {
      const { pool, reset } = createPool();
      const items = Array.from({ length: 3 }, () => pool.acquire());
      items.forEach((p) => {
        p.alive = true;
      });

      pool.releaseAll();

      expect(pool.inUse).toBe(0);
      expect(pool.available).toBe(3);
      expect(reset).toHaveBeenCalledTimes(3);
      expect(items.every((p) => !p.alive)).toBe(true);
    });

    it('clear() disposes idle objects and leaves objects in use alone', () => {
      const { pool, dispose } = createPool({ initialSize: 3 });
      const held = pool.acquire();

      pool.clear();

      expect(dispose).toHaveBeenCalledTimes(2);
      expect(dispose).not.toHaveBeenCalledWith(held);
      expect(pool.available).toBe(0);
      expect(pool.inUse).toBe(1);

      // The held object can still be released normally.
      pool.release(held);
      expect(pool.available).toBe(1);
    });

    it('rejects invalid options', () => {
      const create = () => ({});
      expect(() => new Pool({ create, initialSize: -1 })).toThrow(RangeError);
      expect(() => new Pool({ create, initialSize: 1.5 })).toThrow(RangeError);
      expect(() => new Pool({ create, maxFree: -1 })).toThrow(RangeError);
      expect(() => new Pool({ create, maxFree: 2.5 })).toThrow(RangeError);
    });
  });
});
