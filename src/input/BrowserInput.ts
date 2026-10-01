/**
 * Translates DOM events into `InputState` calls (D-017). The window, document and canvas are
 * injected, so this module never touches browser globals and its tests run on Node EventTargets.
 *
 * Behaviour:
 * - Keys by `KeyboardEvent.code` (physical position); auto-repeat ignored.
 * - Mouse buttons, movement and wheel reach the game only while the pointer is locked. A click
 *   made to *acquire* the lock is therefore never seen as a shot.
 * - Default browser actions are suppressed only where they would interfere: bound keys without
 *   Ctrl/Meta/Alt (so browser shortcuts keep working), the canvas context menu, the wheel while
 *   locked, and the back/forward side buttons.
 * - Losing window focus or hiding the tab releases everything held (no stuck keys) and notifies
 *   listeners, which pause the game.
 */

import type { InputState } from './InputState';

export interface BrowserInputTargets {
  /** Receives keyboard events, button releases anywhere, and `blur`. */
  readonly window: EventTarget;
  /** Receives `mousemove` while locked and `visibilitychange`. */
  readonly document: EventTarget & { readonly visibilityState: string };
  /** The game canvas: button presses, wheel, context menu. */
  readonly element: EventTarget;
}

export interface BrowserInputOptions {
  /** Whether the pointer is currently locked to the game canvas. */
  readonly isPointerLocked: () => boolean;
  /** Key codes whose default browser action is suppressed (normally every bound key). */
  readonly preventDefaultCodes: ReadonlySet<string>;
}

/** Mouse side buttons, which browsers map to history back/forward. */
const NAVIGATION_BUTTONS: ReadonlySet<number> = new Set([3, 4]);

export class BrowserInput {
  private readonly state: InputState;
  private readonly targets: BrowserInputTargets;
  private readonly options: BrowserInputOptions;
  private readonly abort = new AbortController();
  private readonly focusLostListeners = new Set<() => void>();
  private readonly hiddenListeners = new Set<() => void>();

  constructor(targets: BrowserInputTargets, state: InputState, options: BrowserInputOptions) {
    this.targets = targets;
    this.state = state;
    this.options = options;

    const { signal } = this.abort;
    const on = (
      target: EventTarget,
      type: string,
      handler: (event: Event) => void,
      passive = true,
    ) => {
      target.addEventListener(type, handler, { signal, passive });
    };

    on(targets.window, 'keydown', this.onKeyDown, false);
    on(targets.window, 'keyup', this.onKeyUp, false);
    on(targets.element, 'mousedown', this.onMouseDown, false);
    on(targets.window, 'mouseup', this.onMouseUp, false);
    on(targets.element, 'auxclick', this.onAuxClick, false);
    on(targets.element, 'contextmenu', this.onContextMenu, false);
    on(targets.document, 'mousemove', this.onMouseMove);
    on(targets.element, 'wheel', this.onWheel, false);
    on(targets.window, 'blur', this.onBlur);
    on(targets.document, 'visibilitychange', this.onVisibilityChange);
  }

  /** Called when the window loses focus. */
  onFocusLost(listener: () => void): () => void {
    this.focusLostListeners.add(listener);
    return () => this.focusLostListeners.delete(listener);
  }

  /** Called when the tab or window becomes hidden. */
  onHidden(listener: () => void): () => void {
    this.hiddenListeners.add(listener);
    return () => this.hiddenListeners.delete(listener);
  }

  /** Removes every DOM listener. */
  dispose(): void {
    this.abort.abort();
    this.focusLostListeners.clear();
    this.hiddenListeners.clear();
  }

  private readonly onKeyDown = (event: Event): void => {
    const e = event as KeyboardEvent;
    if (isEditable(e.target)) {
      return;
    }
    if (this.shouldSuppressKey(e)) {
      e.preventDefault();
    }
    if (!e.repeat) {
      this.state.keyDown(e.code);
    }
  };

  private readonly onKeyUp = (event: Event): void => {
    const e = event as KeyboardEvent;
    if (this.shouldSuppressKey(e)) {
      e.preventDefault();
    }
    this.state.keyUp(e.code);
  };

  private readonly onMouseDown = (event: Event): void => {
    const e = event as MouseEvent;
    if (NAVIGATION_BUTTONS.has(e.button)) {
      e.preventDefault();
    }
    if (this.options.isPointerLocked()) {
      this.state.buttonDown(e.button);
    }
  };

  private readonly onMouseUp = (event: Event): void => {
    const e = event as MouseEvent;
    if (NAVIGATION_BUTTONS.has(e.button) && this.options.isPointerLocked()) {
      e.preventDefault();
    }
    // Always forwarded: a button pressed while locked must be released even if the lock was lost.
    this.state.buttonUp(e.button);
  };

  private readonly onAuxClick = (event: Event): void => {
    if (NAVIGATION_BUTTONS.has((event as MouseEvent).button)) {
      event.preventDefault();
    }
  };

  private readonly onContextMenu = (event: Event): void => {
    event.preventDefault();
  };

  private readonly onMouseMove = (event: Event): void => {
    if (this.options.isPointerLocked()) {
      const e = event as MouseEvent;
      this.state.mouseMove(e.movementX, e.movementY);
    }
  };

  private readonly onWheel = (event: Event): void => {
    if (this.options.isPointerLocked()) {
      const e = event as WheelEvent;
      e.preventDefault();
      this.state.wheel(e.deltaY, e.deltaMode);
    }
  };

  private readonly onBlur = (): void => {
    this.state.releaseAll();
    notify(this.focusLostListeners);
  };

  private readonly onVisibilityChange = (): void => {
    if (this.targets.document.visibilityState === 'hidden') {
      this.state.releaseAll();
      notify(this.hiddenListeners);
    }
  };

  private shouldSuppressKey(e: KeyboardEvent): boolean {
    return this.options.preventDefaultCodes.has(e.code) && !e.ctrlKey && !e.metaKey && !e.altKey;
  }
}

function notify(listeners: ReadonlySet<() => void>): void {
  for (const listener of [...listeners]) {
    listener();
  }
}

/** Text fields keep their keys (future settings and name-entry screens). */
function isEditable(target: EventTarget | null): boolean {
  if (target === null || typeof target !== 'object') {
    return false;
  }
  const el = target as { tagName?: unknown; isContentEditable?: unknown };
  return (
    el.isContentEditable === true ||
    el.tagName === 'INPUT' ||
    el.tagName === 'TEXTAREA' ||
    el.tagName === 'SELECT'
  );
}
