/**
 * Signal Mutations in a real browser (Phase 7, D-045): every mutation announces itself (card and
 * badge) and is lifted when its wave is cleared; BLACKOUT darkens the scene without new shader
 * programs and without hiding enemies; STATIC stays under the HUD; DEATH CRY rings red and never
 * brings reinforcements; HIVE warns before a surge; BLOOD MOON shows its Elites; pausing freezes
 * the effects; dying names the mutation and a new run starts clean. The development specs drive
 * the waves through `tls`; the last spec uses only real input and the DOM, in every build.
 */

import type { Page } from '@playwright/test';
import {
  expect,
  frames,
  isDev,
  lockPrompt,
  openGame,
  test,
  type MutationSnapshot,
  type WaveSnapshot,
} from './helpers';

/** The six v1 mutations, with the name the player sees. */
const V1: readonly (readonly [string, string])[] = [
  ['BLACKOUT', 'BLACKOUT'],
  ['HUNGER', 'HUNGER'],
  ['STATIC', 'STATIC'],
  ['SCREAM', 'DEATH CRY'],
  ['HIVE', 'HIVE'],
  ['BLOOD_MOON', 'BLOOD MOON'],
];

/** Opens the wave-driven game and clicks "Click to play": the mouse is captured, wave 1 begins. */
async function play(page: Page): Promise<void> {
  await openGame(page, '', { waves: true });
  await page.click('.lock-prompt');
  await frames(page, 4);
}

function wave(page: Page): Promise<WaveSnapshot> {
  return page.evaluate(() => window.tls!.wave());
}

function mutation(page: Page): Promise<MutationSnapshot> {
  return page.evaluate(() => window.tls!.mutation());
}

/**
 * The shader programs in use, by id. A recompile can release the old programs, so their count may
 * not change: the ids do (D-022: no mutation may cause one).
 */
function programs(page: Page): Promise<string> {
  return page.evaluate(() =>
    (window.tls!.inspect().renderer.webgl.info.programs ?? []).map((p) => p.id).join(','),
  );
}

/** Starts wave `n` with `id` (god mode on) and waits until it is active. */
async function startActive(page: Page, n: number, id: string): Promise<void> {
  await page.evaluate(
    ([w, m]) => {
      window.tls!.setGodMode(true);
      window.tls!.startWave(w, m);
      window.tls!.skipWaveTimer();
    },
    [n, id] as const,
  );
  await expect.poll(async () => (await wave(page)).state).toBe('WAVE_ACTIVE');
}

/** The mutation HUD as the player sees it (DOM only: any build). */
function mutationHud(page: Page) {
  return page.evaluate(() => {
    const shown = (selector: string) => {
      const el = document.querySelector<HTMLElement>(selector);
      return el && !el.hidden ? el.textContent : '';
    };
    const badge = document.querySelector<HTMLElement>('.mutation-badge');
    const overlay = document.querySelector<HTMLElement>('.static-overlay');
    return {
      badge: shown('.mutation-badge'),
      badgeId: badge?.dataset.mutation ?? '',
      phase: badge?.dataset.phase ?? '',
      card: shown('.mutation-card'),
      cue:
        document.querySelector<HTMLElement>('.surge-cue')?.hidden === false
          ? shown('.surge-cue__text')
          : '',
      flicker: badge?.classList.contains('mutation-badge--flicker') ?? false,
      staticOpacity: Number(overlay?.dataset.opacity ?? 0),
    };
  });
}

/** Mean luminance (0–255) of the page, sampled on a grid, excluding the HUD strips. */
async function luminance(page: Page): Promise<{ mean: number; grid: number[] }> {
  const png = (await page.screenshot()).toString('base64');
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('2D canvas unavailable');
    }
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, img.width, img.height).data;
    const grid: number[] = [];
    let sum = 0;
    for (let y = Math.floor(img.height * 0.12); y < img.height * 0.85; y += 6) {
      for (let x = 0; x < img.width; x += 6) {
        const i = (y * img.width + x) * 4;
        const l =
          0.2126 * (data[i] ?? 0) + 0.7152 * (data[i + 1] ?? 0) + 0.0722 * (data[i + 2] ?? 0);
        grid.push(l);
        sum += l;
      }
    }
    return { mean: sum / grid.length, grid };
  }, png);
}

test.describe('mutations (development build)', () => {
  // eslint-disable-next-line no-empty-pattern
  test.beforeEach(({}, testInfo) => {
    test.skip(!isDev(testInfo), 'needs the development debug tools (window.tls)');
  });

  test('every v1 mutation: intro card, badge for the wave, lifted when cleared', async ({
    page,
    issues,
  }) => {
    test.setTimeout(120_000);
    await play(page);
    const before = await programs(page);
    for (const [id, name] of V1) {
      await page.evaluate((m) => {
        window.tls!.setGodMode(true);
        window.tls!.startWave(12, m);
      }, id);
      await frames(page, 4);
      let hud = await mutationHud(page);
      expect(hud.card, id).toContain(name);
      expect(hud.badge, id).toMatch(new RegExp(`^◆ ${name}`));
      expect(hud.badgeId).toBe(id);
      expect(hud.phase).toBe('announced');
      expect((await wave(page)).mutation).toBe(id);

      await page.evaluate(() => window.tls!.skipWaveTimer());
      await expect.poll(async () => (await mutation(page)).phase).toBe('active');
      hud = await mutationHud(page);
      expect(hud.card).toBe(''); // the card is the announcement only
      expect(hud.badge).toMatch(new RegExp(`^◆ ${name}`));
      const sources = (await mutation(page)).sources!;
      const applied = [
        ...sources.stats,
        ...sources.triggers,
        ...sources.environment,
        ...sources.screen,
      ];
      if (id !== 'HIVE') {
        expect(applied, id).toContain(`mutation:${id}`); // HIVE lives in the wave's composition
      }

      await page.evaluate(() => window.tls!.completeWave());
      await expect.poll(async () => (await mutation(page)).phase).toBe('lifted');
      await frames(page, 2);
      expect((await mutationHud(page)).badge).toBe(`${name} LIFTED`);
      const after = (await mutation(page)).sources!;
      expect([...after.stats, ...after.triggers, ...after.screen]).toEqual([]);
    }
    // Lights change intensity and colour only: no shader program was built for any of them.
    expect(await programs(page)).toBe(before);
    expect(issues.problems()).toEqual([]);
  });

  test('BLACKOUT: the scene darkens, enemies stay visible, the light comes back', async ({
    page,
    issues,
  }) => {
    test.setTimeout(90_000);
    await play(page);
    const programsBefore = await programs(page);
    const base = await page.evaluate(() => window.tls!.inspect().lighting.state);
    // A still scene: the player at the spawn looking across the yard, nothing spawning.
    const settle = async (id: string) => {
      await startActive(page, 12, id);
      await page.evaluate(() => {
        window.tls!.pauseSpawning(true);
        window.tls!.clearEnemies();
        window.tls!.teleportPlayer(0, 0, 14, 0);
        window.tls!.look(0, 0);
      });
    };
    await settle('none');
    await frames(page, 6);
    const lit = await luminance(page);

    await settle('BLACKOUT');
    await expect
      .poll(async () => (await mutation(page)).environment[0]?.weight ?? 0, { timeout: 10_000 })
      .toBe(1);
    await frames(page, 6);
    const dark = await luminance(page);
    expect(dark.mean).toBeLessThan(lit.mean * 0.6); // at least 40 % darker

    // A Walker 12 m ahead is still clearly there (it changes the picture where it stands).
    await page.evaluate(() => {
      window.tls!.freezeEnemies(true);
      window.tls!.spawnEnemy('walker', 12);
    });
    await frames(page, 6);
    const withEnemy = await luminance(page);
    await page.evaluate(() => window.tls!.clearEnemies());
    await frames(page, 6);
    const without = await luminance(page);
    const changed = withEnemy.grid.filter((l, i) => Math.abs(l - (without.grid[i] ?? 0)) > 10);
    expect(changed.length).toBeGreaterThan(20);
    await page.evaluate(() => window.tls!.freezeEnemies(false));

    // Emergency lights on during the blackout; after the clear everything fades back.
    expect(
      (await page.evaluate(() => window.tls!.inspect().lighting.state)).emergency,
    ).toBeGreaterThan(0);
    await page.evaluate(() => window.tls!.completeWave());
    await expect
      .poll(async () => (await mutation(page)).environment.length, { timeout: 10_000 })
      .toBe(0);
    await frames(page, 2);
    const restored = await page.evaluate(() => window.tls!.inspect().lighting.state);
    expect(restored.ambient).toBeCloseTo(base.ambient, 4);
    expect(restored.sun).toBeCloseTo(base.sun, 4);
    expect(restored.emergency).toBe(0);
    expect(await programs(page)).toBe(programsBefore);
    expect(issues.problems()).toEqual([]);
  });

  test('STATIC: bursts sit under the HUD and keep the crosshair clear', async ({
    page,
    issues,
  }) => {
    await play(page);
    await startActive(page, 12, 'STATIC');
    expect((await mutation(page)).nextBurstIn).toBeGreaterThan(0);
    // Sampled every frame in the page: a burst lasts well under a second of simulated time,
    // which can fall between two polls at software-rendering frame rates.
    await page.evaluate(() => {
      const w = window as unknown as { __static: { opacity: number; flicker: boolean } };
      w.__static = { opacity: 0, flicker: false };
      const sample = (): void => {
        const overlay = document.querySelector<HTMLElement>('.static-overlay');
        const badge = document.querySelector<HTMLElement>('.mutation-badge');
        w.__static.opacity = Math.max(w.__static.opacity, Number(overlay?.dataset.opacity ?? 0));
        w.__static.flicker ||= badge?.classList.contains('mutation-badge--flicker') ?? false;
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
      (window as unknown as { __until: number }).__until = window.tls!.staticBurst().until;
    });
    // The overlay shows the burst and the badge flickers with it (the player sees the cause).
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __static: object }).__static))
      .toMatchObject({ flicker: true });
    const peak = await page.evaluate(
      () => (window as unknown as { __static: { opacity: number } }).__static.opacity,
    );
    expect(peak).toBeGreaterThan(0);
    expect(peak).toBeLessThanOrEqual(0.35);

    // Stacking: with every element made hit-testable, the HUD is on top of the overlay.
    const stacking = await page.evaluate(() => {
      const style = document.createElement('style');
      style.textContent = '* { pointer-events: auto !important; }';
      document.head.appendChild(style);
      const above = (selector: string) => {
        const el = document.querySelector<HTMLElement>(selector);
        if (!el || el.hidden) {
          return `${selector} missing`;
        }
        const r = el.getBoundingClientRect();
        const stack = document.elementsFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        const overlay = stack.findIndex((e) => e.closest('.static-overlay'));
        const target = stack.findIndex((e) => e === el || el.contains(e));
        return overlay === -1 || (target !== -1 && target < overlay) ? 'above' : 'below';
      };
      const result = {
        crosshair: above('.weapon-hud__crosshair'),
        health: above('.health-hud'),
        ammo: above('.weapon-hud__ammo'),
        wave: above('.wave-hud'),
        badge: above('.mutation-badge'),
      };
      style.remove();
      return result;
    });
    expect(stacking).toEqual({
      crosshair: 'above',
      health: 'above',
      ammo: 'above',
      wave: 'above',
      badge: 'above',
    });
    // The burst ends on its own, and the layer clears with it (it never lingers).
    await expect
      .poll(
        () =>
          page.evaluate(
            () =>
              window.tls!.inspect().screenEffects.time >
              (window as unknown as { __until: number }).__until + 0.2,
          ),
        { timeout: 20_000 },
      )
      .toBe(true);
    await frames(page, 2);
    expect((await mutationHud(page)).staticOpacity).toBe(0);
    expect(issues.problems()).toEqual([]);
  });

  test('DEATH CRY: a red ring at the body, nearby zombies hurry, no reinforcements', async ({
    page,
    issues,
  }) => {
    await play(page);
    await startActive(page, 12, 'SCREAM');
    await page.evaluate(() => {
      window.tls!.pauseSpawning(true);
      window.tls!.clearEnemies();
      window.tls!.teleportPlayer(0, 0, 14, 0);
      window.tls!.look(0, 0);
      const w = window as unknown as { __alarms: unknown[]; __pulled: number };
      w.__alarms = [];
      w.__pulled = 0;
      const { enemies, waves } = window.tls!.inspect();
      enemies.events.on('alarm', (a) => w.__alarms.push({ ...a }));
      waves.events.on('reinforcementsPulled', () => {
        w.__pulled++;
      });
    });
    // Close enough that the player is inside the cry's 8 m: a wrong screen pulse would show.
    const ids = await page.evaluate(() => {
      window.tls!.freezeEnemies(true);
      return window.tls!.spawnWalkers(4, 6);
    });
    expect(ids.length).toBeGreaterThanOrEqual(2);
    const pulsesBefore = await page.evaluate(
      () => document.querySelector<HTMLElement>('.alarm-pulse')?.dataset.pulses,
    );
    await page.evaluate((id) => window.tls!.killEnemy(id), ids[0]!);
    await frames(page, 2);

    const seen = await page.evaluate(() => {
      const w = window as unknown as { __alarms: Record<string, unknown>[]; __pulled: number };
      return {
        alarms: w.__alarms.map((a) => [a.kind, a.reinforcements, a.radius]),
        pulled: w.__pulled,
        rings: window.tls!.inspect().enemyView.activeRingColors,
        hasted: window.tls!.enemies().filter((e) => e.hasted).length,
        pulses: document.querySelector<HTMLElement>('.alarm-pulse')?.dataset.pulses,
      };
    });
    expect(seen.alarms).toEqual([['deathCry', false, 8]]);
    expect(seen.rings).toEqual([0xff3b30]);
    expect(seen.hasted).toBe(ids.length - 1); // the others stand within 8 m
    expect(seen.pulled).toBe(0);
    expect(seen.pulses).toBe(pulsesBefore); // no screen pulse: that is the Screamer's
    expect(issues.problems()).toEqual([]);
  });

  test('HIVE: a surge is announced with its direction, then arrives within the cap', async ({
    page,
    issues,
  }) => {
    test.setTimeout(120_000);
    await play(page);
    await startActive(page, 12, 'HIVE');
    const start = await wave(page);
    expect(start.surges).toMatchObject({ done: 0, total: 1, pending: null });

    let cue = '';
    let region = '';
    let maxAlive = 0;
    await expect
      .poll(
        async () => {
          const w = await wave(page);
          maxAlive = Math.max(maxAlive, w.alive);
          if (w.surges.pending && !cue) {
            const hud = await mutationHud(page);
            cue = hud.cue;
            region = w.surges.pending.region;
          }
          if (!w.surges.pending) {
            await page.evaluate(() => window.tls!.killAll());
          }
          return w.surges.done;
        },
        { timeout: 90_000, intervals: [200] },
      )
      .toBeGreaterThanOrEqual(1);
    expect(cue).toMatch(/^HIVE SURGE · [A-Z-]+$/);
    expect(region).not.toBe('');
    expect(maxAlive).toBeLessThanOrEqual(start.maxAlive);
    expect((await wave(page)).alive).toBeLessThanOrEqual(start.maxAlive);
    expect(issues.problems()).toEqual([]);
  });

  test('BLOOD MOON: the badge counts the wave’s Elites', async ({ page, issues }) => {
    await play(page);
    await page.evaluate(() => window.tls!.startWave(12, 'BLOOD_MOON'));
    await frames(page, 4);
    const elites = await page.evaluate(
      () =>
        window.tls!.inspect().waves.definition?.spawns.filter((s) => s.traits.includes('elite'))
          .length ?? 0,
    );
    expect(elites).toBeGreaterThanOrEqual(1);
    expect((await mutationHud(page)).badge).toBe(`◆ BLOOD MOON · ELITES ×${elites}`);
    expect(issues.problems()).toEqual([]);
  });

  test('pausing freezes the blackout fade and the STATIC schedule', async ({ page, issues }) => {
    await play(page);
    await page.evaluate(() => window.tls!.startWave(12, 'BLACKOUT'));
    await page.waitForTimeout(400); // part-way into the fade
    await page.evaluate(() => {
      document.exitPointerLock();
    });
    await expect.poll(async () => (await lockPrompt(page))?.mode).toBe('paused');
    const weight = (await mutation(page)).environment[0]?.weight ?? 0;
    expect(weight).toBeGreaterThan(0);
    expect(weight).toBeLessThan(1);
    await page.waitForTimeout(800);
    expect((await mutation(page)).environment[0]?.weight).toBe(weight);

    // Resume, then STATIC: pausing mid-burst freezes it, but the layer never shows behind the
    // pause prompt; the time to the next burst holds.
    await page.click('.lock-prompt');
    await frames(page, 4);
    await startActive(page, 12, 'STATIC');
    await page.evaluate(() => {
      window.tls!.staticBurst();
      document.exitPointerLock();
    });
    await expect.poll(async () => (await lockPrompt(page))?.mode).toBe('paused');
    expect((await mutation(page)).staticBurst).not.toBeNull(); // frozen mid-burst
    await frames(page, 2);
    expect((await mutationHud(page)).staticOpacity).toBe(0);
    const next = (await mutation(page)).nextBurstIn;
    await page.waitForTimeout(800);
    expect((await mutation(page)).nextBurstIn).toBe(next);
    expect(issues.problems()).toEqual([]);
  });

  test('dying names the mutation; a new run starts without it', async ({ page, issues }) => {
    await play(page);
    const base = await page.evaluate(() => window.tls!.inspect().lighting.state);
    await startActive(page, 7, 'BLACKOUT');
    await page.evaluate(() => {
      window.tls!.setGodMode(false);
      window.tls!.killPlayer();
    });
    await expect.poll(async () => (await lockPrompt(page))?.mode).toBe('game-over');
    await expect(page.locator('.lock-prompt')).toContainText('Wave 7 · Blackout');
    expect((await mutation(page)).phase).toBe('ended');

    await page.click('.lock-prompt');
    await frames(page, 4);
    expect(await wave(page)).toMatchObject({ wave: 1, state: 'WAVE_START', mutation: null });
    const m = await mutation(page);
    expect(m.phase).toBe('none');
    expect(m.environment).toEqual([]);
    expect(m.history).toEqual([]);
    const hud = await mutationHud(page);
    expect([hud.badge, hud.card]).toEqual(['', '']);
    const lights = await page.evaluate(() => window.tls!.inspect().lighting.state);
    expect(lights.ambient).toBeCloseTo(base.ambient, 4);
    expect(lights.emergency).toBe(0);
    expect(issues.problems()).toEqual([]);
  });

  test('debug tools: the catalogue, the schedule and switching mutations off', async ({
    page,
    issues,
  }) => {
    await play(page);
    const catalogue = await page.evaluate(() => window.tls!.mutations());
    expect(catalogue.filter((m) => m.status === 'enabled').map((m) => m.id)).toEqual(
      V1.map(([id]) => id),
    );
    expect(catalogue.filter((m) => m.status === 'deferred').map((m) => m.id)).toEqual([
      'LOW_GRAVITY',
      'OVERLOAD',
    ]);
    const schedule = await page.evaluate(() => window.tls!.mutationSchedule(1, 20, 'e2e'));
    expect([schedule[1], schedule[2], schedule[3], schedule[20]]).toEqual(['—', '—', '—', '—']);
    for (let n = 4; n < 20; n++) {
      expect(V1.map(([id]) => id)).toContain(schedule[n]);
    }
    await expect(page.evaluate(() => window.tls!.triggerMutation('LOW_GRAVITY'))).rejects.toThrow();

    expect(await page.evaluate(() => window.tls!.setMutations(false))).toBe(false);
    await page.evaluate(() => window.tls!.startWave(8));
    expect((await wave(page)).mutation).toBeNull();
    expect(await page.evaluate(() => window.tls!.setMutations(true))).toBe(true);
    await page.evaluate(() => window.tls!.startWave(8));
    expect((await wave(page)).mutation).not.toBeNull();
    expect(issues.problems([/Unknown mutation|deferred|LOW_GRAVITY/])).toEqual([]);
  });
});

test('any build: waves 1–3 carry no mutation; the STATIC layer sits under the HUD', async ({
  page,
  issues,
}) => {
  await play(page);
  const hud = await mutationHud(page);
  expect(hud).toMatchObject({ badge: '', card: '', cue: '', staticOpacity: 0 });
  const order = await page.evaluate(() => {
    const overlay = document.querySelector('.static-overlay');
    const canvas = document.querySelector('canvas.game-canvas');
    const later = (selector: string) => {
      const el = document.querySelector(selector);
      return !!overlay && !!el && !!(overlay.compareDocumentPosition(el) & 4);
    };
    return {
      afterCanvas: !!canvas && !!overlay && !!(canvas.compareDocumentPosition(overlay) & 4),
      crosshair: later('.weapon-hud__crosshair'),
      badge: later('.mutation-badge'),
      pointerEvents: overlay ? getComputedStyle(overlay).pointerEvents : null,
    };
  });
  expect(order).toEqual({ afterCanvas: true, crosshair: true, badge: true, pointerEvents: 'none' });
  expect(issues.problems()).toEqual([]);
});
