import { describe, expect, it, vi } from 'vitest';
import { EventBus } from './EventBus';

interface TestEvents {
  hit: { damage: number };
  kill: { id: string };
  tick: undefined;
}

function createBus() {
  return new EventBus<TestEvents>();
}

describe('EventBus', () => {
  describe('delivery', () => {
    it('delivers the typed payload to a listener', () => {
      const bus = createBus();
      const listener = vi.fn();
      bus.on('hit', listener);

      bus.emit('hit', { damage: 12 });

      expect(listener).toHaveBeenCalledOnce();
      expect(listener).toHaveBeenCalledWith({ damage: 12 });
    });

    it('calls listeners in subscription order', () => {
      const bus = createBus();
      const log: string[] = [];
      bus.on('hit', () => log.push('first'));
      bus.on('hit', () => log.push('second'));
      bus.on('hit', () => log.push('third'));

      bus.emit('hit', { damage: 1 });

      expect(log).toEqual(['first', 'second', 'third']);
    });

    it('only calls listeners of the emitted event type', () => {
      const bus = createBus();
      const onHit = vi.fn();
      const onKill = vi.fn();
      bus.on('hit', onHit);
      bus.on('kill', onKill);

      bus.emit('kill', { id: 'z1' });

      expect(onHit).not.toHaveBeenCalled();
      expect(onKill).toHaveBeenCalledOnce();
    });

    it('allows emitting events whose payload type is undefined without a payload', () => {
      const bus = createBus();
      const listener = vi.fn();
      bus.on('tick', listener);

      bus.emit('tick');

      expect(listener).toHaveBeenCalledWith(undefined);
    });

    it('does nothing when an event has no listeners', () => {
      const bus = createBus();
      expect(() => {
        bus.emit('hit', { damage: 1 });
      }).not.toThrow();
    });

    it('lets the same function subscribe twice and be called twice', () => {
      const bus = createBus();
      const listener = vi.fn();
      bus.on('hit', listener);
      bus.on('hit', listener);

      bus.emit('hit', { damage: 1 });

      expect(listener).toHaveBeenCalledTimes(2);
    });
  });

  describe('unsubscribing', () => {
    it('stops delivery after unsubscribe, and unsubscribing twice is harmless', () => {
      const bus = createBus();
      const listener = vi.fn();
      const unsubscribe = bus.on('hit', listener);

      unsubscribe();
      unsubscribe();
      bus.emit('hit', { damage: 1 });

      expect(listener).not.toHaveBeenCalled();
      expect(bus.listenerCount('hit')).toBe(0);
    });

    it('once() delivers exactly one event', () => {
      const bus = createBus();
      const listener = vi.fn();
      bus.once('hit', listener);

      bus.emit('hit', { damage: 1 });
      bus.emit('hit', { damage: 2 });

      expect(listener).toHaveBeenCalledOnce();
      expect(listener).toHaveBeenCalledWith({ damage: 1 });
      expect(bus.listenerCount('hit')).toBe(0);
    });

    it('once() can be cancelled before it fires', () => {
      const bus = createBus();
      const listener = vi.fn();
      const unsubscribe = bus.once('hit', listener);

      unsubscribe();
      bus.emit('hit', { damage: 1 });

      expect(listener).not.toHaveBeenCalled();
    });

    it('clear() removes every listener', () => {
      const bus = createBus();
      const listener = vi.fn();
      bus.on('hit', listener);
      bus.on('kill', listener);

      bus.clear();
      bus.emit('hit', { damage: 1 });
      bus.emit('kill', { id: 'z1' });

      expect(listener).not.toHaveBeenCalled();
      expect(bus.listenerCount('hit')).toBe(0);
      expect(bus.listenerCount('kill')).toBe(0);
    });

    it('counts listeners per event type', () => {
      const bus = createBus();
      bus.on('hit', vi.fn());
      bus.on('hit', vi.fn());
      bus.on('kill', vi.fn());

      expect(bus.listenerCount('hit')).toBe(2);
      expect(bus.listenerCount('kill')).toBe(1);
      expect(bus.listenerCount('tick')).toBe(0);
    });
  });

  describe('re-entrancy and ordering', () => {
    it('queues events emitted during a dispatch until every current listener has run', () => {
      const bus = createBus();
      const log: string[] = [];
      bus.on('hit', () => {
        log.push('hit:1');
        bus.emit('kill', { id: 'z1' });
        log.push('hit:1 done');
      });
      bus.on('hit', () => log.push('hit:2'));
      bus.on('kill', () => log.push('kill'));

      bus.emit('hit', { damage: 1 });

      expect(log).toEqual(['hit:1', 'hit:1 done', 'hit:2', 'kill']);
    });

    it('delivers nested emissions in FIFO order', () => {
      const bus = createBus();
      const log: string[] = [];
      bus.on('tick', () => {
        log.push('tick');
        bus.emit('hit', { damage: 1 });
        bus.emit('kill', { id: 'a' });
      });
      bus.on('hit', () => {
        log.push('hit');
        bus.emit('kill', { id: 'b' });
      });
      bus.on('kill', ({ id }) => log.push(`kill:${id}`));

      bus.emit('tick');

      expect(log).toEqual(['tick', 'hit', 'kill:a', 'kill:b']);
    });

    it('does not call a listener added during a dispatch for the current event', () => {
      const bus = createBus();
      const late = vi.fn();
      bus.on('hit', () => {
        bus.on('hit', late);
      });

      bus.emit('hit', { damage: 1 });
      expect(late).not.toHaveBeenCalled();

      bus.emit('hit', { damage: 2 });
      expect(late).toHaveBeenCalledOnce();
    });

    it('does not call a listener that an earlier listener removed during the same dispatch', () => {
      const bus = createBus();
      const victim = vi.fn();
      let unsubscribeVictim = (): void => undefined;
      bus.on('hit', () => {
        unsubscribeVictim();
      });
      unsubscribeVictim = bus.on('hit', victim);

      bus.emit('hit', { damage: 1 });

      expect(victim).not.toHaveBeenCalled();
    });

    it('does not re-fire a once() listener that emits its own event', () => {
      const bus = createBus();
      const listener = vi.fn(() => {
        bus.emit('hit', { damage: 2 });
      });
      bus.once('hit', listener);

      bus.emit('hit', { damage: 1 });

      expect(listener).toHaveBeenCalledOnce();
    });
  });

  describe('error isolation', () => {
    it('keeps calling the other listeners and rethrows the error after the dispatch', () => {
      const bus = createBus();
      const after = vi.fn();
      const boom = new Error('boom');
      bus.on('hit', () => {
        throw boom;
      });
      bus.on('hit', after);

      expect(() => {
        bus.emit('hit', { damage: 1 });
      }).toThrow(boom);
      expect(after).toHaveBeenCalledOnce();
    });

    it('delivers queued events before rethrowing, and wraps several errors in an AggregateError', () => {
      const bus = createBus();
      const onKill = vi.fn();
      bus.on('hit', () => {
        bus.emit('kill', { id: 'z1' });
        throw new Error('first');
      });
      bus.on('kill', () => {
        onKill();
        throw new Error('second');
      });

      let caught: unknown;
      try {
        bus.emit('hit', { damage: 1 });
      } catch (error) {
        caught = error;
      }

      expect(onKill).toHaveBeenCalledOnce();
      expect(caught).toBeInstanceOf(AggregateError);
      expect((caught as AggregateError).errors).toHaveLength(2);
    });

    it('reports errors to onListenerError instead of throwing when provided', () => {
      const onListenerError = vi.fn();
      const bus = new EventBus<TestEvents>({ onListenerError });
      const boom = new Error('boom');
      bus.on('hit', () => {
        throw boom;
      });

      expect(() => {
        bus.emit('hit', { damage: 1 });
      }).not.toThrow();
      expect(onListenerError).toHaveBeenCalledWith(boom, 'hit');
    });

    it('remains usable after a listener throws', () => {
      const bus = createBus();
      const listener = vi.fn();
      bus.once('hit', () => {
        throw new Error('boom');
      });
      bus.on('kill', listener);

      expect(() => {
        bus.emit('hit', { damage: 1 });
      }).toThrow();
      bus.emit('kill', { id: 'z1' });

      expect(listener).toHaveBeenCalledOnce();
    });

    it('stops a listener that re-emits forever, then recovers', () => {
      const bus = new EventBus<TestEvents>({ maxDispatchesPerDrain: 100 });
      let calls = 0;
      const unsubscribe = bus.on('tick', () => {
        calls++;
        bus.emit('tick');
      });

      expect(() => {
        bus.emit('tick');
      }).toThrow(/re-emitting in a loop/);
      expect(calls).toBe(100);

      unsubscribe();
      const listener = vi.fn();
      bus.on('hit', listener);
      bus.emit('hit', { damage: 1 });
      expect(listener).toHaveBeenCalledOnce();
    });

    it('rejects an invalid maxDispatchesPerDrain', () => {
      expect(() => new EventBus<TestEvents>({ maxDispatchesPerDrain: 0 })).toThrow(RangeError);
      expect(() => new EventBus<TestEvents>({ maxDispatchesPerDrain: 1.5 })).toThrow(RangeError);
    });
  });

  describe('scopes', () => {
    it('dispose() removes only the scope subscriptions', () => {
      const bus = createBus();
      const scope = bus.createScope();
      const scoped = vi.fn();
      const scopedOnce = vi.fn();
      const global = vi.fn();
      scope.on('hit', scoped);
      scope.once('hit', scopedOnce);
      bus.on('hit', global);

      scope.dispose();
      bus.emit('hit', { damage: 1 });

      expect(scoped).not.toHaveBeenCalled();
      expect(scopedOnce).not.toHaveBeenCalled();
      expect(global).toHaveBeenCalledOnce();
      expect(scope.disposed).toBe(true);
    });

    it('delivers events while the scope is alive', () => {
      const bus = createBus();
      const scope = bus.createScope();
      const listener = vi.fn();
      scope.on('kill', listener);

      bus.emit('kill', { id: 'z1' });

      expect(listener).toHaveBeenCalledWith({ id: 'z1' });
    });

    it('is idempotent to dispose and refuses new subscriptions afterwards', () => {
      const bus = createBus();
      const scope = bus.createScope();
      scope.dispose();

      expect(() => {
        scope.dispose();
      }).not.toThrow();
      expect(() => scope.on('hit', vi.fn())).toThrow(/after dispose/);
      expect(() => scope.once('hit', vi.fn())).toThrow(/after dispose/);
      expect(bus.listenerCount('hit')).toBe(0);
    });
  });
});
