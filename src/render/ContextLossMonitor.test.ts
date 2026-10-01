import { afterEach, describe, expect, it, vi } from 'vitest';
import { ContextLossMonitor, type ContextLossEvent } from './ContextLossMonitor';

function setup(restoreTimeoutMs = 10_000) {
  const canvas = new EventTarget();
  const monitor = new ContextLossMonitor(canvas, { restoreTimeoutMs });
  const events: ContextLossEvent['type'][] = [];
  monitor.onChange((e) => events.push(e.type));
  const lose = () => {
    const e = new Event('webglcontextlost', { cancelable: true });
    canvas.dispatchEvent(e);
    return e;
  };
  const restore = () => canvas.dispatchEvent(new Event('webglcontextrestored'));
  return { canvas, monitor, events, lose, restore };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('ContextLossMonitor', () => {
  it('reports loss and restoration', () => {
    const { monitor, events, lose, restore } = setup();
    expect(monitor.lost).toBe(false);

    lose();
    expect(monitor.lost).toBe(true);
    restore();
    expect(monitor.lost).toBe(false);

    expect(events).toEqual(['lost', 'restored']);
    expect(monitor.lossCount).toBe(1);
  });

  it('calls preventDefault on the loss event, which is what lets the browser restore it', () => {
    const { lose } = setup();
    expect(lose().defaultPrevented).toBe(true);
  });

  it('ignores duplicate losses and restores without a loss', () => {
    const { events, lose, restore } = setup();
    restore();
    lose();
    lose();
    restore();
    restore();
    expect(events).toEqual(['lost', 'restored']);
  });

  it('emits restore-timeout when the context does not come back in time', () => {
    vi.useFakeTimers();
    const { events, lose } = setup(5000);
    lose();
    vi.advanceTimersByTime(4999);
    expect(events).toEqual(['lost']);
    vi.advanceTimersByTime(1);
    expect(events).toEqual(['lost', 'restore-timeout']);
  });

  it('does not time out once restored, and re-arms for the next loss', () => {
    vi.useFakeTimers();
    const { events, lose, restore } = setup(1000);
    lose();
    restore();
    vi.advanceTimersByTime(5000);
    lose();
    vi.advanceTimersByTime(1000);
    expect(events).toEqual(['lost', 'restored', 'lost', 'restore-timeout']);
  });

  it('stops listening and cancels its timer on dispose', () => {
    vi.useFakeTimers();
    const { monitor, events, lose } = setup(1000);
    lose();
    monitor.dispose();
    vi.advanceTimersByTime(5000);
    lose();
    expect(events).toEqual(['lost']);
  });
});
