/**
 * Tracks WebGL context loss and restoration on the game canvas (ARCHITECTURE.md §7.17, D-035).
 *
 * A GPU driver reset, too many contexts, or the OS reclaiming the GPU can take the context away at
 * any time. Calling `preventDefault()` on `webglcontextlost` tells the browser we will handle it,
 * which is what allows it to fire `webglcontextrestored` later. Until then nothing can be drawn;
 * the simulation is unaffected. If the context does not come back within the timeout, listeners
 * are told so the player can be offered a reload.
 *
 * The canvas is an injected EventTarget, so this runs in Node tests.
 */

export type ContextLossEvent =
  { readonly type: 'lost' } | { readonly type: 'restored' } | { readonly type: 'restore-timeout' };

export interface ContextLossMonitorOptions {
  /** How long to wait for restoration before emitting `restore-timeout`, in ms. */
  readonly restoreTimeoutMs: number;
}

export class ContextLossMonitor {
  private readonly canvas: EventTarget;
  private readonly restoreTimeoutMs: number;
  private readonly listeners = new Set<(event: ContextLossEvent) => void>();
  private isLost = false;
  private losses = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(canvas: EventTarget, options: ContextLossMonitorOptions) {
    this.canvas = canvas;
    this.restoreTimeoutMs = options.restoreTimeoutMs;
    canvas.addEventListener('webglcontextlost', this.onLost);
    canvas.addEventListener('webglcontextrestored', this.onRestored);
  }

  /** True between a context loss and its restoration. */
  get lost(): boolean {
    return this.isLost;
  }

  /** Context losses seen so far. */
  get lossCount(): number {
    return this.losses;
  }

  onChange(listener: (event: ContextLossEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispose(): void {
    this.clearTimer();
    this.canvas.removeEventListener('webglcontextlost', this.onLost);
    this.canvas.removeEventListener('webglcontextrestored', this.onRestored);
    this.listeners.clear();
  }

  private readonly onLost = (event: Event): void => {
    // Required for the browser to attempt a restore (three.js does this too; it is idempotent).
    event.preventDefault();
    if (this.isLost) {
      return;
    }
    this.isLost = true;
    this.losses++;
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.isLost) {
        this.emit({ type: 'restore-timeout' });
      }
    }, this.restoreTimeoutMs);
    this.emit({ type: 'lost' });
  };

  private readonly onRestored = (): void => {
    if (!this.isLost) {
      return;
    }
    this.isLost = false;
    this.clearTimer();
    this.emit({ type: 'restored' });
  };

  private emit(event: ContextLossEvent): void {
    for (const listener of [...this.listeners]) {
      listener(event);
    }
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
