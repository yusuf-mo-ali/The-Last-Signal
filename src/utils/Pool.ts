/**
 * A reusable object pool (IMPLEMENTATION_PLAN §24–25): hot paths acquire and release objects
 * instead of allocating them, so enemies, effects and events do not churn the garbage collector.
 *
 * - `reset` runs when an object is released, so everything waiting in the pool is already clean.
 * - Releasing an object twice, or one the pool did not hand out, throws: both are bugs that would
 *   otherwise let two owners share one object.
 * - `maxFree` caps how many idle objects are kept; extras, and everything removed by `clear()`,
 *   go to `dispose` (e.g. to free GPU resources).
 */

export interface PoolOptions<T> {
  /** Makes a new object when the pool is empty. */
  readonly create: () => T;
  /** Returns a released object to its initial state. */
  readonly reset?: (item: T) => void;
  /** Frees an object the pool drops (over `maxFree`, or via `clear()`). */
  readonly dispose?: (item: T) => void;
  /** Objects created up front. Default 0. */
  readonly initialSize?: number;
  /** Most idle objects kept for reuse. Default: unlimited. */
  readonly maxFree?: number;
}

export class Pool<T extends object> {
  private readonly free: T[] = [];
  private readonly active = new Set<T>();
  private readonly create: () => T;
  private readonly resetItem: ((item: T) => void) | undefined;
  private readonly disposeItem: ((item: T) => void) | undefined;
  private readonly maxFree: number;
  private created = 0;

  constructor(options: PoolOptions<T>) {
    this.create = options.create;
    this.resetItem = options.reset;
    this.disposeItem = options.dispose;
    this.maxFree = options.maxFree ?? Number.POSITIVE_INFINITY;

    const initialSize = options.initialSize ?? 0;
    if (!Number.isInteger(initialSize) || initialSize < 0) {
      throw new RangeError('Pool: initialSize must be a non-negative integer');
    }
    if (
      !(Number.isInteger(this.maxFree) || this.maxFree === Number.POSITIVE_INFINITY) ||
      this.maxFree < 0
    ) {
      throw new RangeError('Pool: maxFree must be a non-negative integer');
    }
    this.prewarm(initialSize);
  }

  /** Objects handed out and not yet released. */
  get inUse(): number {
    return this.active.size;
  }

  /** Idle objects ready to be acquired without allocating. */
  get available(): number {
    return this.free.length;
  }

  /** Objects ever created by this pool (a steady value means no allocations). */
  get totalCreated(): number {
    return this.created;
  }

  /** Takes an idle object, or creates one if none is available. */
  acquire(): T {
    const item = this.free.pop() ?? this.make();
    this.active.add(item);
    return item;
  }

  /** Resets `item` and returns it to the pool. */
  release(item: T): void {
    if (!this.active.delete(item)) {
      throw new Error('Pool.release: object is not in use (released twice, or not from this pool)');
    }
    this.resetItem?.(item);
    if (this.free.length < this.maxFree) {
      this.free.push(item);
    } else {
      this.disposeItem?.(item);
    }
  }

  /** Releases every object currently in use (e.g. when a run ends). */
  releaseAll(): void {
    for (const item of [...this.active]) {
      this.release(item);
    }
  }

  /** Creates idle objects until at least `count` are available (bounded by `maxFree`). */
  prewarm(count: number): void {
    const target = Math.min(count, this.maxFree);
    while (this.free.length < target) {
      this.free.push(this.make());
    }
  }

  /** Disposes and drops every idle object. Objects in use are unaffected. */
  clear(): void {
    for (const item of this.free) {
      this.disposeItem?.(item);
    }
    this.free.length = 0;
  }

  private make(): T {
    this.created++;
    return this.create();
  }
}
