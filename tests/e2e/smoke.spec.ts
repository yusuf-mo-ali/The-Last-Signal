/**
 * Boot, rendering and the fixed-step loop (Phase 0 acceptance: launches, no console errors,
 * rendering loop stable, state transitions testable).
 */

import {
  canvasSize,
  enterRun,
  expect,
  isDev,
  lockPrompt,
  openGame,
  pixelStats,
  statusScreen,
  test,
} from './helpers';

test('boots to the blockout map with WebGL 2 and no console problems', async ({ page, issues }) => {
  await openGame(page);

  const gl = await page.evaluate(() => {
    const ctx = document.querySelector('canvas')?.getContext('webgl2');
    return ctx ? String(ctx.getParameter(ctx.VERSION)) : null;
  });
  expect(gl).toContain('WebGL 2.0');
  expect(await canvasSize(page)).toEqual({
    width: 1366,
    height: 768,
    cssWidth: 1366,
    cssHeight: 768,
  });
  expect(await lockPrompt(page)).toEqual({ mode: 'start', hidden: false });
  expect((await statusScreen(page))?.hidden).toBe(true);

  const stats = await pixelStats(page);
  expect(stats.colors, 'the lit scene has many colours').toBeGreaterThan(20);
  expect(stats.red, 'the red beacon is visible').toBeGreaterThan(0);

  const before = await page.screenshot();
  await page.waitForTimeout(600);
  expect((await page.screenshot()).equals(before), 'the scene animates').toBe(false);

  expect(issues.problems()).toEqual([]);
});

test('fixed-step loop: steps + dropped time account for real time; pause freezes steps', async ({
  page,
  issues,
}, testInfo) => {
  test.skip(!isDev(testInfo), 'needs the development inspection interface');
  await openGame(page);

  const loop = await page.evaluate(async () => {
    const { game, world } = window.tls!.inspect();
    const beacon = world.beacon;
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const s0 = game.time.stepCount;
    const d0 = game.time.droppedTime;
    const t0 = performance.now();
    await wait(1500);
    const elapsed = (performance.now() - t0) / 1000;
    const steps = game.time.stepCount - s0;
    const dropped = game.time.droppedTime - d0;
    return {
      boot: game.state.current,
      error: Math.abs(steps * game.time.fixedDt + dropped - elapsed),
      interval: elapsed / Math.max(1, steps),
      angleOk: Math.abs(beacon.angle - beacon.steps * game.time.fixedDt * (Math.PI / 2)) < 1e-9,
    };
  });
  expect(loop.boot).toBe('MAIN_MENU');
  // One software-rendered frame of slack: the timer window starts and ends mid-frame.
  expect(loop.error).toBeLessThan(0.15);
  expect(loop.angleOk).toBe(true);

  await enterRun(page);
  const paused = await page.evaluate(async () => {
    const { game, renderer } = window.tls!.inspect();
    game.state.pause();
    const s0 = game.time.stepCount;
    const f0 = renderer.webgl.info.render.frame;
    await new Promise((r) => setTimeout(r, 500));
    return {
      state: game.state.current,
      steps: game.time.stepCount - s0,
      renders: renderer.webgl.info.render.frame - f0,
    };
  });
  expect(paused).toMatchObject({ state: 'PAUSED', steps: 0 });
  expect(paused.renders, 'rendering continues while paused').toBeGreaterThan(0);

  const resumed = await page.evaluate(async () => {
    const { game } = window.tls!.inspect();
    game.state.resume();
    const s0 = game.time.stepCount;
    await new Promise((r) => setTimeout(r, 500));
    return game.time.stepCount - s0;
  });
  expect(resumed, 'resumes without a catch-up burst').toBeGreaterThan(0);
  expect(resumed).toBeLessThanOrEqual(36);

  expect(issues.problems()).toEqual([]);
});
