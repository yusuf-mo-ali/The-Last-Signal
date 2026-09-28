/**
 * The wave system in a real browser (Phase 6, D-044): a run opens on wave 1 with its banner,
 * enemies enter out of the player's view, clearing a wave shows the breather and then the next
 * wave; clearing wave 20 wins the run (endless keeps going); dying ends it on the wave reached.
 * The development specs drive the waves through `tls`; the last spec uses only real input and the
 * DOM, in every build.
 */

import type { Page } from '@playwright/test';
import {
  expect,
  frames,
  isDev,
  isPointerLocked,
  lockPrompt,
  openGame,
  test,
  waveHud,
  type WaveSnapshot,
} from './helpers';

/** Opens the wave-driven game and clicks "Click to play": the mouse is captured, wave 1 begins. */
async function play(page: Page, query = ''): Promise<void> {
  await openGame(page, query, { waves: true });
  await page.click('.lock-prompt');
  await frames(page, 4);
}

function wave(page: Page): Promise<WaveSnapshot> {
  return page.evaluate(() => window.tls!.wave());
}

/** Records, for every wave spawn, the status its spawn point had for the player at that moment. */
async function recordSpawns(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __spawns: string[] };
    w.__spawns = [];
    const { waves } = window.tls!.inspect();
    waves.events.on('enemySpawned', (e) => {
      const point = window.tls!.spawnPoints().find((p) => p.id === e.spawnPointId);
      w.__spawns.push(`${e.wave} ${e.archetype} ${point?.status ?? 'missing'}`);
    });
  });
}

test.describe('waves (development build)', () => {
  // eslint-disable-next-line no-empty-pattern
  test.beforeEach(({}, testInfo) => {
    test.skip(!isDev(testInfo), 'needs the development debug tools (window.tls)');
  });

  test('wave 1: banner, fair spawns, cleared, breather, then wave 2', async ({ page, issues }) => {
    test.setTimeout(90_000);
    await play(page);
    await page.evaluate(() => window.tls!.setGodMode(true));
    await recordSpawns(page);

    // The intro: the banner names the wave; nothing has spawned yet.
    let hud = await waveHud(page);
    expect(hud.phase).toBe('intro');
    expect(hud.banner).toBe('WAVE 1');
    const start = await wave(page);
    expect(start).toMatchObject({ wave: 1, state: 'WAVE_START', budget: 6, spawned: 0 });
    expect(start.composition).toEqual({ walker: 6 });

    // Active: the readout counts down what is left; enemies enter where the player cannot see.
    await expect
      .poll(async () => (await wave(page)).state, { timeout: 10_000 })
      .toBe('WAVE_ACTIVE');
    await expect
      .poll(async () => (await wave(page)).spawned, { timeout: 10_000 })
      .toBeGreaterThan(0);
    hud = await waveHud(page);
    expect(hud.phase).toBe('active');
    expect(hud.text).toMatch(/^WAVE 1 · \d+ LEFT$/);
    expect(hud.banner).toBe('');

    // Kill everything as it arrives until the wave is cleared.
    await expect
      .poll(
        async () => {
          await page.evaluate(() => window.tls!.killAll());
          return (await wave(page)).state;
        },
        { timeout: 60_000, intervals: [250] },
      )
      .toBe('WAVE_COMPLETE');
    const spawns = await page.evaluate(
      () => (window as unknown as { __spawns: string[] }).__spawns,
    );
    expect(spawns).toHaveLength(6);
    expect(spawns.every((s) => s === '1 walker eligible')).toBe(true);
    hud = await waveHud(page);
    expect(hud.phase).toBe('cleared');
    expect(hud.banner).toMatch(/^WAVE 1 CLEARED · NEXT WAVE IN \d+$/);
    expect(await page.evaluate(() => window.tls!.runStats().wavesCleared)).toBe(1);

    // The breather ends (skipped here) and wave 2 is announced.
    await page.evaluate(() => window.tls!.skipWaveTimer());
    await expect.poll(async () => (await wave(page)).wave).toBe(2);
    expect((await wave(page)).budget).toBe(8);
    await frames(page, 2);
    expect((await waveHud(page)).banner).toBe('WAVE 2');
    expect(issues.problems()).toEqual([]);
  });

  test('clearing wave 20 wins the run; a click starts a new one', async ({ page, issues }) => {
    await play(page);
    await page.evaluate(() => window.tls!.startWave(20));
    expect(await wave(page)).toMatchObject({ wave: 20, state: 'WAVE_START', theme: 'finale' });
    await page.evaluate(() => window.tls!.skipWaveTimer());
    await expect.poll(async () => (await wave(page)).state).toBe('WAVE_ACTIVE');
    await page.evaluate(() => window.tls!.completeWave());
    await expect.poll(async () => (await wave(page)).state).toBe('VICTORY');
    await frames(page, 4);
    expect(await isPointerLocked(page)).toBe(false);
    expect(await lockPrompt(page)).toEqual({ mode: 'victory', hidden: false });
    await expect(page.locator('.lock-prompt')).toContainText('Signal transmitted');
    await expect(page.locator('.lock-prompt')).toContainText('Wave 20 cleared');
    expect((await waveHud(page)).hidden).toBe(true);

    await page.click('.lock-prompt');
    await frames(page, 4);
    expect(await wave(page)).toMatchObject({ wave: 1, state: 'WAVE_START' });
    expect(await page.evaluate(() => window.tls!.runStats().wavesCleared)).toBe(0);
    expect(issues.problems()).toEqual([]);
  });

  test('endless mode keeps going past wave 20', async ({ page, issues }) => {
    await play(page, '?endless=1');
    await page.evaluate(() => window.tls!.startWave(20));
    await page.evaluate(() => window.tls!.skipWaveTimer());
    await expect.poll(async () => (await wave(page)).state).toBe('WAVE_ACTIVE');
    await page.evaluate(() => window.tls!.completeWave());
    await expect.poll(async () => (await wave(page)).state).toBe('WAVE_COMPLETE');
    await page.evaluate(() => window.tls!.skipWaveTimer());
    await expect.poll(async () => (await wave(page)).wave).toBe(21);
    expect((await wave(page)).endless).toBe(true);
    expect(issues.problems()).toEqual([]);
  });

  test('dying ends the run on the wave reached', async ({ page, issues }) => {
    await play(page);
    await page.evaluate(() => window.tls!.startWave(2));
    await page.evaluate(() => window.tls!.skipWaveTimer());
    await expect.poll(async () => (await wave(page)).state).toBe('WAVE_ACTIVE');
    await page.evaluate(() => window.tls!.killPlayer());
    await expect.poll(async () => (await lockPrompt(page))?.mode).toBe('game-over');
    await expect(page.locator('.lock-prompt')).toContainText('You died');
    await expect(page.locator('.lock-prompt')).toContainText('Wave 2');
    // Nothing spawns behind the prompt.
    const spawned = (await wave(page)).spawned;
    await frames(page, 60);
    expect((await wave(page)).spawned).toBe(spawned);
    expect(issues.problems()).toEqual([]);
  });

  test('debug tools: the curve, previews, spawn points and their view', async ({
    page,
    issues,
  }) => {
    await play(page);
    const table = await page.evaluate(() => window.tls!.waveTable(1, 20));
    expect(Object.values(table).map((row) => row.budget)).toEqual([
      6, 8, 11, 13, 16, 19, 22, 25, 29, 32, 36, 40, 44, 48, 52, 57, 62, 67, 72, 77,
    ]);
    for (const n of [1, 5, 10, 20, 40]) {
      const preview = await page.evaluate((w) => window.tls!.previewWave(w, 'e2e'), n);
      expect(preview.spawns.some((s) => s.startsWith('climber'))).toBe(false);
    }
    const points = await page.evaluate(() => window.tls!.spawnPoints());
    expect(points.length).toBeGreaterThanOrEqual(10);
    expect(points.filter((p) => p.status === 'reserved').map((p) => p.id)).toEqual(['catwalk']);
    expect(points.some((p) => p.status === 'eligible')).toBe(true);

    expect(await page.evaluate(() => window.tls!.showSpawns(true))).toBe(true);
    await frames(page, 4);
    const rings = await page.evaluate(() => {
      const { camera } = window.tls!.inspect(); // a child of the world scene
      return camera.parent?.getObjectByName('spawn-debug')?.children.length ?? 0;
    });
    expect(rings).toBe(points.length);
    expect(await page.evaluate(() => window.tls!.showSpawns(false))).toBe(false);
    expect(issues.problems()).toEqual([]);
  });
});

test('the wave readout in any build: wave 1 is announced, then counts what is left', async ({
  page,
  issues,
}) => {
  await play(page);
  let hud = await waveHud(page);
  expect(hud.hidden).toBe(false);
  expect(hud.wave).toBe(1);
  expect(hud.banner).toBe('WAVE 1');
  await expect.poll(async () => (await waveHud(page)).phase, { timeout: 10_000 }).toBe('active');
  hud = await waveHud(page);
  expect(hud.text).toBe(`WAVE 1 · ${hud.remaining} LEFT`);
  expect(hud.remaining).toBe(6);
  expect(issues.problems()).toEqual([]);
});
