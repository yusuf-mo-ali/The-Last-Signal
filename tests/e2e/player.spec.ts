/**
 * Phase 1 — first-person foundation in a real browser: real key presses and mouse motion go
 * through BrowserInput → InputState → ActionMap → PlayerController → PlayerMotor, and the camera
 * follows. Development-build tests read the player state through `tls`; the last test needs no
 * debug tools and runs against the production build too.
 */

import { FACILITY_ROUTE } from '../../src/world/levels/facility';
import {
  expect,
  frames,
  holdKeys,
  isDev,
  isPointerLocked,
  lockPrompt,
  openGame,
  pixelStats,
  test,
  type PlayerSnapshot,
} from './helpers';
import type { Page } from '@playwright/test';

const WALK = 5;
const PITCH_LIMIT = (89 * Math.PI) / 180;

/** Opens the game and clicks "Click to play": the mouse is captured and a run starts. */
async function play(page: Page, query = ''): Promise<void> {
  await openGame(page, query);
  await page.click('.lock-prompt');
  await frames(page, 4);
}

function player(page: Page): Promise<PlayerSnapshot> {
  return page.evaluate(() => window.tls!.player());
}

async function teleport(page: Page, x: number, y: number, z: number, yaw = 0): Promise<void> {
  await page.evaluate(([px, py, pz, pyaw]) => window.tls!.teleportPlayer(px, py, pz, pyaw), [
    x,
    y,
    z,
    yaw,
  ] as const);
  await frames(page, 2);
}

test.describe('player (development build)', () => {
  // Playwright requires a destructuring pattern for the fixtures argument, even when unused.
  // eslint-disable-next-line no-empty-pattern
  test.beforeEach(({}, testInfo) => {
    test.skip(!isDev(testInfo), 'reads the player state through the development tools');
  });

  test('"Click to play" captures the mouse and starts a run at the spawn point', async ({
    page,
    issues,
  }) => {
    await openGame(page);
    expect(await lockPrompt(page)).toEqual({ mode: 'start', hidden: false });
    const before = await player(page);
    await page.click('.lock-prompt');
    await frames(page, 4);

    expect(await isPointerLocked(page)).toBe(true);
    expect(await lockPrompt(page)).toEqual({ mode: 'hidden', hidden: true });
    expect(await page.evaluate(() => window.tls!.inspect().game.state.current)).toBe('WAVE_ACTIVE');
    const p = await player(page);
    expect(p.position).toEqual(before.position);
    expect(p).toMatchObject({ grounded: true, crouched: false, speed: 0, respawns: 0 });
    expect(issues.problems()).toEqual([]);
  });

  test('WASD walks forward, back and strafes relative to the view, and stops on release', async ({
    page,
    issues,
  }) => {
    await play(page);
    // Facing north (−z) from the spawn: W → −z, S → +z, A → −x, D → +x.
    for (const [key, axis, sign] of [
      ['KeyW', 2, -1],
      ['KeyS', 2, 1],
      ['KeyA', 0, -1],
      ['KeyD', 0, 1],
    ] as const) {
      await teleport(page, 0, 0, 14, 0);
      const start = (await player(page)).position;
      await holdKeys(page, [key], 600);
      await page.waitForTimeout(300); // braking takes 0.125 s
      const end = await player(page);
      const moved = end.position.map((v, i) => v - (start[i] ?? 0));
      expect(sign * (moved[axis] ?? 0), key).toBeGreaterThan(1);
      expect(Math.abs(moved[axis === 0 ? 2 : 0] ?? 0), key).toBeLessThan(0.05);
      expect(end.speed, `${key}: stopped`).toBe(0);
      expect(end.position[1]).toBeCloseTo(0, 5);
    }
    // Turned 90° left, W walks west.
    await teleport(page, 0, 0, 14, Math.PI / 2);
    await holdKeys(page, ['KeyW'], 500);
    expect((await player(page)).position[0]).toBeLessThan(-1);
    expect(issues.problems()).toEqual([]);
  });

  test('Shift sprints at 1.5× walking speed; C crouches: slower, lower eyes, stands back up', async ({
    page,
    issues,
  }) => {
    await play(page);
    await teleport(page, 17, 0, 20, 0); // a long open lane north through the generator hall
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(400);
    const walking = await player(page);
    expect(walking.speed).toBeCloseTo(WALK, 5);
    expect(walking.sprinting).toBe(false);

    await page.keyboard.down('ShiftLeft');
    await page.waitForTimeout(400);
    const sprinting = await player(page);
    expect(sprinting.speed).toBeCloseTo(WALK * 1.5, 5);
    expect(sprinting.sprinting).toBe(true);
    await page.keyboard.up('ShiftLeft');

    await page.keyboard.down('KeyC');
    await page.waitForTimeout(500);
    const crouching = await player(page);
    const cameraY = await page.evaluate(() => window.tls!.inspect().camera.position.y);
    expect(crouching.crouched).toBe(true);
    expect(crouching.speed).toBeCloseTo(WALK * 0.5, 5);
    expect(crouching.eyeHeight).toBeLessThan(1.0);
    expect(cameraY).toBeLessThan(1.1);
    await page.keyboard.up('KeyC');
    await page.keyboard.up('KeyW');

    // Software rendering can run slower than real time (dropped time), so allow plenty.
    await page.waitForTimeout(1200);
    const standing = await player(page);
    expect(standing.crouched).toBe(false);
    expect(standing.eyeHeight).toBeCloseTo(1.62, 2);
    expect(issues.problems()).toEqual([]);
  });

  test('Space jumps about 1.15 m and lands; gravity never takes the player through the floor', async ({
    page,
    issues,
  }) => {
    await play(page);
    await teleport(page, 0, 0, 14, 0);
    // Record the feet height every frame.
    await page.evaluate(() => {
      const w = window as unknown as { __ys: number[] };
      w.__ys = [];
      const { player: p } = window.tls!.inspect();
      const tick = (): void => {
        w.__ys.push(p.motor.position.y);
        if (w.__ys.length < 600) {
          requestAnimationFrame(tick);
        }
      };
      requestAnimationFrame(tick);
    });
    await page.keyboard.press('Space');
    await page.waitForTimeout(1500);
    const ys = await page.evaluate(() => (window as unknown as { __ys: number[] }).__ys);
    const end = await player(page);
    expect(Math.max(...ys)).toBeGreaterThan(0.9);
    expect(Math.max(...ys)).toBeLessThan(1.2);
    expect(Math.min(...ys)).toBeGreaterThan(-0.001);
    expect(end.grounded).toBe(true);
    expect(end.position[1]).toBeCloseTo(0, 5);

    // Holding Space does not bunny-hop: one press, one jump.
    await page.keyboard.down('Space');
    await page.waitForTimeout(1500);
    const held = await player(page);
    await page.keyboard.up('Space');
    expect(held.grounded).toBe(true);
    expect(issues.problems()).toEqual([]);
  });

  test('mouse look: turns with real mouse motion, scales with sensitivity, clamps vertically', async ({
    page,
    issues,
  }) => {
    await play(page);
    await page.mouse.move(600, 400);
    await frames(page, 2);
    const yaw0 = (await player(page)).yaw;
    await page.mouse.move(700, 400); // 100 px right
    await frames(page, 2);
    const yaw1 = (await player(page)).yaw;
    expect(yaw1 - yaw0).toBeCloseTo(-100 * 0.0022, 2);

    await page.evaluate(() => window.tls!.view({ sensitivity: 2 }));
    await page.mouse.move(800, 400);
    await frames(page, 2);
    const { yaw: yaw2, pitch } = await player(page);
    expect((yaw2 - yaw1) / (yaw1 - yaw0)).toBeCloseTo(2, 1);

    // The camera shows the look angles on the next frame.
    const camera = await page.evaluate(() => {
      const c = window.tls!.inspect().camera;
      return { yaw: c.rotation.y, pitch: c.rotation.x, order: c.rotation.order };
    });
    expect(camera).toEqual({ yaw: yaw2, pitch, order: 'YXZ' });

    // Huge motions clamp just short of straight up / down.
    await page.evaluate(() => window.tls!.view({ sensitivity: 3 }));
    await page.mouse.move(800, 10);
    await frames(page, 2);
    expect((await player(page)).pitch).toBeCloseTo(PITCH_LIMIT, 5);
    await page.mouse.move(800, 760);
    await frames(page, 2);
    expect((await player(page)).pitch).toBeCloseTo(-PITCH_LIMIT, 5);

    // Invert-Y flips the vertical direction; FOV is configurable.
    await page.evaluate(() => window.tls!.view({ sensitivity: 1, invertY: true, fov: 80 }));
    await page.evaluate(() => window.tls!.look(0, 0));
    await page.mouse.move(800, 660); // 100 px up → looks down when inverted
    await frames(page, 2);
    expect((await player(page)).pitch).toBeCloseTo(-100 * 0.0022, 2);
    expect(await page.evaluate(() => window.tls!.inspect().camera.fov)).toBe(80);
    expect(issues.problems()).toEqual([]);
  });

  test('head bob: subtle while walking, none while standing still', async ({ page, issues }) => {
    await play(page);
    await teleport(page, 17, 0, 20, 0);
    const sampleCameraY = (ms: number) =>
      page.evaluate(async (duration) => {
        const { camera } = window.tls!.inspect();
        const ys: number[] = [];
        const end = performance.now() + duration;
        while (performance.now() < end) {
          await new Promise(requestAnimationFrame);
          ys.push(camera.position.y);
        }
        return { min: Math.min(...ys), max: Math.max(...ys) };
      }, ms);

    await page.keyboard.down('KeyW');
    await page.waitForTimeout(300);
    const walking = await sampleCameraY(1200);
    await page.keyboard.up('KeyW');
    expect(walking.max - walking.min, 'visible bob').toBeGreaterThan(0.01);
    expect(walking.max - walking.min, 'but subtle').toBeLessThan(0.1);

    await page.waitForTimeout(1000);
    const still = await sampleCameraY(600);
    expect(still.max - still.min).toBeLessThan(1e-4);
    expect(still.max).toBeCloseTo(1.62, 3);

    await page.evaluate(() => window.tls!.view({ headBob: false }));
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(200);
    const disabled = await sampleCameraY(600);
    await page.keyboard.up('KeyW');
    expect(disabled.max - disabled.min).toBeLessThan(1e-4);
    expect(issues.problems()).toEqual([]);
  });

  test('collides with walls and obstacles, even sprinting straight into them', async ({
    page,
    issues,
  }) => {
    await play(page);
    // East wall of the control room (inner face x = 10), facing east.
    await teleport(page, 7, 0, -15.5, -Math.PI / 2);
    await holdKeys(page, ['KeyW', 'ShiftLeft'], 1200);
    const wall = await player(page);
    expect(wall.position[0]).toBeGreaterThan(9.5);
    expect(wall.position[0]).toBeLessThanOrEqual(10 - 0.35 + 1e-3);

    // The console desk (1 m high, south face z = −19), facing north.
    await teleport(page, 0, 0, -14.5, 0);
    await holdKeys(page, ['KeyW', 'ShiftLeft'], 1200);
    const desk = await player(page);
    expect(desk.position[2]).toBeGreaterThanOrEqual(-19 + 0.35 - 1e-3);
    expect(desk.position[1]).toBeCloseTo(0, 5);

    // The duct refuses a standing player, and admits a crouching one.
    await teleport(page, 8.5, 0, -18, -Math.PI / 2);
    await holdKeys(page, ['KeyW'], 1000);
    expect((await player(page)).position[0]).toBeLessThan(10);
    await holdKeys(page, ['KeyC', 'KeyW'], 1500);
    expect((await player(page)).position[0]).toBeGreaterThan(10.5);
    expect(issues.problems()).toEqual([]);
  });

  test.describe('at a small resolution (faster software rendering)', () => {
    test.use({ viewport: { width: 640, height: 360 } });

    test('walks the complete blockout with real keys: every area, crouching and jumping', async ({
      page,
      issues,
    }) => {
      test.setTimeout(240_000);
      await play(page);
      // Steering runs in the page every frame (like a player aiming the mouse); movement comes
      // from real keys: W and Shift held, C held through the duct, Space tapped at the dock.
      await page.evaluate((route) => {
        const w = window as unknown as {
          __route: { index: number; arrivals: { area: string; y: number; frame: number }[] };
        };
        w.__route = { index: 0, arrivals: [] };
        const { player: p } = window.tls!.inspect();
        let frame = 0;
        const tick = (): void => {
          frame++;
          const wp = route[w.__route.index];
          if (!wp) {
            return;
          }
          const m = p.motor;
          const dx = wp.x - m.position.x;
          const dz = wp.z - m.position.z;
          if (Math.hypot(dx, dz) < 0.8 && m.grounded) {
            w.__route.arrivals.push({ area: wp.area, y: m.position.y, frame });
            w.__route.index++;
          } else {
            p.look.setAngles(Math.atan2(-dx, -dz), 0);
          }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }, FACILITY_ROUTE);

      await page.keyboard.down('KeyW');
      await page.keyboard.down('ShiftLeft');
      let crouching = false;
      const deadline = Date.now() + 200_000;
      for (;;) {
        const s = await page.evaluate(() => {
          const w = window as unknown as { __route: { index: number } };
          const m = window.tls!.inspect().player.motor;
          return {
            index: w.__route.index,
            x: m.position.x,
            y: m.position.y,
            z: m.position.z,
            grounded: m.grounded,
          };
        });
        const wp = FACILITY_ROUTE[s.index];
        if (!wp) {
          break;
        }
        expect(Date.now(), `stuck on the way to ${wp.area}`).toBeLessThan(deadline);
        const wantCrouch = wp.crouch ?? false;
        if (wantCrouch !== crouching) {
          await (wantCrouch ? page.keyboard.down('KeyC') : page.keyboard.up('KeyC'));
          crouching = wantCrouch;
        }
        if (wp.jump && s.grounded && s.y < 0.5 && Math.hypot(wp.x - s.x, wp.z - s.z) < 3.2) {
          await page.keyboard.press('Space');
        }
        await page.waitForTimeout(25);
      }
      await page.keyboard.up('ShiftLeft');
      await page.keyboard.up('KeyW');

      const arrivals = await page.evaluate(
        () =>
          (window as unknown as { __route: { arrivals: { area: string; y: number }[] } }).__route
            .arrivals,
      );
      expect(arrivals.map((a) => a.area)).toEqual(FACILITY_ROUTE.map((wp) => wp.area));
      arrivals.forEach((a, i) => {
        expect(a.y, a.area).toBeCloseTo(FACILITY_ROUTE[i]?.y ?? 0, 2);
      });
      const end = await player(page);
      expect(end.respawns, 'never fell out of the level').toBe(0);
      expect(end.groundDistance).toBeGreaterThan(200);
      expect(issues.problems()).toEqual([]);
    });
  });
});

test('walking and looking with real input changes the view (any build, no debug tools)', async ({
  page,
  issues,
}) => {
  await play(page);
  expect(await isPointerLocked(page)).toBe(true);
  const start = await pixelStats(page);
  expect(start.red, 'the beacon is in view from the spawn').toBeGreaterThan(0);

  await holdKeys(page, ['KeyA'], 600); // strafe left: the beacon slides right
  await frames(page, 4);
  const strafed = await pixelStats(page);
  expect(strafed.redX).toBeGreaterThan(start.redX + 0.03);

  // From the click point (the viewport centre), 150 px right: the view turns right, the beacon
  // slides left.
  await page.mouse.move(683 + 150, 384, { steps: 5 });
  await frames(page, 4);
  const turned = await pixelStats(page);
  expect(turned.redX).toBeLessThan(strafed.redX - 0.1);

  await page.evaluate(() => {
    document.exitPointerLock();
  });
  await frames(page, 4);
  expect(await lockPrompt(page)).toEqual({ mode: 'paused', hidden: false });
  expect(issues.problems()).toEqual([]);
});
