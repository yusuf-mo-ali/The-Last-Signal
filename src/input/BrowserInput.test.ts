import { describe, expect, it, vi } from 'vitest';
import { boundKeyCodes, DEFAULT_BINDINGS } from '../config/input';
import { BrowserInput } from './BrowserInput';
import { InputState } from './InputState';

// Node provides real EventTarget, Event and AbortController, so listener registration, removal
// (AbortSignal) and preventDefault are exercised for real. DOM-specific fields are added per event.

class FakeDocument extends EventTarget {
  visibilityState = 'visible';
}

function event(type: string, fields: Record<string, unknown> = {}): Event {
  const e = new Event(type, { cancelable: true });
  Object.assign(e, { repeat: false, ctrlKey: false, metaKey: false, altKey: false, ...fields });
  return e;
}

function setup(locked = true) {
  const win = new EventTarget();
  const doc = new FakeDocument();
  const canvas = new EventTarget();
  const input = new InputState();
  const reader = input.createReader();
  const lock = { locked };
  const browserInput = new BrowserInput({ window: win, document: doc, element: canvas }, input, {
    isPointerLocked: () => lock.locked,
    preventDefaultCodes: boundKeyCodes(DEFAULT_BINDINGS),
  });
  return { win, doc, canvas, input, reader, lock, browserInput };
}

describe('BrowserInput', () => {
  describe('keyboard', () => {
    it('forwards keys by physical code, whatever character the layout produces', () => {
      const { win, input } = setup();
      win.dispatchEvent(event('keydown', { code: 'KeyW', key: 'z' })); // AZERTY "z" key
      expect(input.isKeyDown('KeyW')).toBe(true);
      win.dispatchEvent(event('keyup', { code: 'KeyW', key: 'z' }));
      expect(input.isKeyDown('KeyW')).toBe(false);
    });

    it('ignores auto-repeat keydowns', () => {
      const { win, input, reader } = setup();
      win.dispatchEvent(event('keydown', { code: 'KeyW' }));
      reader.sample();
      win.dispatchEvent(event('keydown', { code: 'KeyW', repeat: true }));
      reader.sample();
      expect(reader.wasKeyPressed('KeyW')).toBe(false);
      expect(input.isKeyDown('KeyW')).toBe(true);
    });

    it('suppresses the browser default only for bound keys without modifiers', () => {
      const { win } = setup();
      const space = event('keydown', { code: 'Space' });
      const unbound = event('keydown', { code: 'KeyQ' });
      const ctrlR = event('keydown', { code: 'KeyR', ctrlKey: true }); // browser reload
      const metaW = event('keydown', { code: 'KeyW', metaKey: true });
      for (const e of [space, unbound, ctrlR, metaW]) {
        win.dispatchEvent(e);
      }
      expect(space.defaultPrevented).toBe(true);
      expect(unbound.defaultPrevented).toBe(false);
      expect(ctrlR.defaultPrevented).toBe(false);
      expect(metaW.defaultPrevented).toBe(false);
    });

    it('leaves keys typed into text fields alone', () => {
      const { win, input } = setup();
      const field = new EventTarget();
      Object.assign(field, { tagName: 'INPUT' });
      const e = event('keydown', { code: 'KeyW' });
      // `target` is set by dispatch; simulate a keydown bubbling from a text field.
      Object.defineProperty(e, 'target', { value: field });
      win.dispatchEvent(e);
      expect(input.isKeyDown('KeyW')).toBe(false);
      expect(e.defaultPrevented).toBe(false);
    });
  });

  describe('mouse', () => {
    it('forwards buttons, motion and wheel only while the pointer is locked', () => {
      const { doc, canvas, input, reader, lock } = setup(false);
      canvas.dispatchEvent(event('mousedown', { button: 0 }));
      doc.dispatchEvent(event('mousemove', { movementX: 50, movementY: 5 }));
      const wheel = event('wheel', { deltaY: 100, deltaMode: 0 });
      canvas.dispatchEvent(wheel);
      reader.sample();
      expect(input.isButtonDown(0)).toBe(false); // the click that acquires the lock is not a shot
      expect(reader.mouseDeltaX).toBe(0);
      expect(reader.wheelStepsDown).toBe(0);
      expect(wheel.defaultPrevented).toBe(false); // page may scroll while unlocked

      lock.locked = true;
      canvas.dispatchEvent(event('mousedown', { button: 0 }));
      doc.dispatchEvent(event('mousemove', { movementX: 7, movementY: -3 }));
      doc.dispatchEvent(event('mousemove', { movementX: 2, movementY: 1 }));
      const lockedWheel = event('wheel', { deltaY: 100, deltaMode: 0 });
      canvas.dispatchEvent(lockedWheel);
      reader.sample();
      expect(reader.wasButtonPressed(0)).toBe(true);
      expect(reader.mouseDeltaX).toBe(9);
      expect(reader.mouseDeltaY).toBe(-2);
      expect(reader.wheelStepsDown).toBe(1);
      expect(lockedWheel.defaultPrevented).toBe(true);
    });

    it('always forwards button releases, so a held button never sticks after the lock is lost', () => {
      const { win, canvas, input, lock } = setup(true);
      canvas.dispatchEvent(event('mousedown', { button: 0 }));
      lock.locked = false;
      win.dispatchEvent(event('mouseup', { button: 0 }));
      expect(input.isButtonDown(0)).toBe(false);
    });

    it('suppresses the canvas context menu and the back/forward side buttons', () => {
      const { canvas } = setup();
      const menu = event('contextmenu');
      const back = event('mousedown', { button: 3 });
      const forwardClick = event('auxclick', { button: 4 });
      const middle = event('auxclick', { button: 1 });
      for (const e of [menu, back, forwardClick, middle]) {
        canvas.dispatchEvent(e);
      }
      expect(menu.defaultPrevented).toBe(true);
      expect(back.defaultPrevented).toBe(true);
      expect(forwardClick.defaultPrevented).toBe(true);
      expect(middle.defaultPrevented).toBe(false);
    });
  });

  describe('focus and visibility', () => {
    it('releases everything and notifies on window blur', () => {
      const { win, input, browserInput } = setup();
      const onFocusLost = vi.fn();
      browserInput.onFocusLost(onFocusLost);
      win.dispatchEvent(event('keydown', { code: 'KeyW' }));

      win.dispatchEvent(event('blur'));

      expect(input.isKeyDown('KeyW')).toBe(false);
      expect(onFocusLost).toHaveBeenCalledOnce();
    });

    it('releases everything and notifies when the tab becomes hidden, not when it becomes visible', () => {
      const { win, doc, input, browserInput } = setup();
      const onHidden = vi.fn();
      browserInput.onHidden(onHidden);
      win.dispatchEvent(event('keydown', { code: 'ShiftLeft' }));

      doc.visibilityState = 'hidden';
      doc.dispatchEvent(event('visibilitychange'));
      expect(input.isKeyDown('ShiftLeft')).toBe(false);
      expect(onHidden).toHaveBeenCalledOnce();

      doc.visibilityState = 'visible';
      doc.dispatchEvent(event('visibilitychange'));
      expect(onHidden).toHaveBeenCalledOnce();
    });

    it('stops notifying a removed listener', () => {
      const { win, browserInput } = setup();
      const listener = vi.fn();
      const remove = browserInput.onFocusLost(listener);
      remove();
      win.dispatchEvent(event('blur'));
      expect(listener).not.toHaveBeenCalled();
    });
  });

  it('dispose() removes every DOM listener', () => {
    const { win, doc, canvas, input, reader, browserInput } = setup(true);
    const onFocusLost = vi.fn();
    browserInput.onFocusLost(onFocusLost);
    browserInput.dispose();

    win.dispatchEvent(event('keydown', { code: 'KeyW' }));
    canvas.dispatchEvent(event('mousedown', { button: 0 }));
    doc.dispatchEvent(event('mousemove', { movementX: 5, movementY: 5 }));
    const menu = event('contextmenu');
    canvas.dispatchEvent(menu);
    win.dispatchEvent(event('blur'));
    reader.sample();

    expect(input.isKeyDown('KeyW')).toBe(false);
    expect(input.isButtonDown(0)).toBe(false);
    expect(reader.mouseDeltaX).toBe(0);
    expect(menu.defaultPrevented).toBe(false);
    expect(onFocusLost).not.toHaveBeenCalled();
  });
});
