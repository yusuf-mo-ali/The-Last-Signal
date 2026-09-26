import { afterEach, describe, expect, it, vi } from 'vitest';
import { PointerLock, type PointerLockDocument, type PointerLockElement } from './PointerLock';

type Behaviour =
  | 'lock' // modern API: resolves and locks
  | 'not-supported' // rejects with NotSupportedError (raw input unavailable)
  | 'security' // rejects, e.g. Chromium re-lock cooldown after Esc
  | 'legacy-lock' // returns undefined, then fires pointerlockchange
  | 'legacy-error' // returns undefined, then fires pointerlockerror
  | 'legacy-silent'; // returns undefined and never answers

class FakeDocument extends EventTarget implements PointerLockDocument {
  pointerLockElement: unknown = null;
  exitPointerLock = vi.fn(() => {
    this.setLocked(null);
  });

  setLocked(element: unknown): void {
    this.pointerLockElement = element;
    this.dispatchEvent(new Event('pointerlockchange'));
  }
}

class FakeCanvas implements PointerLockElement {
  readonly calls: ({ unadjustedMovement?: boolean } | undefined)[] = [];
  behaviours: Behaviour[] = [];

  private readonly doc: FakeDocument;

  constructor(doc: FakeDocument) {
    this.doc = doc;
  }

  requestPointerLock(options?: { unadjustedMovement?: boolean }): Promise<void> | undefined {
    this.calls.push(options);
    const behaviour = this.behaviours.shift() ?? 'lock';
    switch (behaviour) {
      case 'lock':
        this.doc.setLocked(this);
        return Promise.resolve();
      case 'not-supported':
        return Promise.reject(new DOMException('raw input unavailable', 'NotSupportedError'));
      case 'security':
        return Promise.reject(
          new DOMException('The user has exited the lock before this request', 'SecurityError'),
        );
      case 'legacy-lock':
        queueMicrotask(() => {
          this.doc.setLocked(this);
        });
        return undefined;
      case 'legacy-error':
        queueMicrotask(() => this.doc.dispatchEvent(new Event('pointerlockerror')));
        return undefined;
      case 'legacy-silent':
        return undefined;
    }
  }
}

function setup(...behaviours: Behaviour[]) {
  const doc = new FakeDocument();
  const canvas = new FakeCanvas(doc);
  canvas.behaviours = behaviours;
  const lock = new PointerLock(canvas, doc, { timeoutMs: 50 });
  return { doc, canvas, lock };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('PointerLock', () => {
  it('requests raw (unadjusted) mouse input first and reports the lock', async () => {
    const { canvas, lock } = setup('lock');
    const result = await lock.request();
    expect(result).toEqual({ locked: true, rawInput: true });
    expect(canvas.calls).toEqual([{ unadjustedMovement: true }]);
    expect(lock.isLocked).toBe(true);
  });

  it('issues the browser request synchronously, inside the user gesture', () => {
    const { canvas, lock } = setup('lock');
    void lock.request();
    expect(canvas.calls).toHaveLength(1); // before any await
  });

  it('falls back to normal mouse input where raw input is unsupported', async () => {
    const { canvas, lock } = setup('not-supported', 'lock');
    const result = await lock.request();
    expect(result).toEqual({ locked: true, rawInput: false });
    expect(canvas.calls).toEqual([{ unadjustedMovement: true }, undefined]);
    expect(lock.rawInput).toBe(false);
  });

  it('reports a refused request instead of throwing (Chromium re-lock cooldown after Esc)', async () => {
    const { canvas, lock } = setup('security');
    const result = await lock.request();
    expect(result.locked).toBe(false);
    expect(result).toMatchObject({ locked: false, reason: 'rejected' });
    expect(lock.isLocked).toBe(false);
    expect(canvas.calls).toHaveLength(1); // a refusal is not retried without raw input
  });

  it('succeeds on a later click after a refusal', async () => {
    const { lock } = setup('security', 'lock');
    expect((await lock.request()).locked).toBe(false);
    expect((await lock.request()).locked).toBe(true);
  });

  it('shares one attempt between concurrent requests (double click)', async () => {
    const { canvas, lock } = setup('legacy-lock');
    const [a, b] = await Promise.all([lock.request(), lock.request()]);
    expect(a.locked && b.locked).toBe(true);
    expect(canvas.calls).toHaveLength(1);
  });

  it('returns immediately when already locked', async () => {
    const { canvas, lock } = setup('lock');
    await lock.request();
    const again = await lock.request();
    expect(again.locked).toBe(true);
    expect(canvas.calls).toHaveLength(1);
  });

  describe('older, event-only browsers', () => {
    it('resolves on pointerlockchange', async () => {
      const { lock } = setup('legacy-lock');
      expect((await lock.request()).locked).toBe(true);
    });

    it('reports pointerlockerror as rejected', async () => {
      const { lock } = setup('legacy-error');
      const result = await lock.request();
      expect(result).toMatchObject({ locked: false, reason: 'rejected' });
    });

    it('times out when the browser never answers', async () => {
      vi.useFakeTimers();
      const { lock } = setup('legacy-silent');
      const pending = lock.request();
      await vi.advanceTimersByTimeAsync(60);
      const result = await pending;
      expect(result).toMatchObject({ locked: false, reason: 'timeout' });
    });
  });

  describe('lock changes', () => {
    it('notifies listeners when the lock is gained and lost (e.g. Esc)', async () => {
      const { doc, lock } = setup('lock');
      const changes: boolean[] = [];
      lock.onLockChange((locked) => changes.push(locked));

      await lock.request();
      doc.setLocked(null); // the browser released the lock (Esc, focus loss)

      expect(changes).toEqual([true, false]);
      expect(lock.isLocked).toBe(false);
    });

    it('treats a lock on some other element as not ours', () => {
      const { doc, lock } = setup();
      doc.setLocked({});
      expect(lock.isLocked).toBe(false);
    });

    it('exit() releases the lock only when held', async () => {
      const { doc, lock } = setup('lock');
      lock.exit();
      expect(doc.exitPointerLock).not.toHaveBeenCalled();
      await lock.request();
      lock.exit();
      expect(doc.exitPointerLock).toHaveBeenCalledOnce();
      expect(lock.isLocked).toBe(false);
    });

    it('stops notifying after unsubscribe and after dispose', async () => {
      const { doc, lock } = setup('lock', 'lock');
      const removed = vi.fn();
      const kept = vi.fn();
      lock.onLockChange(removed)();
      lock.onLockChange(kept);
      await lock.request();
      expect(removed).not.toHaveBeenCalled();
      expect(kept).toHaveBeenCalledTimes(1);

      lock.dispose();
      doc.setLocked(null);
      expect(kept).toHaveBeenCalledTimes(1);
    });
  });
});
