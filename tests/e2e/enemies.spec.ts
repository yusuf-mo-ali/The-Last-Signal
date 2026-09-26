/**
 * The Phase 4 zombie foundation in a real browser (D-042): a Walker spawns, detects the player,
 * chases into attack range, telegraphs and hits through the player's Health; the player shoots
 * it through the Phase 3 pipeline (body shot, headshot, stagger, death); the player's death ends
 * the run, and a new run resets the player and the enemies. The development specs drive each
 * scenario through `tls`; the last spec uses only real input and the DOM, in every build.
 */

import type { Page } from '@playwright/test';
import {
  expect,
  frames,
  holdKeys,
  isDev,
  isPointerLocked,
  lockPrompt,
  openGame,
  test,
  type EnemySnapshot,
} from './helpers';

/** Opens the game and clicks "Click to play": the mouse is captured and a run starts. */
async function play(page: Page): Promise<void> {
  await openGame(page);
  await page.click('.lock-prompt');
  await frames(page, 4);
}

/** Removes the test encounter and the training dummies, and puts the player on the spawn. */
async function emptyYard(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.tls!.clearEnemies();
    window.tls!.clearDummies();
    window.tls!.teleportPlayer(0, 0, 14, 0); // the spawn, facing north across the yard
  });
  await frames(page, 2);
}

async function enemy(page: Page, id: string): Promise<EnemySnapshot | undefined> {
  return (await page.evaluate(() => window.tls!.enemies())).find((e) => e.id === id);
}

function healthHud(page: Page) {
  return page.evaluate(() => {
    const el = document.querySelector<HTMLElement>('.health-hud');
    return el
      ? {
          hidden: el.hidden,
          health: el.dataset.health ?? '',
          max: el.dataset.max ?? '',
          state: el.dataset.state ?? '',
        }
      : null;
  });
}

/** Records enemy state changes, attacks and player damage in the page. */
async function record(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __log: string[]; __windups: number[] };
    w.__log = [];
    w.__windups = [];
    const { enemies, playerHealth } = window.tls!.inspect();
    enemies.events.on('stateChanged', (e) => w.__log.push(`${e.id} ${e.from}>${e.to}`));
    enemies.events.on('attackStarted', (e) => {
      const enemy = enemies.get(e.id);
      const target = enemy?.target;
      const distance =
        enemy && target
          ? Math.hypot(
              target.position.x - enemy.motor.position.x,
              target.position.z - enemy.motor.position.z,
            )
          : Number.NaN;
      w.__log.push(`${e.id} windup`);
      w.__windups.push(distance);
    });
    enemies.events.on('attackHit', (e) => w.__log.push(`${e.id} hit ${e.amount}`));
    enemies.events.on('attackMissed', (e) => w.__log.push(`${e.id} missed ${e.reason}`));
    enemies.events.on('attackCancelled', (e) => w.__log.push(`${e.id} cancelled ${e.reason}`));
    enemies.events.on('died', (e) => w.__log.push(`${e.id} died`));
    enemies.events.on('despawned', (e) => w.__log.push(`${e.id} despawned`));
    playerHealth.events.on('damaged', (e) =>
      w.__log.push(
        `player -${e.amount} =${e.health} from ${e.source.kind === 'enemy' ? e.source.id : e.source.kind}`,
      ),
    );
    playerHealth.events.on('died', () => w.__log.push('player died'));
  });
}

function log(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __log: string[] }).__log);
}

/** Target distance at the start of each wind-up. */
function windups(page: Page): Promise<number[]> {
  return page.evaluate(() => (window as unknown as { __windups: number[] }).__windups);
}

/** Spawns an enemy ahead in the same frame as `after` runs (e.g. freezing it), returns its id. */
function spawnAhead(page: Page, distance: number, freeze = false): Promise<string> {
  return page.evaluate(
    ([d, f]) => {
      const id = window.tls!.spawnEnemy('walker', d);
      if (f) {
        window.tls!.freezeEnemies(true);
      }
      return id;
    },
    [distance, freeze] as const,
  );
}

/** The strongest attack glow seen on an enemy in any frame since the call. */
async function watchGlow(page: Page, id: string): Promise<void> {
  await page.evaluate((target) => {
    const w = window as unknown as { __glow: number };
    w.__glow = 0;
    const view = window.tls!.inspect().enemyView;
    const tick = (): void => {
      w.__glow = Math.max(w.__glow, view.telegraph(target));
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, id);
}

/** Positions rounded to whole metres (−0 read as 0). */
function rounded(position: readonly number[]): number[] {
  return position.map((v) => Math.round(v) + 0);
}

/** One click, then enough time for the Pistol to be ready again. */
async function shoot(page: Page): Promise<void> {
  await page.mouse.down();
  await page.mouse.up();
  await frames(page, 3);
  await page.waitForTimeout(250);
}

test.describe('enemies (development build)', () => {
  // Playwright requires a destructuring pattern for the fixtures argument, even when unused.
  // eslint-disable-next-line no-empty-pattern
  test.beforeEach(({}, testInfo) => {
    test.skip(!isDev(testInfo), 'drives the scenario through the development tools');
  });

  test('a Walker spawns, detects and chases the player, telegraphs, and hits through the player’s Health', async ({
    page,
    issues,
  }) => {
    test.setTimeout(90_000);
    await play(page);
    await emptyYard(page);
    await record(page);

    const { id, spawned } = await page.evaluate(() => {
      const newId = window.tls!.spawnEnemy('walker', 6);
      return { id: newId, spawned: window.tls!.enemies().find((e) => e.id === newId) };
    });
    expect(spawned).toMatchObject({
      archetype: 'walker',
      state: 'IDLE',
      health: 120,
      maxHealth: 120,
      target: null,
      attacks: 0,
    });
    expect(rounded(spawned?.position ?? [])).toEqual([0, 0, 8]);
    expect(await page.evaluate(() => window.tls!.combat().targets)).toBe(1);
    await expect.poll(() => page.evaluate(() => window.tls!.inspect().enemyView.count)).toBe(1);
    await watchGlow(page, id);

    // Detection: in range and in sight, it notices the player, then walks straight at them.
    let chasing: EnemySnapshot | undefined;
    await expect
      .poll(
        async () => {
          chasing = await enemy(page, id);
          return chasing?.state;
        },
        { timeout: 10_000 },
      )
      .toBe('CHASE');
    expect(chasing).toMatchObject({ target: 'player', canSeeTarget: true, nav: 'direct' });

    // It winds up only within attack range, stopping short of the player, and the wind-up glows.
    await expect.poll(() => log(page), { timeout: 30_000 }).toContain(`${id} windup`);
    const [first] = await windups(page);
    expect(first).toBeLessThanOrEqual(1.5);
    expect(first).toBeGreaterThan(0.8);

    // The strike goes through the player's Health: 15 damage, shown by the health HUD.
    await expect.poll(() => log(page), { timeout: 10_000 }).toContain(`player -15 =85 from ${id}`);
    await expect.poll(async () => (await healthHud(page))?.health).not.toBe('100');
    expect(
      await page.evaluate(() => (window as unknown as { __glow: number }).__glow),
    ).toBeGreaterThan(0.3);
    const events = await log(page);
    expect(events.slice(0, 3)).toEqual([
      `${id} IDLE>DETECT`,
      `${id} DETECT>CHASE`,
      `${id} CHASE>ATTACK`,
    ]);
    expect(events.indexOf(`${id} windup`)).toBeLessThan(events.indexOf(`${id} hit 15`));
    // One strike per wind-up at most, each one a hit on the player standing still.
    const hits = events.filter((e) => e === `${id} hit 15`).length;
    expect(hits).toBeGreaterThanOrEqual(1);
    expect(hits).toBeLessThanOrEqual(events.filter((e) => e === `${id} windup`).length);
    expect(events.filter((e) => e.startsWith(`${id} missed`))).toEqual([]);

    // Pausing the game stops the Walker and the damage; resuming continues where it was.
    await page.evaluate(() => {
      document.exitPointerLock();
    });
    await frames(page, 4);
    expect(await lockPrompt(page)).toEqual({ mode: 'paused', hidden: false });
    const paused = await page.evaluate(() => ({
      walker: window.tls!.enemies(),
      health: window.tls!.playerHealth().health,
    }));
    await page.waitForTimeout(1500);
    expect(
      await page.evaluate(() => ({
        walker: window.tls!.enemies(),
        health: window.tls!.playerHealth().health,
      })),
    ).toEqual(paused);
    expect(issues.problems()).toEqual([]);
  });

  test('shooting a Walker: body shot, headshot with stagger, death, corpse and clean removal', async ({
    page,
    issues,
  }) => {
    test.setTimeout(90_000);
    await play(page);
    await expect.poll(() => page.evaluate(() => window.tls!.weapons().switching)).toBe(false);
    await emptyYard(page);
    await record(page);
    // Held still while aiming (the rest of the game runs on).
    const id = await spawnAhead(page, 6, true);

    const aim = (zone: string) =>
      page.evaluate(([target, z]) => window.tls!.aimAtTarget(target, z), [id, zone] as const);

    // Body shot: the Pistol's 26, below the Walker's stagger threshold; it alerts the Walker.
    await aim('TORSO');
    await shoot(page);
    expect((await page.evaluate(() => window.tls!.combat())).recentHits).toEqual([
      expect.objectContaining({ target: id, zone: 'TORSO', critical: false, amount: 26 }),
    ]);
    expect(await enemy(page, id)).toMatchObject({ health: 94, state: 'DETECT', target: 'player' });

    // Headshot: 26 × 2.5 = 65, a critical hit that staggers it.
    await aim('HEAD');
    await shoot(page);
    expect((await page.evaluate(() => window.tls!.combat())).recentHits.at(-1)).toMatchObject({
      target: id,
      zone: 'HEAD',
      critical: true,
      amount: 65,
      health: 29,
      killed: false,
    });
    expect(await enemy(page, id)).toMatchObject({ health: 29, state: 'STAGGER' });

    // It recovers by itself once the simulation runs again.
    await page.evaluate(() => window.tls!.freezeEnemies(false));
    await expect
      .poll(async () => (await enemy(page, id))?.state, { timeout: 10_000 })
      .toMatch(/CHASE|ATTACK/);
    await page.evaluate(() => window.tls!.freezeEnemies(true));

    // A second headshot kills it: exactly one death, and a dead Walker takes no more damage.
    await aim('HEAD');
    await shoot(page);
    const kill = (await page.evaluate(() => window.tls!.combat())).recentHits.at(-1);
    expect(kill).toMatchObject({ target: id, zone: 'HEAD', killed: true, health: 0 });
    expect(await enemy(page, id)).toMatchObject({ health: 0, state: 'DEAD', target: null });
    expect(await page.evaluate((e) => window.tls!.damageEnemy(e, 50), id)).toBeNull();
    const hitsBefore = (await page.evaluate(() => window.tls!.combat())).recentHits.length;
    await aim('TORSO');
    await shoot(page);
    expect((await page.evaluate(() => window.tls!.combat())).recentHits).toHaveLength(hitsBefore);

    // The body falls, lies for its corpse time, then is removed from the game exactly once.
    await page.evaluate(() => window.tls!.freezeEnemies(false));
    await expect
      .poll(() => page.evaluate((e) => window.tls!.inspect().enemyView.isDown(e), id), {
        timeout: 5000,
      })
      .toBe(true);
    await expect
      .poll(() => page.evaluate(() => window.tls!.enemies().length), { timeout: 20_000 })
      .toBe(0);
    await expect.poll(() => page.evaluate(() => window.tls!.inspect().enemyView.count)).toBe(0);
    expect(await page.evaluate(() => window.tls!.combat().targets)).toBe(0);
    const events = await log(page);
    expect(events.filter((e) => e === `${id} died`)).toHaveLength(1);
    expect(events.filter((e) => e === `${id} despawned`)).toHaveLength(1);
    expect(events).toContain(`${id} IDLE>DETECT`);
    expect(events).toContain(`${id} DETECT>STAGGER`);
    expect(events.filter((e) => e.endsWith('>DEAD'))).toEqual([
      expect.stringMatching(new RegExp(`^${id} (CHASE|ATTACK)>DEAD$`)),
    ]);
    expect(events.at(-1)).toBe(`${id} despawned`);
    expect(issues.problems()).toEqual([]);
  });

  test('a Walker’s last hit kills the player: GAME_OVER once, and a new run resets player and enemies', async ({
    page,
    issues,
  }) => {
    test.setTimeout(90_000);
    await play(page);
    await emptyYard(page);
    await record(page);
    // Sandbox extras that a new run must remove.
    await page.evaluate(() => {
      window.tls!.spawnWalkers(4, 14);
      window.tls!.damagePlayer(90);
    });
    await expect.poll(async () => (await healthHud(page))?.health).toBe('10'); // next frame
    const id = await spawnAhead(page, 3);

    await expect
      .poll(() => page.evaluate(() => window.tls!.state()), { timeout: 30_000 })
      .toMatchObject({ current: 'GAME_OVER' });
    expect(await page.evaluate(() => window.tls!.playerHealth())).toMatchObject({
      health: 0,
      dead: true,
    });
    const events = await log(page);
    expect(events).toContain(`player -10 =0 from ${id}`); // the overkill is not counted
    expect(events.filter((e) => e === 'player died')).toHaveLength(1);
    await frames(page, 4);
    expect(await isPointerLocked(page)).toBe(false);
    expect(await lockPrompt(page)).toEqual({ mode: 'game-over', hidden: false });
    await expect(page.locator('.lock-prompt')).toContainText('You died');
    expect((await healthHud(page))?.state).toBe('dead');

    // The world holds still behind the prompt: no more enemy steps, no more damage.
    const frozen = await page.evaluate(() => window.tls!.enemies());
    await page.waitForTimeout(1200);
    expect(await page.evaluate(() => window.tls!.enemies())).toEqual(frozen);
    expect(await page.evaluate(() => window.tls!.damagePlayer(10))).toMatchObject({ health: 0 });
    expect((await log(page)).filter((e) => e === 'player died')).toHaveLength(1);

    // Click: a new run. Full health, the three encounter Walkers back at their posts.
    await page.click('.lock-prompt');
    await frames(page, 4);
    expect(await page.evaluate(() => window.tls!.state())).toMatchObject({
      current: 'WAVE_ACTIVE',
    });
    expect(await isPointerLocked(page)).toBe(true);
    expect(await healthHud(page)).toEqual({
      hidden: false,
      health: '100',
      max: '100',
      state: 'alive',
    });
    const fresh = await page.evaluate(() => window.tls!.enemies());
    expect(fresh.map((e) => [e.id, e.health, e.target])).toEqual([
      ['walker-1', 120, null],
      ['walker-2', 120, null],
      ['walker-3', 120, null],
    ]);
    expect(fresh.map((e) => rounded(e.position))).toEqual([
      [8, 0, 2],
      [-8, 0, 1],
      [12, 0, -3],
    ]);
    await expect.poll(() => page.evaluate(() => window.tls!.inspect().enemyView.count)).toBe(3);
    // Dummies (cleared above) are back as well: 3 dummies + 3 Walkers.
    expect(await page.evaluate(() => window.tls!.combat())).toMatchObject({
      targets: 6,
      alive: 6,
    });
    expect(issues.problems()).toEqual([]);
  });

  test('debug views: Walker hitboxes and AI labels, ranges, target line and route', async ({
    page,
    issues,
  }) => {
    await play(page);
    await emptyYard(page);
    const id = await spawnAhead(page, 7, true);

    expect(await page.evaluate(() => window.tls!.showHitboxes(true))).toBe(true);
    await frames(page, 3);
    const hitboxes = await page.evaluate(() => {
      const scene = window.tls!.inspect().camera.parent;
      return scene?.getObjectByName('hitbox-debug')?.children.filter((c) => c.visible).length;
    });
    expect(hitboxes).toBe(6); // one Walker × 6 zones
    expect(await page.evaluate(() => window.tls!.showHitboxes(false))).toBe(false);

    expect(await page.evaluate(() => window.tls!.showAI(true))).toBe(true);
    await frames(page, 3);
    const label = page.locator('.enemy-debug__label');
    await expect(label).toHaveCount(1);
    await expect(label).toHaveText(`${id} IDLE 120`);
    await expect(label).toHaveAttribute('data-state', 'IDLE');
    await expect(label).toBeVisible();

    // Forced states show up; illegal ones are refused.
    expect(await page.evaluate((e) => window.tls!.setEnemyState(e, 'ATTACK'), id)).toBe(false);
    expect(await page.evaluate((e) => window.tls!.setEnemyState(e, 'PATROL'), id)).toBe(true);
    await frames(page, 2);
    await expect(label).toHaveAttribute('data-state', 'PATROL');

    const lines = () =>
      page.evaluate(() => {
        const scene = window.tls!.inspect().camera.parent;
        const root = scene?.getObjectByName('enemy-debug');
        const marker = root?.children[0];
        return marker ? marker.children.map((c) => c.visible) : [];
      });
    // Detection ring, attack ring visible; no target line or route yet.
    expect(await lines()).toEqual([true, true, false, false]);
    expect(await page.evaluate(() => window.tls!.alertEnemies())).toBe(1);
    await frames(page, 2);
    expect((await lines()).slice(0, 3)).toEqual([true, true, true]);
    expect(await page.evaluate((e) => window.tls!.enemy(e), id)).toMatchObject({
      id,
      target: 'player',
      state: 'DETECT',
    });

    // Damage and kill from the console update the label, then the marker goes with the body.
    expect(await page.evaluate((e) => window.tls!.damageEnemy(e, 25), id)).toEqual({
      health: 95,
      killed: false,
    });
    await frames(page, 2);
    await expect(label).toHaveText(`${id} DETECT 95`);
    expect(await page.evaluate((e) => window.tls!.killEnemy(e), id)).toBe(true);
    await frames(page, 2);
    await expect(label).toHaveText(`${id} DEAD 0`);
    expect(await lines()).toEqual([false, false, false, false]);
    expect(await page.evaluate(() => window.tls!.clearEnemies())).toBe(0);
    await frames(page, 2);
    await expect(label).toHaveCount(0);
    expect(await page.evaluate(() => window.tls!.showAI(false))).toBe(false);
    await expect(page.locator('.enemy-debug')).toHaveCount(0);
    expect(issues.problems()).toEqual([]);
  });

  test('a crowd of 16 Walkers: spawned clear of obstacles, all chase, stay on the floor and apart', async ({
    page,
    issues,
  }) => {
    test.setTimeout(90_000);
    await play(page);
    await emptyYard(page);
    await page.evaluate(() => window.tls!.setGodMode(true));
    // Rows start 6 m ahead; the spots inside the crate on the right are skipped.
    const ids = await page.evaluate(() => window.tls!.spawnWalkers(16, 6));
    expect(ids).toHaveLength(16);
    expect(await page.evaluate(() => window.tls!.alertEnemies())).toBe(16);
    await expect.poll(() => page.evaluate(() => window.tls!.inspect().enemyView.count)).toBe(16);
    // Wait for the crowd to gather around the player.
    await expect
      .poll(
        async () =>
          (await page.evaluate(() => window.tls!.enemies())).filter(
            (e) => (e.targetDistance ?? 99) < 3,
          ).length,
        { timeout: 40_000 },
      )
      .toBeGreaterThanOrEqual(6);
    const crowd = await page.evaluate(() => window.tls!.enemies());
    expect(crowd.every((e) => e.target === 'player' && e.health === 120)).toBe(true);
    for (const e of crowd) {
      expect(e.position[1], e.id).toBeCloseTo(0, 3); // on the yard floor
    }
    let closest = Infinity;
    for (let i = 0; i < crowd.length; i++) {
      for (let j = i + 1; j < crowd.length; j++) {
        const a = crowd[i]?.position ?? [0, 0, 0];
        const b = crowd[j]?.position ?? [0, 0, 0];
        closest = Math.min(closest, Math.hypot(a[0] - b[0], a[2] - b[2]));
      }
    }
    expect(closest, 'no two bodies inside each other').toBeGreaterThan(0.45);
    expect(await page.evaluate(() => window.tls!.playerHealth())).toMatchObject({
      health: 100,
      godMode: true,
    });
    expect(await page.evaluate(() => window.tls!.killAll())).toBe(16);
    expect(issues.problems()).toEqual([]);
  });
});

test('walk into the yard with real keys: Walkers attack, the player dies, and a new run starts clean (any build, no debug tools)', async ({
  page,
  issues,
}) => {
  test.setTimeout(150_000);
  await play(page);
  await expect.poll(async () => (await healthHud(page))?.hidden).toBe(false);
  expect(await healthHud(page)).toEqual({
    hidden: false,
    health: '100',
    max: '100',
    state: 'alive',
  });

  // North into the yard, between the two sentries (8 m to either side), and wait. At full speed
  // the walk ends against the signal tower; on a slow machine (simulated time runs slower than
  // real time below ~12 FPS) it still gets well inside their detection range.
  await holdKeys(page, ['KeyW'], 2500);
  await expect
    .poll(async () => Number((await healthHud(page))?.health), { timeout: 60_000 })
    .toBeLessThan(100);
  // Standing still, the Walkers finish the player.
  await expect
    .poll(async () => (await lockPrompt(page))?.mode, { timeout: 90_000 })
    .toBe('game-over');
  expect(await isPointerLocked(page)).toBe(false);
  await expect(page.locator('.lock-prompt')).toContainText('You died');

  await page.click('.lock-prompt');
  await frames(page, 4);
  expect(await lockPrompt(page)).toEqual({ mode: 'hidden', hidden: true });
  expect(await healthHud(page)).toEqual({
    hidden: false,
    health: '100',
    max: '100',
    state: 'alive',
  });
  expect(issues.problems()).toEqual([]);
});
