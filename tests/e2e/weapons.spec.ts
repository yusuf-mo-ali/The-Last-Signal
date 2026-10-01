/**
 * Phase 2 — weapon framework in a real browser: real mouse buttons, wheel and keys go through
 * BrowserInput → InputState → ActionMap → WeaponController → WeaponManager. Development-build
 * tests read state through `tls`; the last test uses only the HUD and runs in production too.
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
  type WeaponsSnapshot,
} from './helpers';

interface RecordedEvent {
  readonly type: string;
  readonly payload: Record<string, unknown> | undefined;
}

/** Opens the game and clicks "Click to play": the mouse is captured and a run starts. */
async function play(page: Page): Promise<void> {
  await openGame(page);
  await page.click('.lock-prompt');
  await frames(page, 4);
}

/** Records every weapon event in the page. */
async function recordEvents(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __events: { type: string; payload: unknown }[] };
    w.__events = [];
    const { weapons } = window.tls!.inspect();
    for (const type of [
      'shot',
      'melee',
      'dryFire',
      'reloadStarted',
      'reloaded',
      'reloadCancelled',
      'equipped',
      'equipRefused',
    ] as const) {
      weapons.events.on(type, (payload: unknown) => {
        w.__events.push({ type, payload: JSON.parse(JSON.stringify(payload ?? null)) as unknown });
      });
    }
  });
}

function events(page: Page): Promise<RecordedEvent[]> {
  return page.evaluate(() => (window as unknown as { __events: RecordedEvent[] }).__events);
}

async function count(page: Page, type: string): Promise<number> {
  return (await events(page)).filter((e) => e.type === type).length;
}

function weapons(page: Page): Promise<WeaponsSnapshot> {
  return page.evaluate(() => window.tls!.weapons());
}

/** Waits until the raise after a switch (or the start of a run) is over. */
async function settled(page: Page): Promise<void> {
  await expect.poll(async () => (await weapons(page)).switching, { timeout: 5000 }).toBe(false);
}

async function click(page: Page): Promise<void> {
  await page.mouse.down();
  await page.mouse.up();
  await frames(page, 3);
}

async function hud(page: Page) {
  return page.evaluate(() => {
    const el = document.querySelector<HTMLElement>('.weapon-hud');
    return el
      ? {
          hidden: el.hidden,
          weapon: el.dataset.weapon ?? '',
          magazine: el.dataset.magazine ?? '',
          state: el.dataset.state ?? '',
          text: el.textContent,
        }
      : null;
  });
}

test.describe('weapons (development build)', () => {
  // Playwright requires a destructuring pattern for the fixtures argument, even when unused.
  // eslint-disable-next-line no-empty-pattern
  test.beforeEach(({}, testInfo) => {
    test.skip(!isDev(testInfo), 'reads the weapon state through the development tools');
  });

  test('a run starts with Bare Hands, the Pistol in hand and the Secondary locked', async ({
    page,
    issues,
  }) => {
    await play(page);
    expect(await weapons(page)).toMatchObject({
      loadout: { melee: 'bareHands', primary: 'pistol', secondary: 'locked', active: 'primary' },
      held: {
        id: 'pistol',
        kind: 'firearm',
        ammo: { magazine: 12, magazineSize: 12, reserve: 'unlimited' },
      },
      infiniteAmmo: false,
    });
    expect(await hud(page)).toMatchObject({ hidden: false, weapon: 'pistol', magazine: '12' });
    expect((await hud(page))?.text).toContain('12 / ∞');
    expect(issues.problems()).toEqual([]);
  });

  test('left click fires the Pistol: the magazine counts down, shots hit the level, with feedback', async ({
    page,
    issues,
  }) => {
    await play(page);
    await page.evaluate(() => {
      window.tls!.teleportPlayer(0, 0, -14, 0); // facing the control room desk, 5 m away
      window.tls!.look(0, -0.15); // aim at its front face (it is 1 m high)
    });
    await settled(page);
    await recordEvents(page);
    // Watch the muzzle flash every frame.
    await page.evaluate(() => {
      const w = window as unknown as { __flash: number };
      w.__flash = 0;
      const view = window.tls!.inspect().weaponView;
      const tick = (): void => {
        if (view.muzzleFlashVisible) {
          w.__flash++;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });

    for (let i = 0; i < 3; i++) {
      await click(page);
      await page.waitForTimeout(300);
    }
    const shots = (await events(page)).filter((e) => e.type === 'shot');
    expect(shots).toHaveLength(3);
    for (const shot of shots) {
      const pellets = shot.payload?.pellets as { hit: { kind: string; point: number[] } | null }[];
      expect(pellets[0]?.hit?.kind).toBe('world');
      expect(pellets[0]?.hit?.point[2]).toBeCloseTo(-19, 0); // the desk's front face
    }
    expect((await weapons(page)).held.ammo?.magazine).toBe(9);
    expect(await hud(page)).toMatchObject({ magazine: '9' });
    expect(await page.evaluate(() => window.tls!.inspect().weaponView.activeImpactMarkers)).toBe(3);
    expect(
      await page.evaluate(() => (window as unknown as { __flash: number }).__flash),
    ).toBeGreaterThan(0);
    // Recoil went through the look and has settled back.
    expect(await page.evaluate(() => window.tls!.inspect().player.look.recoilPitch)).toBeCloseTo(
      0,
      6,
    );
    expect(issues.problems()).toEqual([]);
  });

  test('R reloads over the reload time; firing during a reload does nothing', async ({
    page,
    issues,
  }) => {
    await play(page);
    await settled(page);
    await recordEvents(page);
    await click(page);
    await page.waitForTimeout(300);
    await click(page);
    expect((await weapons(page)).held.ammo?.magazine).toBe(10);

    await page.keyboard.press('KeyR');
    await frames(page, 3);
    expect((await weapons(page)).held.state).toBe('reloading');
    expect(await hud(page)).toMatchObject({ state: 'reloading' });
    expect((await hud(page))?.text).toContain('RELOADING');
    await click(page); // mid-reload
    expect(await count(page, 'shot')).toBe(2);

    await expect
      .poll(async () => (await weapons(page)).held.ammo?.magazine, { timeout: 8000 })
      .toBe(12);
    expect(await count(page, 'reloaded')).toBe(1);
    expect(await count(page, 'shot')).toBe(2);
    expect(issues.problems()).toEqual([]);
  });

  test('an empty magazine clicks dry and reloads by itself', async ({ page, issues }) => {
    await play(page);
    await settled(page);
    await recordEvents(page);
    await page.evaluate(() => {
      const firearm = window.tls!.inspect().weapons.weaponIn('primary') as unknown as {
        magazine: number;
      };
      firearm.magazine = 1;
    });
    await click(page);
    await page.waitForTimeout(300);
    await click(page);
    expect(await count(page, 'shot')).toBe(1);
    expect(await count(page, 'dryFire')).toBe(1);
    expect(await count(page, 'reloadStarted')).toBe(1);
    await expect
      .poll(async () => (await weapons(page)).held.ammo?.magazine, { timeout: 8000 })
      .toBe(12);
    expect(issues.problems()).toEqual([]);
  });

  test('3 equips melee, 1 the Primary; 2 is refused while the Secondary is locked', async ({
    page,
    issues,
  }) => {
    await play(page);
    await settled(page);
    await recordEvents(page);

    await page.keyboard.press('Digit3');
    await frames(page, 3);
    expect((await weapons(page)).loadout.active).toBe('melee');
    expect(await hud(page)).toMatchObject({ weapon: 'bareHands', magazine: '' });

    await page.keyboard.press('Digit2');
    await frames(page, 3);
    expect((await weapons(page)).loadout.active).toBe('melee');
    expect((await events(page)).filter((e) => e.type === 'equipRefused')).toEqual([
      { type: 'equipRefused', payload: { category: 'secondary', reason: 'locked' } },
    ]);

    // With melee held, the left button punches.
    await settled(page);
    await click(page);
    expect((await events(page)).find((e) => e.type === 'melee')?.payload).toMatchObject({
      weaponId: 'bareHands',
      quick: false,
    });

    await page.keyboard.press('Digit1');
    await frames(page, 3);
    expect((await weapons(page)).loadout.active).toBe('primary');
    expect(await hud(page)).toMatchObject({ weapon: 'pistol' });
    expect(issues.problems()).toEqual([]);
  });

  test('the mouse wheel cycles firearms: back from melee, and between Primary and Secondary', async ({
    page,
    issues,
  }) => {
    await play(page);
    await settled(page);
    await page.keyboard.press('Digit3');
    await frames(page, 3);
    await page.mouse.wheel(0, 100);
    await frames(page, 3);
    expect((await weapons(page)).loadout.active).toBe('primary');

    await page.mouse.wheel(0, 100); // only one firearm: stays on the Primary
    await frames(page, 3);
    expect((await weapons(page)).loadout.active).toBe('primary');

    // Unlock the Secondary and put a Pistol there (the Pistol fits both, D-039).
    await page.evaluate(() => {
      window.tls!.unlockSecondary();
      window.tls!.giveWeapon('pistol', 'secondary');
    });
    await page.mouse.wheel(0, 100);
    await frames(page, 3);
    expect((await weapons(page)).loadout).toMatchObject({
      secondary: { weapon: 'pistol' },
      active: 'secondary',
    });
    await page.mouse.wheel(0, -100);
    await frames(page, 3);
    expect((await weapons(page)).loadout.active).toBe('primary');
    expect(issues.problems()).toEqual([]);
  });

  test('V quick melee punches without leaving the Pistol', async ({ page, issues }) => {
    await play(page);
    await settled(page);
    await recordEvents(page);
    await page.keyboard.press('KeyV');
    await frames(page, 3);
    expect((await events(page)).filter((e) => e.type === 'melee').map((e) => e.payload)).toEqual([
      expect.objectContaining({ weaponId: 'bareHands', quick: true }),
    ]);
    expect((await weapons(page)).loadout.active).toBe('primary');
    expect((await weapons(page)).held.ammo?.magazine).toBe(12);
    expect(issues.problems()).toEqual([]);
  });

  test('pointer lock: no firing while paused, and the resume click is not a shot', async ({
    page,
    issues,
  }) => {
    await play(page);
    await settled(page);
    await recordEvents(page);
    await page.evaluate(() => {
      document.exitPointerLock();
    });
    await frames(page, 4);
    expect(await lockPrompt(page)).toEqual({ mode: 'paused', hidden: false });
    expect(await hud(page)).toMatchObject({ hidden: true });

    await page.click('.lock-prompt'); // resumes: this click must not fire
    await frames(page, 6);
    expect(await isPointerLocked(page)).toBe(true);
    expect(await count(page, 'shot')).toBe(0);
    expect((await weapons(page)).held.ammo?.magazine).toBe(12);

    await click(page);
    expect(await count(page, 'shot')).toBe(1);
    expect(issues.problems()).toEqual([]);
  });
});

test('fire, reload and switch with real input, read from the HUD (any build, no debug tools)', async ({
  page,
  issues,
}) => {
  await play(page);
  await expect.poll(async () => (await hud(page))?.text).toContain('12 / ∞');
  expect(await hud(page)).toMatchObject({ hidden: false, weapon: 'pistol' });

  await page.waitForTimeout(500); // the Pistol is raised at the start of a run
  await click(page);
  await expect.poll(async () => (await hud(page))?.magazine).toBe('11');

  await page.keyboard.press('KeyR');
  await expect.poll(async () => (await hud(page))?.state).toBe('reloading');
  await expect.poll(async () => (await hud(page))?.magazine, { timeout: 8000 }).toBe('12');

  await page.keyboard.press('Digit3');
  await expect.poll(async () => (await hud(page))?.weapon).toBe('bareHands');
  await page.keyboard.press('Digit2'); // Secondary is locked: nothing changes
  await frames(page, 4);
  expect((await hud(page))?.weapon).toBe('bareHands');
  await page.keyboard.press('Digit1');
  await expect.poll(async () => (await hud(page))?.weapon).toBe('pistol');
  expect(issues.problems()).toEqual([]);
});
