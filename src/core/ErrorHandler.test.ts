import { describe, expect, it, vi } from 'vitest';
import { describeError, ErrorHandler } from './ErrorHandler';

function errorEvent(fields: Record<string, unknown>): Event {
  return Object.assign(new Event('error', { cancelable: true }), fields);
}
function rejectionEvent(reason: unknown): Event {
  return Object.assign(new Event('unhandledrejection', { cancelable: true }), { reason });
}

describe('ErrorHandler', () => {
  it('treats an uncaught error as fatal and reports it once', () => {
    const onFatal = vi.fn();
    const handler = new ErrorHandler({ onFatal });
    const target = new EventTarget();
    handler.attach(target);
    const boom = new TypeError('x is undefined');

    target.dispatchEvent(errorEvent({ error: boom, message: 'Uncaught TypeError' }));

    expect(onFatal).toHaveBeenCalledOnce();
    expect(onFatal.mock.calls[0]?.[0]).toMatchObject({
      id: 1,
      source: 'error',
      message: 'TypeError: x is undefined',
      error: boom,
    });
    expect(handler.fatal?.error).toBe(boom);
  });

  it('treats an unhandled promise rejection as fatal', () => {
    const onFatal = vi.fn();
    const handler = new ErrorHandler({ onFatal });
    const target = new EventTarget();
    handler.attach(target);

    target.dispatchEvent(rejectionEvent(new Error('network down')));

    expect(onFatal).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'unhandledrejection', message: 'Error: network down' }),
    );
  });

  it('does not swallow browser errors: default handling (console logging) is left in place', () => {
    const handler = new ErrorHandler({ onFatal: vi.fn() });
    const target = new EventTarget();
    handler.attach(target);
    const error = errorEvent({ error: new Error('boom') });
    const rejection = rejectionEvent('nope');

    target.dispatchEvent(error);
    target.dispatchEvent(rejection);

    expect(error.defaultPrevented).toBe(false);
    expect(rejection.defaultPrevented).toBe(false);
  });

  it('falls back to the event message when there is no error object (e.g. cross-origin "Script error.")', () => {
    const handler = new ErrorHandler({ onFatal: vi.fn() });
    const target = new EventTarget();
    handler.attach(target);
    target.dispatchEvent(errorEvent({ error: null, message: 'Script error.' }));
    expect(handler.fatal?.message).toBe('Script error.');
  });

  it('keeps later errors without showing a second screen', () => {
    const onFatal = vi.fn();
    const handler = new ErrorHandler({ onFatal, maxReports: 3 });
    const target = new EventTarget();
    handler.attach(target);

    for (let i = 1; i <= 5; i++) {
      target.dispatchEvent(errorEvent({ error: new Error(`e${i}`) }));
    }

    expect(onFatal).toHaveBeenCalledOnce();
    expect(handler.fatal?.message).toBe('Error: e1');
    expect(handler.count).toBe(5);
    expect(handler.reports.map((r) => r.message)).toEqual(['Error: e3', 'Error: e4', 'Error: e5']);
  });

  it('logs errors passed to report(), since nothing else would', () => {
    const log = vi.fn();
    const onFatal = vi.fn();
    const handler = new ErrorHandler({ onFatal, log });
    const caught = new Error('renderer failed');

    const report = handler.report(caught);

    expect(report.source).toBe('report');
    expect(log).toHaveBeenCalledWith(report);
    expect(onFatal).toHaveBeenCalledWith(report);
  });

  it('logs to console.error by default for report()', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    new ErrorHandler({ onFatal: vi.fn() }).report(new Error('x'));
    expect(spy).toHaveBeenCalledOnce();
    spy.mockRestore();
  });

  it('survives an error screen that itself throws, and still logs both', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const handler = new ErrorHandler({
      onFatal: () => {
        throw new Error('screen broke');
      },
    });
    const target = new EventTarget();
    handler.attach(target);

    expect(() => target.dispatchEvent(errorEvent({ error: new Error('original') }))).not.toThrow();
    expect(handler.fatal?.message).toBe('Error: original');
    expect(spy).toHaveBeenCalledWith('ErrorHandler: onFatal threw', expect.any(Error));
    spy.mockRestore();
  });

  it('stops listening when detached', () => {
    const onFatal = vi.fn();
    const handler = new ErrorHandler({ onFatal });
    const target = new EventTarget();
    const detach = handler.attach(target);
    detach();
    target.dispatchEvent(errorEvent({ error: new Error('late') }));
    target.dispatchEvent(rejectionEvent('late'));
    expect(onFatal).not.toHaveBeenCalled();
  });
});

describe('describeError', () => {
  it('describes errors, strings and other values safely', () => {
    expect(describeError(new RangeError('bad'))).toBe('RangeError: bad');
    expect(describeError(new Error(''))).toBe('Error');
    expect(describeError('plain text')).toBe('plain text');
    expect(describeError(undefined)).toBe('Unknown error');
    expect(describeError(null)).toBe('Unknown error');
    expect(describeError({ code: 42 })).toBe('{"code":42}');
    expect(describeError('   ')).toBe('Unknown error');
  });

  it('never throws, even for values that cannot be serialised', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(describeError(cyclic)).toBe('Unknown error');
    expect(describeError(10n)).toBe('Unknown error');
  });

  it('trims long messages for the player', () => {
    const text = describeError('x'.repeat(1000), 50);
    expect(text).toHaveLength(50);
    expect(text.endsWith('…')).toBe(true);
  });
});
