/**
 * Pointer Lock wrapper (D-017). Browser objects are injected, typed structurally, so this module
 * never reaches for globals and runs in Node tests with fakes.
 *
 * - `request()` must be called from a user-gesture handler (a click). It asks for raw, unaccelerated
 *   mouse input (`unadjustedMovement`) and falls back to normal input where that is unsupported.
 * - Refusals never throw. Chromium, for example, refuses a re-lock requested shortly after the user
 *   left the lock with Esc. The result says so, and the caller shows "click to resume" again.
 * - Works with both the modern Promise-returning API and the older event-only API.
 */

/** The element that captures the pointer (the game canvas). */
export interface PointerLockElement {
  requestPointerLock(options?: { unadjustedMovement?: boolean }): Promise<void> | undefined;
}

/** The parts of `Document` the wrapper uses. */
export interface PointerLockDocument {
  readonly pointerLockElement: unknown;
  exitPointerLock(): void;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

export type PointerLockFailure = 'rejected' | 'timeout';

export type PointerLockResult =
  | { readonly locked: true; readonly rawInput: boolean }
  | { readonly locked: false; readonly reason: PointerLockFailure; readonly error?: unknown };

export interface PointerLockOptions {
  /** How long to wait for the event-only API to answer, in ms. Default 1000. */
  readonly timeoutMs?: number;
}

export class PointerLock {
  private readonly element: PointerLockElement;
  private readonly doc: PointerLockDocument;
  private readonly timeoutMs: number;
  private pending: Promise<PointerLockResult> | null = null;
  private raw = false;
  private readonly listeners = new Set<(locked: boolean) => void>();

  constructor(
    element: PointerLockElement,
    doc: PointerLockDocument,
    options: PointerLockOptions = {},
  ) {
    this.element = element;
    this.doc = doc;
    this.timeoutMs = options.timeoutMs ?? 1000;
    doc.addEventListener('pointerlockchange', this.onChange);
  }

  get isLocked(): boolean {
    return this.doc.pointerLockElement === this.element;
  }

  /** True if the current (or last) lock delivers raw, unaccelerated mouse movement. */
  get rawInput(): boolean {
    return this.raw;
  }

  /**
   * Requests the lock. Call from inside a user-gesture handler: the browser request is issued
   * synchronously, before this returns. Concurrent calls share one attempt.
   */
  request(): Promise<PointerLockResult> {
    if (this.isLocked) {
      return Promise.resolve({ locked: true, rawInput: this.raw });
    }
    this.pending ??= this.acquire().finally(() => {
      this.pending = null;
    });
    return this.pending;
  }

  /** Releases the lock if held. */
  exit(): void {
    if (this.isLocked) {
      this.doc.exitPointerLock();
    }
  }

  /** Called with the new state whenever the lock is gained or lost. */
  onLockChange(listener: (locked: boolean) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  dispose(): void {
    this.doc.removeEventListener('pointerlockchange', this.onChange);
    this.listeners.clear();
  }

  private readonly onChange = (): void => {
    const locked = this.isLocked;
    for (const listener of [...this.listeners]) {
      listener(locked);
    }
  };

  private async acquire(): Promise<PointerLockResult> {
    try {
      // Runs synchronously up to the first await, so the request stays inside the user gesture.
      await this.attempt(true);
      this.raw = true;
    } catch (error) {
      if (!isNotSupported(error)) {
        return failure(error);
      }
      try {
        // Raw input unsupported on this platform: retry with default mouse input.
        await this.attempt(false);
        this.raw = false;
      } catch (fallbackError) {
        return failure(fallbackError);
      }
    }
    return this.isLocked
      ? { locked: true, rawInput: this.raw }
      : { locked: false, reason: 'rejected' };
  }

  private attempt(raw: boolean): Promise<void> {
    const result = raw
      ? this.element.requestPointerLock({ unadjustedMovement: true })
      : this.element.requestPointerLock();
    // Older browsers return nothing and answer with events instead.
    return result ?? this.waitForEvents();
  }

  private waitForEvents(): Promise<void> {
    return new Promise((resolve, reject) => {
      const cleanup = (): void => {
        clearTimeout(timer);
        this.doc.removeEventListener('pointerlockchange', onChange);
        this.doc.removeEventListener('pointerlockerror', onError);
      };
      const onChange = (): void => {
        if (this.isLocked) {
          cleanup();
          resolve();
        }
      };
      const onError = (): void => {
        cleanup();
        reject(new Error('pointerlockerror'));
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new PointerLockTimeout());
      }, this.timeoutMs);
      this.doc.addEventListener('pointerlockchange', onChange);
      this.doc.addEventListener('pointerlockerror', onError);
    });
  }
}

class PointerLockTimeout extends Error {
  constructor() {
    super('Pointer lock request timed out');
    this.name = 'PointerLockTimeout';
  }
}

function isNotSupported(error: unknown): boolean {
  return error instanceof Error && error.name === 'NotSupportedError';
}

function failure(error: unknown): PointerLockResult {
  return {
    locked: false,
    reason: error instanceof PointerLockTimeout ? 'timeout' : 'rejected',
    error,
  };
}
