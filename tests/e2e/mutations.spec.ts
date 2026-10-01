/**
 * Signal Mutations in a real browser (Phase 7, D-045; Phase 7.1, D-046): every mutation announces
 * itself (card and badge) and is lifted when its wave is cleared; BLACKOUT turns zombies into
 * silhouettes with glowing eyes (close ones lifted out of the dark) without new shader programs;
 * Signal Glitch (STATIC) tears the 3D image and lags the zombies, keeps the crosshair clear and
 * stays under the HUD; DEATH CRY echoes red, frenzies and never brings reinforcements; HIVE warns
 * before a surge; BLOOD MOON shows its Elites and first appears on waves 9–12; pausing freezes the
 * effects; dying names the mutation and a new run starts clean. The development specs drive
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
  ['STATIC', 'SIGNAL GLITCH'],
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

/**
 * Where an enemy's eyes and torso are on screen (from its hit volumes and the camera), and the
 * luminance there: the brightest eye pixel, the torso's mean, and the background either side.
 */
async function enemyRegions(page: Page, id: string) {
  const png = (await page.screenshot()).toString('base64');
  return page.evaluate(
    async ([b64, target]) => {
      const { enemies, camera } = window.tls!.inspect();
      const e = enemies.get(target);
      if (!e) {
        throw new Error(`no enemy ${target}`);
      }
      const shapes = e.rig.definition.shapes;
      const head = shapes.find((x) => x.zone === 'HEAD');
      const torso = shapes.find((x) => x.zone === 'TORSO');
      if (head?.kind !== 'sphere' || torso?.kind !== 'capsule') {
        throw new Error('unexpected rig');
      }
      const w = window.innerWidth;
      const h = window.innerHeight;
      const screen = (p: [number, number, number]): [number, number] => {
        const v = e.rig.toWorld(p).project(camera);
        return [((v.x + 1) / 2) * w, ((1 - v.y) / 2) * h];
      };
      const r = head.radius;
      const c = head.center;
      const eyes = [-1, 1].map((side) =>
        screen([c[0] + side * r * 0.35, c[1] + r * 0.12, c[2] - r * 0.93]),
      );
      const t = screen([
        (torso.a[0] + torso.b[0]) / 2,
        (torso.a[1] + torso.b[1]) / 2,
        (torso.a[2] + torso.b[2]) / 2,
      ]);
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
      const box = (cx: number, cy: number, hw: number, hh: number) => {
        let max = 0;
        let sum = 0;
        let n = 0;
        for (let y = Math.round(cy - hh); y <= cy + hh; y++) {
          for (let x = Math.round(cx - hw); x <= cx + hw; x++) {
            const i = (y * img.width + x) * 4;
            const l =
              0.2126 * (data[i] ?? 0) + 0.7152 * (data[i + 1] ?? 0) + 0.0722 * (data[i + 2] ?? 0);
            max = Math.max(max, l);
            sum += l;
            n++;
          }
        }
        return { max, mean: sum / n };
      };
      const sides = [box(t[0] - 25, t[1], 4, 6), box(t[0] + 25, t[1], 4, 6)];
      return {
        eyeMax: Math.max(...eyes.map(([x, y]) => box(x, y, 2, 2).max)),
        torso: box(t[0], t[1], 3, 6).mean,
        around: (sides[0]!.mean + sides[1]!.mean) / 2,
      };
    },
    [png, id] as const,
  );
}

/**
 * How much two screenshots differ (mean absolute luminance) at the centre (around the crosshair)
 * and away from it (beyond 30 % of the smaller side, HUD strips excluded).
 */
async function frameDifference(
  page: Page,
  a: Buffer,
  b: Buffer,
): Promise<{ centre: number; outer: number }> {
  return page.evaluate(
    async ([pa, pb]) => {
      const pixels = async (b64: string) => {
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
        return {
          data: ctx.getImageData(0, 0, img.width, img.height).data,
          w: img.width,
          h: img.height,
        };
      };
      const A = await pixels(pa);
      const B = await pixels(pb);
      const lum = (d: Uint8ClampedArray, i: number) =>
        0.2126 * (d[i] ?? 0) + 0.7152 * (d[i + 1] ?? 0) + 0.0722 * (d[i + 2] ?? 0);
      const cx = A.w / 2;
      const cy = A.h / 2;
      const minSide = Math.min(A.w, A.h);
      let centre = 0;
      let nc = 0;
      let outer = 0;
      let no = 0;
      for (let y = Math.floor(A.h * 0.12); y < A.h * 0.85; y += 2) {
        for (let x = 0; x < A.w; x += 2) {
          const i = (y * A.w + x) * 4;
          const d = Math.abs(lum(A.data, i) - lum(B.data, i));
          const r = Math.hypot(x - cx, y - cy);
          if (r < 0.05 * minSide) {
            centre += d;
            nc++;
          } else if (r > 0.3 * minSide) {
            outer += d;
            no++;
          }
        }
      }
      return { centre: centre / nc, outer: outer / no };
    },
    [a.toString('base64'), b.toString('base64')] as const,
  );
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

  test('BLACKOUT: dark, zombies are silhouettes with glowing eyes, close ones readable, the light comes back', async ({
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
    expect(dark.mean).toBeLessThan(lit.mean * 0.4); // at least 60 % darker (D-046)

    // A Walker 12 m ahead: a silhouette darker than what is behind it, with eyes that glow.
    const far = await page.evaluate(() => {
      window.tls!.freezeEnemies(true);
      return window.tls!.spawnEnemy('walker', 12);
    });
    await frames(page, 6);
    // The dark reaches every enemy's shading (eyes, silhouette, close-range lift).
    expect(await page.evaluate((id) => window.tls!.inspect().enemyView.eyes(id), far)).toEqual({
      glow: 1.4,
      color: 0xffe36b,
      silhouette: 0.75,
      proximity: 0.6,
    });
    const silhouette = await enemyRegions(page, far);
    expect(silhouette.eyeMax).toBeGreaterThan(100);
    expect(silhouette.eyeMax).toBeGreaterThan(3 * Math.max(silhouette.torso, 1));
    // A silhouette: far darker than what is behind it (bodies in their own colours, even this dark,
    // would be about two thirds as bright as the wall).
    expect(silhouette.torso).toBeLessThanOrEqual(silhouette.around * 0.3);
    const withEnemy = await luminance(page);
    await page.evaluate(() => window.tls!.clearEnemies());
    await frames(page, 6);
    const without = await luminance(page);
    const changed = withEnemy.grid.filter((l, i) => Math.abs(l - (without.grid[i] ?? 0)) > 10);
    expect(changed.length).toBeGreaterThan(20);

    // At arm's length (3 m) it is lifted out of the dark: its body reads, not just its eyes.
    const near = await page.evaluate(() => window.tls!.spawnEnemy('walker', 3));
    await frames(page, 6);
    const close = await enemyRegions(page, near);
    expect(close.torso).toBeGreaterThan(silhouette.torso + 10);
    const withNear = await luminance(page);
    const nearChanged = withNear.grid.filter((l, i) => Math.abs(l - (without.grid[i] ?? 0)) > 10);
    expect(nearChanged.length).toBeGreaterThan(20);
    await page.evaluate(() => {
      window.tls!.clearEnemies();
      window.tls!.freezeEnemies(false);
    });

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

  test('Signal Glitch: the grain sits under the HUD and keeps the crosshair clear', async ({
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

  test('Signal Glitch: during a burst the image tears and zombies lag; the crosshair stays clear; then all is normal', async ({
    page,
    issues,
  }) => {
    test.setTimeout(120_000);
    await play(page);
    const programsBefore = await programs(page);
    await startActive(page, 12, 'STATIC');
    await page.evaluate(() => {
      window.tls!.pauseSpawning(true);
      window.tls!.clearEnemies();
      window.tls!.teleportPlayer(0, 0, 14, 0);
      window.tls!.look(0, 0);
    });
    // A Walker coming at the player, its drawing and its real position compared every frame.
    const id = await page.evaluate(() => window.tls!.spawnEnemy('walker', 10));
    await page.evaluate(() => window.tls!.alertEnemies());
    await frames(page, 10);
    await page.evaluate((walker) => {
      const w = window as unknown as {
        __glitch: {
          active: number;
          lag: number;
          lastLag: number;
          steps: number;
          idleAfter: boolean;
        };
      };
      w.__glitch = { active: 0, lag: 0, lastLag: 0, steps: 0, idleAfter: false };
      const { enemyView, view } = window.tls!.inspect();
      const canvas = document.querySelector<HTMLCanvasElement>('canvas');
      const tick = (): void => {
        const p = enemyView.drawnPosition(walker);
        const lag = p ? Math.hypot(p.drawn[0]! - p.real[0]!, p.drawn[2]! - p.real[2]!) : 0;
        const active = canvas?.dataset.glitch === 'active';
        if (active) {
          w.__glitch.active++;
          w.__glitch.lag = Math.max(w.__glitch.lag, lag);
          w.__glitch.steps = Math.max(w.__glitch.steps, view.glitch.state.steps);
        } else if (w.__glitch.active > 0) {
          w.__glitch.idleAfter = true;
        }
        w.__glitch.lastLag = lag;
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }, id);
    await page.evaluate(() => window.tls!.staticBurst());
    await expect
      .poll(
        () =>
          page.evaluate(
            () => (window as unknown as { __glitch: { idleAfter: boolean } }).__glitch.idleAfter,
          ),
        {
          timeout: 30_000,
        },
      )
      .toBe(true);
    await frames(page, 3);
    const seen = await page.evaluate(
      () =>
        (
          window as unknown as {
            __glitch: { active: number; lag: number; lastLag: number; steps: number };
          }
        ).__glitch,
    );
    expect(seen.active).toBeGreaterThan(0);
    // Drawn behind where it is (about speed × 0.18 s), and back in place after the burst.
    expect(seen.lag).toBeGreaterThan(0.05);
    expect(seen.lastLag).toBe(0);
    // At most 3 tear patterns a second (photosensitivity).
    expect(seen.steps).toBeGreaterThan(0);
    // A burst lasts at most 0.8 s (its clamp): at 3 Hz, at most 3 patterns.
    expect(seen.steps).toBeLessThanOrEqual(Math.ceil(0.8 * 3));
    expect((await mutation(page)).glitch).toMatchObject({ active: false });

    // A still scene, held mid-burst: the image tears away from the centre, not at the crosshair.
    // A frozen Walker stands at the centre, so a tear or colour split there would show on its
    // edges. The tear pattern is random per burst: bursts are held until a strongly shifted band
    // crosses the centre row, so a missing clear centre cannot hide behind a lucky pattern.
    await page.evaluate(() => {
      window.tls!.clearEnemies();
      window.tls!.freezeEnemies(true);
      window.tls!.spawnEnemy('walker', 8);
    });
    await frames(page, 4);
    const before = await page.screenshot();
    let during: Buffer | null = null;
    for (let attempt = 0; attempt < 40 && !during; attempt++) {
      await page.evaluate(() => {
        window.tls!.staticBurst();
        const canvas = document.querySelector<HTMLCanvasElement>('canvas');
        const { game } = window.tls!.inspect();
        const hold = (): void => {
          if (
            canvas?.dataset.glitch === 'active' &&
            window.tls!.inspect().view.glitch.state.intensity > 0.9
          ) {
            game.time.scale = 0;
          } else {
            requestAnimationFrame(hold);
          }
        };
        requestAnimationFrame(hold);
      });
      await expect
        .poll(() => page.evaluate(() => window.tls!.inspect().game.time.scale), {
          timeout: 20_000,
        })
        .toBe(0);
      await frames(page, 3);
      const bands = (await mutation(page)).glitch?.bands ?? [];
      const crossesCentre = bands.some(
        (b) => Math.abs(b.center - 0.5) < b.halfHeight * 0.6 && Math.abs(b.shift) > 0.5,
      );
      if (crossesCentre) {
        during = await page.screenshot();
      }
      await page.evaluate(() => {
        window.tls!.inspect().game.time.scale = 1;
      });
      if (!during) {
        await expect
          .poll(async () => (await mutation(page)).glitch?.active, { timeout: 10_000 })
          .toBe(false);
      }
    }
    expect(during).not.toBeNull();
    await page.evaluate(() => window.tls!.freezeEnemies(false));
    const diff = await frameDifference(page, before, during!);
    expect(diff.outer).toBeGreaterThan(3);
    expect(diff.centre).toBeLessThan(diff.outer / 2);
    expect(diff.centre).toBeLessThan(4);
    expect(await programs(page)).toBe(programsBefore);
    expect(issues.problems()).toEqual([]);
  });

  test('DEATH CRY: a red echo at the body, nearby zombies frenzied toward where you stood, no reinforcements', async ({
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
      const w = window as unknown as {
        __alarms: unknown[];
        __pulled: number;
        __echo: unknown;
      };
      w.__alarms = [];
      w.__pulled = 0;
      w.__echo = null;
      const { enemies, waves, enemyView } = window.tls!.inspect();
      enemies.events.on('alarm', (a) => {
        w.__alarms.push({ ...a });
        // The view drew its echo on this same event (it subscribed at load, before this
        // listener). Read it now: the flare lives 0.5 s, less than a couple of slow headless
        // frames.
        w.__echo = { rings: enemyView.activeRingColors, columns: enemyView.activeColumns };
      });
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
      const w = window as unknown as {
        __alarms: Record<string, unknown>[];
        __pulled: number;
        __echo: { rings: number[]; columns: { color: number; height: number }[] } | null;
      };
      const view = window.tls!.inspect().enemyView;
      const living = window.tls!.enemies().filter((e) => e.state !== 'DEAD');
      return {
        alarms: w.__alarms.map((a) => [a.kind, a.reinforcements, a.radius, a.alertMode]),
        pulled: w.__pulled,
        rings: w.__echo?.rings,
        columns: w.__echo?.columns,
        hasted: living.filter((e) => e.hasted).length,
        frenzied: living.filter((e) => e.frenzied === 'deathCry').length,
        eyes: living.map((e) => view.eyes(e.id)?.color),
        pulses: document.querySelector<HTMLElement>('.alarm-pulse')?.dataset.pulses,
      };
    });
    expect(seen.alarms).toEqual([['deathCry', false, 8, 'lastKnown']]);
    // A red echo: two rings (the second a moment later) and a short flare at the body.
    expect(seen.rings).toEqual([0xff3b30, 0xff3b30]);
    expect(seen.columns).toEqual([{ color: 0xff3b30, height: 2.2 }]);
    expect(seen.hasted).toBe(ids.length - 1); // the others stand within 8 m
    expect(seen.frenzied).toBe(ids.length - 1);
    expect(new Set(seen.eyes)).toEqual(new Set([0xff2a1a])); // frenzied eyes flare red
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

  test('BLOOD MOON first appears on one of waves 9–12 in every run; never before, never on 20', async ({
    page,
    issues,
  }) => {
    await play(page);
    const firsts = await page.evaluate(() =>
      Array.from({ length: 40 }, (_, i) => {
        const schedule = window.tls!.mutationSchedule(1, 20, `e2e-${i}`);
        const waves = Object.entries(schedule)
          .filter(([, id]) => id === 'BLOOD_MOON')
          .map(([n]) => Number(n));
        return { first: waves[0] ?? 0, final: schedule[20] };
      }),
    );
    for (const { first, final } of firsts) {
      expect(first).toBeGreaterThanOrEqual(9);
      expect(first).toBeLessThanOrEqual(12);
      expect(final).toBe('—');
    }
    // Spread over the window, not always the same wave.
    expect(new Set(firsts.map((f) => f.first)).size).toBeGreaterThanOrEqual(3);
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
    // Pause once the layer is visibly showing (checked every frame in the page).
    await page.evaluate(() => {
      window.tls!.staticBurst();
      const waitShown = (): void => {
        const overlay = document.querySelector<HTMLElement>('.static-overlay');
        if (Number(overlay?.dataset.opacity ?? 0) > 0) {
          document.exitPointerLock();
        } else {
          requestAnimationFrame(waitShown);
        }
      };
      requestAnimationFrame(waitShown);
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
