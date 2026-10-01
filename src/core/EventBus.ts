/**
 * Typed, synchronous publish/subscribe for cross-cutting notifications (ARCHITECTURE.md §7.1, D-015).
 *
 * - `Events` maps each event name to its payload type, so `emit` and `on` are type-checked.
 * - Dispatch is synchronous. Events emitted while a dispatch is running are queued and delivered,
 *   in order, after every listener of the current event has run (no re-entrant dispatch).
 * - Listeners are snapshotted per event: a listener added during a dispatch first hears the next
 *   event; a listener removed during a dispatch is not called again, even for the current event.
 * - A throwing listener never stops the others. Errors go to `onListenerError`, or, by default,
 *   are rethrown once the queue has drained, so the bus is always left in a consistent state.
 * - Payloads may be pooled by their producers: listeners must not keep references to them.
 */

export type Listener<T> = (payload: T) => void;
export type Unsubscribe = () => void;

/** Events whose payload type is `undefined` may be emitted without a payload argument. */
export type PayloadArgs<T> = [T] extends [undefined] ? [payload?: T] : [payload: T];

export interface EventBusOptions {
  /** Receives listener errors. When omitted, errors are rethrown after the dispatch queue drains. */
  readonly onListenerError?: (error: unknown, type: PropertyKey) => void;
  /** Upper bound on events delivered by one drain; guards against listeners re-emitting forever. */
  readonly maxDispatchesPerDrain?: number;
}

interface Subscription {
  readonly listener: Listener<unknown>;
  readonly once: boolean;
  active: boolean;
}

interface QueuedEvent {
  readonly type: PropertyKey;
  readonly payload: unknown;
}

const DEFAULT_MAX_DISPATCHES_PER_DRAIN = 10_000;

export class EventBus<Events extends object> {
  // Arrays are replaced (copy-on-write) on every change, so a dispatch can iterate safely.
  private readonly subscriptions = new Map<keyof Events, readonly Subscription[]>();
  private readonly queue: QueuedEvent[] = [];
  private dispatching = false;
  private readonly onListenerError: EventBusOptions['onListenerError'];
  private readonly maxDispatchesPerDrain: number;

  constructor(options: EventBusOptions = {}) {
    this.onListenerError = options.onListenerError;
    this.maxDispatchesPerDrain = options.maxDispatchesPerDrain ?? DEFAULT_MAX_DISPATCHES_PER_DRAIN;
    if (!Number.isInteger(this.maxDispatchesPerDrain) || this.maxDispatchesPerDrain < 1) {
      throw new RangeError('maxDispatchesPerDrain must be a positive integer');
    }
  }

  on<K extends keyof Events>(type: K, listener: Listener<Events[K]>): Unsubscribe {
    return this.subscribe(type, listener, false);
  }

  once<K extends keyof Events>(type: K, listener: Listener<Events[K]>): Unsubscribe {
    return this.subscribe(type, listener, true);
  }

  emit<K extends keyof Events>(type: K, ...args: PayloadArgs<Events[K]>): void {
    this.queue.push({ type, payload: args[0] });
    if (!this.dispatching) {
      this.drain();
    }
  }

  listenerCount(type: keyof Events): number {
    return this.subscriptions.get(type)?.length ?? 0;
  }

  /** Creates a group of subscriptions that can be removed together (e.g. per run, D-016). */
  createScope(): EventScope<Events> {
    return new EventScope(this);
  }

  /** Removes every listener. Events already queued are still delivered to no one. */
  clear(): void {
    for (const subs of this.subscriptions.values()) {
      for (const sub of subs) {
        sub.active = false;
      }
    }
    this.subscriptions.clear();
  }

  private subscribe<K extends keyof Events>(
    type: K,
    listener: Listener<Events[K]>,
    once: boolean,
  ): Unsubscribe {
    const sub: Subscription = { listener: listener as Listener<unknown>, once, active: true };
    this.subscriptions.set(type, [...(this.subscriptions.get(type) ?? []), sub]);
    return () => {
      this.remove(type, sub);
    };
  }

  private remove(type: keyof Events, sub: Subscription): void {
    if (!sub.active) {
      return;
    }
    sub.active = false;
    const remaining = (this.subscriptions.get(type) ?? []).filter((s) => s !== sub);
    if (remaining.length === 0) {
      this.subscriptions.delete(type);
    } else {
      this.subscriptions.set(type, remaining);
    }
  }

  private drain(): void {
    const errors: unknown[] = [];
    this.dispatching = true;
    try {
      for (let i = 0; i < this.queue.length; i++) {
        if (i >= this.maxDispatchesPerDrain) {
          throw new Error(
            `EventBus: more than ${this.maxDispatchesPerDrain} events in one dispatch; ` +
              'a listener is probably re-emitting in a loop',
          );
        }
        const event = this.queue[i];
        if (event) {
          this.dispatch(event, errors);
        }
      }
    } finally {
      this.queue.length = 0;
      this.dispatching = false;
    }

    if (errors.length > 0) {
      const first = errors[0];
      throw errors.length === 1 && first instanceof Error
        ? first
        : new AggregateError(errors, `EventBus: ${errors.length} listener(s) threw`);
    }
  }

  private dispatch(event: QueuedEvent, errors: unknown[]): void {
    const type = event.type as keyof Events;
    const subs = this.subscriptions.get(type);
    if (!subs) {
      return;
    }
    for (const sub of subs) {
      if (!sub.active) {
        continue;
      }
      if (sub.once) {
        this.remove(type, sub);
      }
      try {
        sub.listener(event.payload);
      } catch (error) {
        if (this.onListenerError) {
          this.onListenerError(error, event.type);
        } else {
          errors.push(error);
        }
      }
    }
  }
}

/**
 * A set of subscriptions on one bus that are removed together by `dispose()`.
 * The RunSession uses one so that nothing subscribed during a run outlives it.
 */
export class EventScope<Events extends object> {
  private readonly bus: EventBus<Events>;
  private readonly unsubscribers: Unsubscribe[] = [];
  private isDisposed = false;

  constructor(bus: EventBus<Events>) {
    this.bus = bus;
  }

  get disposed(): boolean {
    return this.isDisposed;
  }

  on<K extends keyof Events>(type: K, listener: Listener<Events[K]>): Unsubscribe {
    this.assertActive();
    return this.track(this.bus.on(type, listener));
  }

  once<K extends keyof Events>(type: K, listener: Listener<Events[K]>): Unsubscribe {
    this.assertActive();
    return this.track(this.bus.once(type, listener));
  }

  dispose(): void {
    if (this.isDisposed) {
      return;
    }
    this.isDisposed = true;
    for (const unsubscribe of this.unsubscribers) {
      unsubscribe();
    }
    this.unsubscribers.length = 0;
  }

  private assertActive(): void {
    if (this.isDisposed) {
      throw new Error('EventScope: cannot subscribe after dispose()');
    }
  }

  private track(unsubscribe: Unsubscribe): Unsubscribe {
    this.unsubscribers.push(unsubscribe);
    return unsubscribe;
  }
}
