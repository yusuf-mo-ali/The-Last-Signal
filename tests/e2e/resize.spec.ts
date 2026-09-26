/**
 * Resize and device-pixel-ratio handling (Phase 0 acceptance: resize works correctly; D-033).
 */

import { canvasSize, expect, frames, openGame, pixelStats, test } from './helpers';

test('matches the drawing buffer to every target resolution', async ({ page, issues }) => {
  await openGame(page);
  for (const [width, height] of [
    [1920, 1080],
    [1600, 900],
    [1366, 768],
    [800, 600],
    [320, 180],
  ] as const) {
    await page.setViewportSize({ width, height });
    await frames(page, 4);
    expect(await canvasSize(page), `${width}×${height}`).toEqual({
      width,
      height,
      cssWidth: width,
      cssHeight: height,
    });
  }
  expect(issues.problems()).toEqual([]);
});

// The pixel-ratio cap comes from the graphics quality preset (D-037): high (default) 1.5,
// ultra 2, low 1.
test('follows live device-pixel-ratio changes, capped by the quality preset', async ({
  page,
  context,
  issues,
}) => {
  await openGame(page, '?quality=ultra');
  const cdp = await context.newCDPSession(page);
  for (const dpr of [2, 1.25, 3]) {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1366,
      height: 768,
      deviceScaleFactor: dpr,
      mobile: false,
    });
    await frames(page, 6);
    const ratio = Math.min(dpr, 2);
    expect(await canvasSize(page), `DPR ${dpr}`).toMatchObject({
      width: Math.floor(1366 * ratio),
      height: Math.floor(768 * ratio),
    });
  }
  expect(issues.problems()).toEqual([]);
});

test.describe('on a 3× display', () => {
  test.use({ deviceScaleFactor: 3 });

  for (const [query, ratio] of [
    ['', 1.5],
    ['?quality=ultra', 2],
    ['?quality=low', 1],
    ['?quality=nonsense', 1.5],
  ] as const) {
    test(`caps the pixel ratio at ${ratio} with "${query || 'no query'}"`, async ({
      page,
      issues,
    }) => {
      await openGame(page, query);
      expect(await canvasSize(page)).toMatchObject({
        width: Math.floor(1366 * ratio),
        height: Math.floor(768 * ratio),
      });
      expect(issues.problems()).toEqual([]);
    });
  }
});

test('skips drawing in a collapsed container and recovers', async ({ page, issues }) => {
  await openGame(page);
  await page.evaluate(() => {
    document.querySelector<HTMLElement>('#app')!.style.height = '0px';
  });
  await frames(page, 6);
  await page.evaluate(() => {
    document.querySelector<HTMLElement>('#app')!.style.height = '';
  });
  await frames(page, 6);
  expect(await canvasSize(page)).toMatchObject({ width: 1366, height: 768 });
  expect((await pixelStats(page)).red).toBeGreaterThan(0);
  expect(issues.problems()).toEqual([]);
});
