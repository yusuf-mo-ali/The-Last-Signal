/**
 * Development-only tooling: present in `dev`, absent from production builds (D-020, D-035).
 */

import { expect, isDev, openGame, test } from './helpers';

const PLAN_29_COMMANDS = [
  'giveAmmo',
  'healPlayer',
  'killAll',
  'spawnEnemy',
  'startWave',
  'triggerMutation',
  'spawnBoss',
  'setGodMode',
  'setInfiniteAmmo',
  'teleportPlayer',
];

test('development build: tls commands, plan §29 stubs and the stats overlay', async ({
  page,
  issues,
}, testInfo) => {
  test.skip(!isDev(testInfo), 'development build only');
  await openGame(page);

  const help = await page.evaluate(() => window.tls!.help().map((c) => [c.name, c.available]));
  const commands = new Map(help as [string, boolean][]);
  for (const name of PLAN_29_COMMANDS) {
    expect(commands.get(name), name).toBe(false); // registered as stubs until their phases
  }
  for (const name of ['inspect', 'state', 'stats', 'overlay', 'loseContext', 'throwError']) {
    expect(commands.get(name), name).toBe(true);
  }
  expect(await page.evaluate(() => window.tls!.giveAmmo())).toMatchObject({
    ok: false,
    reason: expect.stringContaining('Phase 2') as unknown as string,
  });
  expect(
    await page.evaluate(() => typeof (window as unknown as Record<string, unknown>).__TLS_DEV__),
  ).toBe('undefined');

  await page.waitForTimeout(600);
  const text = await page.locator('.debug-overlay').textContent();
  expect(text).toMatch(/FPS\s+\d+/);
  expect(text).toMatch(/cost avg [\d.]+/);
  expect(text).toMatch(/draws \d+/);
  expect(text).toMatch(/state MAIN_MENU/);

  await page.keyboard.press('Backquote');
  await expect(page.locator('.debug-overlay')).toBeHidden();
  expect(await page.evaluate(() => window.tls!.stats().overlayVisible)).toBe(false);
  await page.keyboard.press('Backquote');
  await expect(page.locator('.debug-overlay')).toBeVisible();

  expect(issues.requests.some((u) => u.includes('/src/debug/installDebug'))).toBe(true);
  expect(issues.problems()).toEqual([]);
});

test('production build: no debug interface, overlay or debug code loaded', async ({
  page,
  issues,
}, testInfo) => {
  test.skip(isDev(testInfo), 'production builds only');
  await openGame(page);
  expect(
    await page.evaluate(() => ({
      tls: typeof window.tls,
      legacy: typeof (window as unknown as Record<string, unknown>).__TLS_DEV__,
      overlay: document.querySelector('.debug-overlay') !== null,
    })),
  ).toEqual({ tls: 'undefined', legacy: 'undefined', overlay: false });
  const scripts = issues.requests.filter((u) => /\.(js|css)(\?|$)/.test(u));
  expect(scripts.some((u) => /debug/i.test(u))).toBe(false);
  expect(issues.problems()).toEqual([]);
});
