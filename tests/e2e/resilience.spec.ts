/**
 * Error handling, missing WebGL 2 and WebGL context loss (Phase 0.5, D-035).
 */

import type { Page } from '@playwright/test';
import {
  canvasSize,
  enterRun,
  expect,
  frames,
  isDev,
  isPointerLocked,
  lockPrompt,
  openGame,
  pixelStats,
  statusScreen,
  test,
} from './helpers';

/** Loses/restores the context through WEBGL_lose_context (what `tls.loseContext()` does too). */
async function setContext(page: Page, action: 'lose' | 'restore'): Promise<void> {
  await page.evaluate((a) => {
    const w = window as unknown as { __ext?: WEBGL_lose_context | null };
    w.__ext ??= document
      .querySelector('canvas')!
      .getContext('webgl2')!
      .getExtension('WEBGL_lose_context');
    if (a === 'lose') {
      w.__ext!.loseContext();
    } else {
      w.__ext!.restoreContext();
    }
  }, action);
  await page.waitForTimeout(400);
}

test.describe('WebGL context loss', () => {
  test('pauses a run and stops drawing; restore redraws and the player resumes by clicking', async ({
    page,
    issues,
  }, testInfo) => {
    const dev = isDev(testInfo);
    await openGame(page);
    if (dev) {
      await enterRun(page);
      await page.click('.lock-prompt');
      await frames(page, 4);
    }

    await setContext(page, 'lose');
    expect(await statusScreen(page)).toMatchObject({ mode: 'context-lost', hidden: false });
    expect(await isPointerLocked(page)).toBe(false);
    if (dev) {
      const during = await page.evaluate(async () => {
        const { game, renderer } = window.tls!.inspect();
        const f0 = renderer.webgl.info.render.frame;
        const s0 = game.time.stepCount;
        await new Promise((r) => setTimeout(r, 400));
        return {
          lost: renderer.context.lost,
          state: game.state.current,
          running: game.isRunning,
          framesDrawn: renderer.webgl.info.render.frame - f0,
          steps: game.time.stepCount - s0,
        };
      });
      expect(during).toEqual({
        lost: true,
        state: 'PAUSED',
        running: true,
        framesDrawn: 0,
        steps: 0,
      });
    }

    await setContext(page, 'restore');
    await frames(page, 6);
    expect((await statusScreen(page))?.hidden).toBe(true);
    expect(await canvasSize(page)).toMatchObject({ width: 1366, height: 768 });
    const stats = await pixelStats(page);
    expect(stats.colors).toBeGreaterThan(20);
    expect(stats.red).toBeGreaterThan(0);

    if (dev) {
      expect(await lockPrompt(page)).toEqual({ mode: 'paused', hidden: false });
      await page.click('.lock-prompt');
      await frames(page, 4);
      const resumed = await page.evaluate(() => {
        const { game, testScene, renderer } = window.tls!.inspect();
        return {
          state: game.state.current,
          programs: renderer.webgl.info.programs?.length ?? 0,
          invariant:
            Math.abs(testScene.angle - testScene.steps * game.time.fixedDt * (Math.PI / 2)) < 1e-9,
        };
      });
      expect(resumed.state).toBe('WAVE_START');
      expect(resumed.programs).toBeGreaterThan(0);
      expect(resumed.invariant, 'simulation state intact').toBe(true);
    }
    // three.js reports loss/restore with console.log; only errors and warnings count.
    expect(issues.problems()).toEqual([]);
  });

  test('outside a run the simulation keeps stepping; after 10 s a reload is offered', async ({
    page,
    issues,
  }, testInfo) => {
    test.skip(!isDev(testInfo), 'needs the development inspection interface');
    test.slow();
    await openGame(page);
    await page.evaluate(() => window.tls!.loseContext());
    await page.waitForTimeout(300);
    const steps = await page.evaluate(async () => {
      const { game } = window.tls!.inspect();
      const s0 = game.time.stepCount;
      await new Promise((r) => setTimeout(r, 500));
      return { stepped: game.time.stepCount - s0, state: game.state.current };
    });
    expect(steps.state).toBe('MAIN_MENU');
    expect(steps.stepped).toBeGreaterThan(0);

    await page.waitForTimeout(10_300);
    expect(await statusScreen(page)).toMatchObject({
      mode: 'context-lost-timeout',
      hidden: false,
      action: 'Reload',
    });

    await page.evaluate(() => window.tls!.restoreContext());
    await page.waitForTimeout(500);
    expect((await statusScreen(page))?.hidden, 'a late restore still recovers').toBe(true);
    expect(issues.problems()).toEqual([]);
  });
});

test.describe('fatal errors', () => {
  for (const kind of ['frame', 'async', 'rejection'] as const) {
    test(`a ${kind} error stops the game and shows a safe error screen`, async ({
      page,
      issues,
    }, testInfo) => {
      const dev = isDev(testInfo);
      test.skip(!dev && kind === 'frame', 'throwing inside a frame needs tls.throwError()');
      await openGame(page);

      if (dev) {
        await page.evaluate((k) => window.tls!.throwError(k), kind);
      } else {
        await page.evaluate((k) => {
          const error = new Error(`Debug: forced ${k} error`);
          if (k === 'async') {
            setTimeout(() => {
              throw error;
            });
          } else {
            void Promise.reject(error);
          }
        }, kind);
      }
      await page.waitForTimeout(500);

      const screen = await statusScreen(page);
      expect(screen).toMatchObject({
        mode: 'error',
        hidden: false,
        title: 'Something went wrong',
        action: 'Reload',
        details: dev, // stack traces only in development builds
      });
      expect(screen?.message).toContain(`forced ${kind} error`);
      if (dev) {
        const stopped = await page.evaluate(async () => {
          const { game } = window.tls!.inspect();
          const s0 = game.time.stepCount;
          await new Promise((r) => setTimeout(r, 300));
          return { running: game.isRunning, steps: game.time.stepCount - s0 };
        });
        expect(stopped).toEqual({ running: false, steps: 0 });
      }
      // Not swallowed: the browser still reports it.
      expect(issues.entries.some((e) => e.type === 'pageerror' && e.text.includes('forced'))).toBe(
        true,
      );
      expect(issues.problems([/forced/])).toEqual([]);
    });
  }
});

test.describe('missing WebGL 2', () => {
  test('shows recovery steps instead of the game', async ({ page, issues }) => {
    await page.addInitScript(() => {
      // eslint-disable-next-line @typescript-eslint/unbound-method -- re-applied below with .call(this)
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (
        this: HTMLCanvasElement,
        type: string,
        ...rest: unknown[]
      ) {
        return type === 'webgl2' ? null : original.call(this, type as '2d', ...(rest as []));
      } as typeof original;
    });
    await page.goto('/');
    await page.locator('.status-screen').waitFor();
    expect(await statusScreen(page)).toMatchObject({
      mode: 'webgl-unsupported',
      hidden: false,
      title: 'WebGL 2 is not available',
      steps: 4,
      action: 'Try again',
    });
    expect(await page.locator('canvas.game-canvas').count()).toBe(0);
    expect(issues.problems([/WebGL 2 unavailable \(no-context\)/])).toEqual([]);
  });

  test('also covers a renderer that fails after the probe succeeds', async ({ page, issues }) => {
    await page.addInitScript(() => {
      // eslint-disable-next-line @typescript-eslint/unbound-method -- re-applied below with .call(this)
      const original = HTMLCanvasElement.prototype.getContext;
      let webgl2Calls = 0;
      HTMLCanvasElement.prototype.getContext = function (
        this: HTMLCanvasElement,
        type: string,
        ...rest: unknown[]
      ) {
        if (type === 'webgl2' && ++webgl2Calls > 1) {
          return null;
        }
        return original.call(this, type as '2d', ...(rest as []));
      } as typeof original;
    });
    await page.goto('/');
    await page.locator('.status-screen:not([hidden])').waitFor();
    expect(await statusScreen(page)).toMatchObject({ mode: 'webgl-unsupported', hidden: false });
    expect(issues.entries.filter((e) => e.type === 'pageerror')).toEqual([]);
    expect(
      issues.entries.some(
        (e) => e.type === 'error' && e.text.includes('Could not create the WebGL 2 renderer'),
      ),
      'the failure is logged, not swallowed',
    ).toBe(true);
  });
});
