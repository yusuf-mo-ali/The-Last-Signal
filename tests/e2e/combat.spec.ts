/**
 * Phase 3 — combat against training dummies in a real browser: real mouse buttons and keys go
 * through the input stack, the weapons and the combat pipeline (hitbox → damage → health → death
 * → feedback). Development-build tests read state through `tls`; the last test uses only the DOM
 * (hit marker, feedback totals, HUD) and runs against the production build too.
 */

import type { Page } from '@playwright/test';
import { expect, frames, isDev, openGame, test, type DummySnapshot } from './helpers';

interface Hit {
  readonly targetId: string;
  readonly weaponId: string;
  readonly source: string;
  readonly quick: boolean;
  readonly zone: string;
  readonly critical: boolean;
  readonly amount: number;
  readonly health: number;
  readonly killed: boolean;
}

async function play(page: Page): Promise<void> {
  await openGame(page);
  await page.click('.lock-prompt');
  await frames(page, 4);
}

/** Records combat events, and the most feedback seen on screen in any frame. */
async function record(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as {
      __hits: unknown[];
      __kills: number;
      __seen: { marker: string[]; numbers: string[] };
    };
    w.__hits = [];
    w.__kills = 0;
    w.__seen = { marker: [], numbers: [] };
    const { combat } = window.tls!.inspect();
    combat.events.on('damaged', (e) => w.__hits.push(JSON.parse(JSON.stringify(e)) as unknown));
    combat.events.on('killed', () => {
      w.__kills++;
    });
    const tick = (): void => {
      const marker = document.querySelector<HTMLElement>('.hit-marker');
      if (marker && !marker.hidden && marker.getClientRects().length > 0) {
        const kind = marker.dataset.kind ?? '';
        if (w.__seen.marker.at(-1) !== kind) {
          w.__seen.marker.push(kind);
        }
      }
      for (const n of document.querySelectorAll<HTMLElement>('.damage-number')) {
        const text = `${n.dataset.kind ?? ''}:${n.textContent}`;
        if (!n.hidden && n.getClientRects().length > 0 && !w.__seen.numbers.includes(text)) {
          w.__seen.numbers.push(text);
        }
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

function hits(page: Page): Promise<Hit[]> {
  return page.evaluate(() => (window as unknown as { __hits: Hit[] }).__hits);
}

function seen(page: Page): Promise<{ marker: string[]; numbers: string[] }> {
  return page.evaluate(
    () => (window as unknown as { __seen: { marker: string[]; numbers: string[] } }).__seen,
  );
}

async function kills(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __kills: number }).__kills);
}

async function dummy(page: Page, id: string): Promise<DummySnapshot | undefined> {
  return (await page.evaluate(() => window.tls!.dummies())).find((d) => d.id === id);
}

/** One click, then enough time for the Pistol to be ready again. */
async function shoot(page: Page): Promise<void> {
  await page.mouse.down();
  await page.mouse.up();
  await frames(page, 3);
  await page.waitForTimeout(250);
}

/** Waits until the weapon raised at the start of a run (or after a switch) can fire. */
async function ready(page: Page): Promise<void> {
  await expect
    .poll(() => page.evaluate(() => window.tls!.weapons().switching), { timeout: 5000 })
    .toBe(false);
}

async function feedbackTotals(page: Page) {
  return page.evaluate(() => {
    const el = document.querySelector<HTMLElement>('.combat-feedback');
    return {
      hidden: el?.hidden ?? true,
      hits: el?.dataset.hits ?? '',
      headshots: el?.dataset.headshots ?? '',
      kills: el?.dataset.kills ?? '',
      marker: document.querySelector<HTMLElement>('.hit-marker')?.dataset.kind ?? '',
    };
  });
}

test.describe('combat (development build)', () => {
  // Playwright requires a destructuring pattern for the fixtures argument, even when unused.
  // eslint-disable-next-line no-empty-pattern
  test.beforeEach(({}, testInfo) => {
    test.skip(!isDev(testInfo), 'reads combat state through the development tools');
  });

  test('the training range stands in the yard: three dummies, drawn and hittable', async ({
    page,
    issues,
  }) => {
    await play(page);
    const dummies = await page.evaluate(() => window.tls!.dummies());
    expect(dummies.map((d) => [d.id, d.kind, d.health, d.alive])).toEqual([
      ['dummy-1', 'standard', 100, true],
      ['dummy-2', 'zoned', 400, true],
      ['dummy-3', 'standard', 100, true],
    ]);
    expect(await page.evaluate(() => window.tls!.inspect().dummyView.count)).toBe(3);
    expect(issues.problems()).toEqual([]);
  });

  test('a headshot on the dummy ahead: 65 damage, a headshot marker and a damage number', async ({
    page,
    issues,
  }) => {
    await play(page);
    await ready(page);
    await record(page);
    await shoot(page); // from the spawn, the dummy's head is dead centre
    expect(await hits(page)).toEqual([
      expect.objectContaining({
        targetId: 'dummy-1',
        weaponId: 'pistol',
        zone: 'HEAD',
        critical: true,
        amount: 65,
        health: 35,
        killed: false,
      }),
    ]);
    await expect.poll(async () => (await seen(page)).marker).toContain('head');
    await expect.poll(async () => (await seen(page)).numbers).toContain('head:65');
    expect(await feedbackTotals(page)).toMatchObject({ hits: '1', headshots: '1', kills: '0' });
    expect(await page.evaluate(() => window.tls!.inspect().weaponView.activeSparks)).toBeLessThan(
      9,
    );
    expect(issues.problems()).toEqual([]);
  });

  test('a body shot deals 26 with a plain hit marker', async ({ page, issues }) => {
    await play(page);
    await ready(page);
    await record(page);
    await page.evaluate(() => window.tls!.aimAtTarget('dummy-3', 'TORSO'));
    await shoot(page);
    expect(await hits(page)).toEqual([
      expect.objectContaining({ targetId: 'dummy-3', zone: 'TORSO', critical: false, amount: 26 }),
    ]);
    await expect.poll(async () => (await seen(page)).marker).toContain('hit');
    await expect.poll(async () => (await seen(page)).numbers).toContain('hit:26');
    expect(issues.problems()).toEqual([]);
  });

  test('arm and leg shots on the zoned dummy use their multipliers', async ({ page, issues }) => {
    await play(page);
    await ready(page);
    await record(page);
    for (const zone of ['ARM_LEFT', 'ARM_RIGHT', 'LEG_LEFT', 'LEG_RIGHT']) {
      await page.evaluate((z) => window.tls!.aimAtTarget('dummy-2', z), zone);
      await shoot(page);
    }
    expect((await hits(page)).map((h) => [h.zone, Math.round(h.amount * 10) / 10])).toEqual([
      ['ARM_LEFT', 16.9],
      ['ARM_RIGHT', 16.9],
      ['LEG_LEFT', 13],
      ['LEG_RIGHT', 13],
    ]);
    expect(issues.problems()).toEqual([]);
  });

  test('killing a dummy: one kill, it falls, later shots are ignored, then it stands up', async ({
    page,
    issues,
  }) => {
    await play(page);
    await ready(page);
    await record(page);
    await shoot(page);
    await shoot(page);
    expect((await hits(page)).map((h) => [h.amount, h.health, h.killed])).toEqual([
      [65, 35, false],
      [35, 0, true],
    ]);
    expect(await kills(page)).toBe(1);
    await expect.poll(async () => (await seen(page)).marker).toContain('kill');
    await expect
      .poll(() => page.evaluate(() => window.tls!.inspect().dummyView.isDown('dummy-1')))
      .toBe(true);
    expect(await feedbackTotals(page)).toMatchObject({ kills: '1' });

    // Shots at the fallen dummy do nothing to it: they fly on to the tower behind.
    await page.evaluate(() => {
      const w = window as unknown as { __shotHits: string[] };
      w.__shotHits = [];
      window.tls!.inspect().weapons.events.on('shot', (s) => {
        w.__shotHits.push(s.pellets[0]?.hit?.kind ?? 'none');
      });
    });
    await shoot(page);
    await shoot(page);
    expect(await hits(page)).toHaveLength(2);
    expect(await kills(page)).toBe(1);
    expect(
      await page.evaluate(() => (window as unknown as { __shotHits: string[] }).__shotHits),
    ).toEqual(['world', 'world']);

    await expect
      .poll(async () => (await dummy(page, 'dummy-1'))?.alive, { timeout: 20_000 })
      .toBe(true);
    expect(await dummy(page, 'dummy-1')).toMatchObject({ health: 100, deaths: 1 });
    await expect
      .poll(() => page.evaluate(() => window.tls!.inspect().dummyView.isDown('dummy-1')))
      .toBe(false);
    expect(issues.problems()).toEqual([]);
  });

  test('reloading still works in combat; a shot fired mid-reload deals no damage', async ({
    page,
    issues,
  }) => {
    await play(page);
    await ready(page);
    await record(page);
    await page.evaluate(() => window.tls!.aimAtTarget('dummy-2', 'TORSO'));
    await shoot(page);
    await page.keyboard.press('KeyR');
    await frames(page, 3);
    expect((await page.evaluate(() => window.tls!.weapons())).held.state).toBe('reloading');
    await shoot(page);
    expect(await hits(page)).toHaveLength(1);
    await expect
      .poll(() => page.evaluate(() => window.tls!.weapons().held.ammo?.magazine), {
        timeout: 10_000,
      })
      .toBe(12);
    await shoot(page);
    expect((await hits(page)).map((h) => h.health)).toEqual([374, 348]);
    expect(issues.problems()).toEqual([]);
  });

  test('V: a quick melee within reach punches a dummy through the same pipeline', async ({
    page,
    issues,
  }) => {
    await play(page);
    await ready(page);
    await page.evaluate(() => {
      window.tls!.teleportPlayer(0, 0, 9.2, 0); // 1.2 m in front of dummy-1
      window.tls!.aimAtTarget('dummy-1', 'TORSO');
    });
    await frames(page, 3);
    await record(page);
    await page.keyboard.press('KeyV');
    await frames(page, 3);
    expect(await hits(page)).toEqual([
      expect.objectContaining({
        targetId: 'dummy-1',
        weaponId: 'bareHands',
        source: 'melee',
        quick: true,
        zone: 'TORSO',
        amount: 15,
      }),
    ]);
    expect((await page.evaluate(() => window.tls!.weapons())).loadout.active).toBe('primary');
    expect(issues.problems()).toEqual([]);
  });

  test('an ammo pickup refills a limited reserve when the player reaches it', async ({
    page,
    issues,
  }) => {
    await play(page);
    await page.evaluate(() => {
      // Stand in for a finite-ammo weapon: the Pistol's reserve is otherwise unlimited.
      const pistol = window.tls!.inspect().weapons.weaponIn('primary') as unknown as {
        reserve: number;
      };
      pistol.reserve = 0;
      window.tls!.spawnPickup('ammo', 0, 0, 12);
    });
    await frames(page, 3);
    expect(await page.evaluate(() => window.tls!.pickups())).toHaveLength(1);
    expect(await page.evaluate(() => window.tls!.inspect().pickupView.visibleCount)).toBe(1);
    await page.keyboard.down('KeyW');
    await expect
      .poll(() => page.evaluate(() => window.tls!.pickups().length), { timeout: 10_000 })
      .toBe(0);
    await page.keyboard.up('KeyW');
    expect((await page.evaluate(() => window.tls!.weapons())).held.ammo?.reserve).toBe(12);
    expect(issues.problems()).toEqual([]);
  });

  test('debug tools: hitboxes drawn over the dummies; damage numbers can be turned off', async ({
    page,
    issues,
  }) => {
    await play(page);
    await ready(page);
    expect(await page.evaluate(() => window.tls!.showHitboxes(true))).toBe(true);
    await frames(page, 3);
    const drawn = await page.evaluate(() => {
      const scene = window.tls!.inspect().camera.parent; // the world scene holds the camera
      const debug = scene?.getObjectByName('hitbox-debug');
      return debug?.children.filter((c) => c.visible).length ?? 0;
    });
    expect(drawn).toBe(18); // 3 dummies × 6 zones
    expect(await page.evaluate(() => window.tls!.showHitboxes(false))).toBe(false);

    expect(await page.evaluate(() => window.tls!.damageNumbers(false))).toBe(false);
    await record(page);
    await shoot(page);
    expect(await hits(page)).toHaveLength(1);
    await frames(page, 4);
    expect((await seen(page)).numbers).toEqual([]);
    expect(issues.problems()).toEqual([]);
  });
});

test('shoot and kill the dummy ahead with real input, read from the DOM (any build, no debug tools)', async ({
  page,
  issues,
}) => {
  await play(page);
  await expect.poll(async () => (await feedbackTotals(page)).hidden).toBe(false);
  expect(await feedbackTotals(page)).toMatchObject({ hits: '0', kills: '0' });
  await page.waitForTimeout(600); // the Pistol is raised at the start of a run

  // From the spawn, the dummy's head is at the crosshair: a headshot, then a kill.
  await shoot(page);
  await expect.poll(async () => (await feedbackTotals(page)).hits).toBe('1');
  expect(await feedbackTotals(page)).toMatchObject({ headshots: '1', marker: 'head' });
  await shoot(page);
  await expect.poll(async () => (await feedbackTotals(page)).kills).toBe('1');
  expect(await feedbackTotals(page)).toMatchObject({ hits: '2', marker: 'kill' });

  // The fallen dummy ignores further shots.
  await shoot(page);
  await frames(page, 4);
  expect(await feedbackTotals(page)).toMatchObject({ hits: '2', kills: '1' });

  // Reload works, and the dummy stands up again to be shot.
  await page.keyboard.press('KeyR');
  await expect
    .poll(() =>
      page.evaluate(() => document.querySelector<HTMLElement>('.weapon-hud')?.dataset.state),
    )
    .toBe('reloading');
  await expect
    .poll(
      async () => {
        await shoot(page);
        return (await feedbackTotals(page)).hits;
      },
      { timeout: 30_000, intervals: [500] },
    )
    .toBe('3');
  expect(issues.problems()).toEqual([]);
});
