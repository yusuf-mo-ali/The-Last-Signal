/**
 * Keyboard, mouse, pointer lock and auto-pause (Phase 0 acceptance: input system works; D-034).
 *
 * Headless Chromium cannot reproduce a few browser behaviours (TESTING.md "Headless limits"):
 * Esc does not release the lock, the re-lock cooldown does not occur, and switching tabs emits no
 * blur/visibility events. Those paths are driven through the same code here and are on the manual
 * QA checklist.
 */

import type { InputReader } from '../../src/input/InputState';
import {
  enterRun,
  expect,
  frames,
  isDev,
  isPointerLocked,
  lockPrompt,
  openGame,
  test,
} from './helpers';

test('suppresses browser defaults only where they would interfere', async ({ page, issues }) => {
  await openGame(page);
  await page.evaluate(() => {
    const seen: Record<string, boolean> = {};
    (window as unknown as { __prevented: typeof seen }).__prevented = seen;
    window.addEventListener('keydown', (e) => {
      seen[e.code] = e.defaultPrevented;
    });
  });
  await page.keyboard.press('Space');
  await page.keyboard.press('KeyQ');
  const prevented = await page.evaluate(
    () => (window as unknown as { __prevented: Record<string, boolean> }).__prevented,
  );
  expect(prevented).toEqual({ Space: true, KeyQ: false });

  const menuPrevented = await page.evaluate(() => {
    const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    document.querySelector('canvas')!.dispatchEvent(e);
    return e.defaultPrevented;
  });
  expect(menuPrevented).toBe(true);
  expect(issues.problems()).toEqual([]);
});

test('reads keys by physical position, with press/held/release edges', async ({
  page,
  context,
  issues,
}, testInfo) => {
  test.skip(!isDev(testInfo), 'needs the development inspection interface');
  await openGame(page);

  await page.keyboard.down('KeyW');
  expect(await page.evaluate(() => window.tls!.inspect().frameActions.isDown('moveForward'))).toBe(
    true,
  );
  await page.keyboard.up('KeyW');

  // AZERTY: the key in the W position types "z" but its code is still KeyW.
  const cdp = await context.newCDPSession(page);
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    code: 'KeyW',
    key: 'z',
    text: 'z',
    windowsVirtualKeyCode: 90,
  });
  const azerty = await page.evaluate(() => {
    const { input, frameActions } = window.tls!.inspect();
    return {
      KeyW: input.isKeyDown('KeyW'),
      KeyZ: input.isKeyDown('KeyZ'),
      forward: frameActions.isDown('moveForward'),
    };
  });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'KeyW', key: 'z' });
  expect(azerty).toEqual({ KeyW: true, KeyZ: false, forward: true });

  await page.evaluate(() => {
    const reader = window.tls!.inspect().input.createReader();
    (window as unknown as { __reader: typeof reader }).__reader = reader;
  });
  const sample = () =>
    page.evaluate(() => {
      const r = (window as unknown as { __reader: InputReader }).__reader;
      r.sample();
      return { pressed: r.wasKeyPressed('KeyR'), released: r.wasKeyReleased('KeyR') };
    });
  await page.keyboard.down('KeyR');
  expect(await sample()).toEqual({ pressed: true, released: false });
  expect(await sample()).toEqual({ pressed: false, released: false });
  await page.keyboard.up('KeyR');
  expect(await sample()).toEqual({ pressed: false, released: true });

  expect(issues.problems()).toEqual([]);
});

test('captures the mouse on click; the capturing click is not a shot', async ({
  page,
  issues,
}, testInfo) => {
  await openGame(page);
  await page.click('.lock-prompt');
  await frames(page, 4);
  expect(await isPointerLocked(page)).toBe(true);
  expect((await lockPrompt(page))?.hidden).toBe(true);

  if (isDev(testInfo)) {
    const state = await page.evaluate(() => {
      const { input, pointerLock } = window.tls!.inspect();
      return { fireHeld: input.isButtonDown(0), raw: pointerLock.rawInput };
    });
    expect(state.fireHeld).toBe(false);
    expect(typeof state.raw).toBe('boolean');

    // Mouse motion, button and wheel while locked.
    await page.evaluate(() => {
      const reader = window.tls!.inspect().input.createReader();
      (window as unknown as { __reader: typeof reader }).__reader = reader;
      reader.sample();
    });
    await page.mouse.move(700, 400);
    await page.mouse.move(760, 380);
    const sample = () =>
      page.evaluate(() => {
        const r = (window as unknown as { __reader: InputReader }).__reader;
        r.sample();
        return {
          dx: r.mouseDeltaX,
          dy: r.mouseDeltaY,
          fire: r.wasButtonPressed(0),
          wheel: r.wheelStepsDown,
        };
      });
    const moved = await sample();
    expect(moved.dx !== 0 || moved.dy !== 0, 'motion accumulated over the window').toBe(true);
    expect(await sample(), 'and reset for the next window').toMatchObject({ dx: 0, dy: 0 });
    await page.mouse.down();
    await page.mouse.up();
    await page.mouse.wheel(0, 100);
    await frames(page, 2);
    expect(await sample()).toMatchObject({ fire: true, wheel: 1 });
  }
  expect(issues.problems()).toEqual([]);
});

test('losing the lock pauses; a refused re-lock says so; a later click resumes', async ({
  page,
  issues,
}, testInfo) => {
  const dev = isDev(testInfo);
  await openGame(page);
  await page.click('.lock-prompt'); // from the main menu: capture the mouse and start a run
  await frames(page, 4);
  expect(await lockPrompt(page)).toEqual({ mode: 'hidden', hidden: true });

  // Headless Esc does not release the lock; exitPointerLock fires the same pointerlockchange.
  await page.evaluate(() => {
    document.exitPointerLock();
  });
  await frames(page, 4);
  expect(await lockPrompt(page)).toEqual({ mode: 'paused', hidden: false });
  if (dev) {
    expect(
      await page.evaluate(() => {
        const { game } = window.tls!.inspect();
        return [game.state.current, game.state.pausedState, game.time.scale];
      }),
    ).toEqual(['PAUSED', 'WAVE_ACTIVE', 0]);
  }

  // Chromium's real refusal: the canvas rejects the next request with its SecurityError.
  await page.evaluate(() => {
    const canvas = document.querySelector('canvas')!;
    const original = canvas.requestPointerLock.bind(canvas);
    canvas.requestPointerLock = () => {
      canvas.requestPointerLock = original;
      return Promise.reject(
        new DOMException(
          'The user has exited the lock before this request was completed.',
          'SecurityError',
        ),
      );
    };
  });
  await page.click('.lock-prompt');
  await frames(page, 4);
  expect(await isPointerLocked(page)).toBe(false);
  expect(await lockPrompt(page)).toEqual({ mode: 'refused', hidden: false });

  await page.click('.lock-prompt');
  await frames(page, 4);
  expect(await isPointerLocked(page)).toBe(true);
  if (dev) {
    expect(
      await page.evaluate(() => {
        const { game, input } = window.tls!.inspect();
        return [game.state.current, input.isButtonDown(0)];
      }),
      'resumes the same phase; the resume click is not a shot',
    ).toEqual(['WAVE_ACTIVE', false]);
  }
  expect(issues.problems()).toEqual([]);
});

test('window blur and a hidden tab pause the run and release held keys', async ({
  page,
  issues,
}, testInfo) => {
  test.skip(!isDev(testInfo), 'needs the development inspection interface');
  await openGame(page);
  await enterRun(page);

  const cycle = async (fire: 'blur' | 'hidden') => {
    await page.evaluate(() => window.tls!.inspect().game.state.resume());
    await page.keyboard.down('ShiftLeft');
    // Headless emits no real blur/visibility on tab switch; dispatch the events the browser would.
    await page.evaluate((kind) => {
      if (kind === 'blur') {
        window.dispatchEvent(new Event('blur'));
      } else {
        Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
        delete (document as unknown as { visibilityState?: unknown }).visibilityState;
      }
    }, fire);
    const result = await page.evaluate(() => {
      const { game, input } = window.tls!.inspect();
      return { state: game.state.current, shiftHeld: input.isKeyDown('ShiftLeft') };
    });
    await page.keyboard.up('ShiftLeft');
    return result;
  };

  expect(await cycle('blur')).toEqual({ state: 'PAUSED', shiftHeld: false });
  expect(await cycle('hidden')).toEqual({ state: 'PAUSED', shiftHeld: false });
  expect(issues.problems()).toEqual([]);
});
