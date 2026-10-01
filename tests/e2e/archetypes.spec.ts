/**
 * The archetypes and traits in a real browser (D-043, D-046): the Runner's fast chase and leap,
 * the Tank's slow, heavy attack and armoured body, the Screamer's telegraphed scream (the alarm,
 * its violet sonic wave, the player's alarm pulse, nearby enemies alerted, hastened and frenzied),
 * the Spitter's telegraphed, dodgeable acid, traits visible on the body and felt in combat, and a
 * mixed group sharing one combat and navigation. Development
 * build only: each scenario is set up through `tls`; the production build is covered by the
 * real-input spec in enemies.spec.ts (the test encounter now holds one of each archetype).
 */

import type { Page } from '@playwright/test';
import { expect, frames, isDev, openGame, test, type EnemySnapshot } from './helpers';

async function play(page: Page): Promise<void> {
  await openGame(page);
  await page.click('.lock-prompt');
  await frames(page, 4);
  await expect.poll(() => page.evaluate(() => window.tls!.weapons().switching)).toBe(false);
}

/** No encounter, no dummies; the player on the spawn facing north across the yard. */
async function emptyYard(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.tls!.clearEnemies();
    window.tls!.clearDummies();
    window.tls!.teleportPlayer(0, 0, 14, 0);
  });
  await frames(page, 2);
}

async function enemy(page: Page, id: string): Promise<EnemySnapshot | undefined> {
  return (await page.evaluate(() => window.tls!.enemies())).find((e) => e.id === id);
}

/** Records enemy events and player damage in the page (read with `log`). */
async function record(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __log: string[] };
    w.__log = [];
    const { enemies, playerHealth, combat } = window.tls!.inspect();
    enemies.events.on('stateChanged', (e) => w.__log.push(`${e.id} ${e.from}>${e.to}`));
    enemies.events.on('attackStarted', (e) => w.__log.push(`${e.id} ${e.kind}`));
    enemies.events.on('attackHit', (e) => w.__log.push(`${e.id} hit ${e.amount}`));
    enemies.events.on('attackCancelled', (e) => w.__log.push(`${e.id} cancelled ${e.reason}`));
    enemies.events.on('alarm', (e) =>
      w.__log.push(`alarm ${e.sourceId} ${e.kind} r${e.radius} ${e.targetId ?? '-'}`),
    );
    enemies.events.on('hasted', (e) => w.__log.push(`${e.id} hasted ${e.multiplier}`));
    enemies.events.on('frenzied', (e) => w.__log.push(`${e.id} frenzied ${e.kind}`));
    enemies.events.on('spat', (e) => w.__log.push(`${e.id} spat`));
    window
      .tls!.inspect()
      .projectiles.events.on('projectileImpact', (e) => w.__log.push(`acid ${e.kind} ${e.amount}`));
    enemies.events.on('traitsChanged', (e) => w.__log.push(`${e.id} traits ${e.traits.join('+')}`));
    enemies.events.on('died', (e) => w.__log.push(`${e.id} died`));
    combat.events.on('armorBroken', (e) => w.__log.push(`${e.targetId} lost ${e.plateId}`));
    playerHealth.events.on('damaged', (e) =>
      w.__log.push(
        `player -${e.amount} from ${e.source.kind === 'enemy' ? e.source.id : e.source.kind}`,
      ),
    );
  });
}

function log(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __log: string[] }).__log);
}

/** Every attack phase an enemy is seen in, frame by frame, since the call. */
async function watchPhases(page: Page, id: string): Promise<void> {
  await page.evaluate((target) => {
    const w = window as unknown as { __phases: string[]; __glow: number };
    w.__phases = [];
    w.__glow = 0;
    const { enemies, enemyView } = window.tls!.inspect();
    const tick = (): void => {
      const e = enemies.get(target);
      if (e && w.__phases.at(-1) !== e.attackPhase) {
        w.__phases.push(e.attackPhase);
      }
      w.__glow = Math.max(w.__glow, enemyView.telegraph(target));
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, id);
}

function phases(page: Page): Promise<{ phases: string[]; glow: number }> {
  return page.evaluate(() => {
    const w = window as unknown as { __phases: string[]; __glow: number };
    return { phases: w.__phases, glow: w.__glow };
  });
}

async function shoot(page: Page): Promise<void> {
  await page.mouse.down();
  await page.mouse.up();
  await frames(page, 3);
  await page.waitForTimeout(250);
}

async function shootAt(page: Page, id: string, zone: string): Promise<void> {
  await page.evaluate(([target, z]) => window.tls!.aimAtTarget(target, z), [id, zone] as const);
  await shoot(page);
}

async function lastHit(page: Page) {
  return (await page.evaluate(() => window.tls!.combat())).recentHits.at(-1);
}

test.describe('archetypes and traits (development build)', () => {
  // eslint-disable-next-line no-empty-pattern
  test.beforeEach(({}, testInfo) => {
    test.skip(!isDev(testInfo), 'drives the scenario through the development tools');
  });

  test('Runner: a fast chase, a telegraphed leap that lands, a body shot staggers, a headshot kills', async ({
    page,
    issues,
  }) => {
    test.setTimeout(180_000);
    await play(page);
    await emptyYard(page);
    await record(page);
    const id = await page.evaluate(() => window.tls!.spawnEnemy('runner', 12));
    expect(await enemy(page, id)).toMatchObject({ archetype: 'runner', health: 60, traits: [] });
    await watchPhases(page, id);
    await page.evaluate(() => window.tls!.alertEnemies());

    // It covers 12 m and hits: wind-up, leap, strike, through the player's Health.
    await expect.poll(() => log(page), { timeout: 90_000 }).toContain(`player -10 from ${id}`);
    const seen = await phases(page);
    expect(seen.phases.slice(0, 4)).toEqual(['none', 'windup', 'lunge', 'recovery']);
    expect(seen.glow).toBeGreaterThan(0.3);
    const events = await log(page);
    expect(events).toContain(`${id} strike`);
    expect(events).toContain(`${id} hit 10`);

    // Shot while it is held still, from 6 m in front of it (point-blank, its lean puts its head
    // over its chest):
    // one body shot staggers it (26 ≥ 20), a headshot kills it.
    await page.evaluate((e) => {
      window.tls!.freezeEnemies(true);
      const runner = window.tls!.enemy(e);
      const [x, y, z] = runner.position;
      const heading = runner.heading as number;
      // In front of it, so no arm hangs between the gun and its chest.
      window.tls!.teleportPlayer(
        x - Math.sin(heading) * 6,
        y,
        z - Math.cos(heading) * 6,
        heading + Math.PI,
      );
    }, id);
    await frames(page, 2);
    await shootAt(page, id, 'TORSO');
    expect(await lastHit(page)).toMatchObject({ target: id, zone: 'TORSO', amount: 26 });
    expect(await enemy(page, id)).toMatchObject({ state: 'STAGGER', health: 34 });
    await shootAt(page, id, 'HEAD');
    expect(await lastHit(page)).toMatchObject({ target: id, zone: 'HEAD', killed: true });
    expect(await enemy(page, id)).toMatchObject({ state: 'DEAD', health: 0 });
    expect(issues.problems()).toEqual([]);
  });

  test('Tank: slow, a long telegraph and a 35-point hit; body shots are soaked, a headshot staggers', async ({
    page,
    issues,
  }) => {
    test.setTimeout(240_000);
    await play(page);
    await emptyYard(page);
    await record(page);
    const id = await page.evaluate(() => window.tls!.spawnEnemy('tank', 5));
    expect(await enemy(page, id)).toMatchObject({ archetype: 'tank', health: 360 });
    await watchPhases(page, id);
    await page.evaluate(() => window.tls!.alertEnemies());
    await expect.poll(() => log(page), { timeout: 150_000 }).toContain(`player -35 from ${id}`);
    const seen = await phases(page);
    expect(seen.phases.slice(0, 3)).toEqual(['none', 'windup', 'recovery']); // no leap
    expect(seen.glow).toBeGreaterThan(0.3);
    const speed = await page.evaluate(
      (e) => (window.tls!.enemy(e).stats as { moveSpeed: number }).moveSpeed,
      id,
    );
    expect(speed).toBeLessThan(1.6); // slower than a Walker

    await page.evaluate(() => {
      window.tls!.freezeEnemies(true);
      window.tls!.healPlayer(100);
    });
    await page.waitForTimeout(1200); // out of the last hit's stagger window
    await shootAt(page, id, 'TORSO');
    expect(await lastHit(page)).toMatchObject({ target: id, zone: 'TORSO', amount: 13 });
    expect((await enemy(page, id))?.state).not.toBe('STAGGER');
    await shootAt(page, id, 'HEAD');
    expect(await lastHit(page)).toMatchObject({ target: id, zone: 'HEAD', amount: 65 });
    expect(await enemy(page, id)).toMatchObject({ state: 'STAGGER', health: 360 - 13 - 65 });
    expect(issues.problems()).toEqual([]);
  });

  test('Screamer: detects, raises its arms and glows, screams: alarm, shockwave, pulse, the pack alerted and hastened', async ({
    page,
    issues,
  }) => {
    test.setTimeout(180_000);
    await play(page);
    await emptyYard(page);
    await page.evaluate(() => window.tls!.setGodMode(true));
    await record(page);
    // A Screamer 12 m ahead; a Walker behind it, too far from the player to notice on its own.
    const { screamer, walker } = await page.evaluate(() => ({
      screamer: window.tls!.spawnEnemy('screamer', 12),
      walker: window.tls!.spawnEnemy('walker', 25),
    }));
    await watchPhases(page, screamer);
    // The strongest alarm pulse and the most shockwave rings drawn in any frame (both fade fast).
    await page.evaluate(() => {
      const w = window as unknown as { __pulse: number; __rings: number };
      w.__pulse = 0;
      w.__rings = 0;
      const view = window.tls!.inspect().enemyView;
      const tick = (): void => {
        const el = document.querySelector<HTMLElement>('.alarm-pulse');
        w.__pulse = Math.max(w.__pulse, Number(el?.style.opacity ?? 0));
        w.__rings = Math.max(w.__rings, view.activeRings);
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    const pulses = () =>
      page.evaluate(() => document.querySelector<HTMLElement>('.alarm-pulse')?.dataset.pulses);
    expect(await pulses()).toBe('0');

    await expect
      .poll(() => log(page), { timeout: 90_000 })
      .toContain(`alarm ${screamer} scream r18 player`);
    const events = await log(page);
    expect(events).toContain(`${screamer} scream`);
    expect(events.indexOf(`${screamer} scream`)).toBeLessThan(
      events.indexOf(`alarm ${screamer} scream r18 player`),
    );
    const seen = await phases(page);
    expect(seen.phases.slice(0, 3)).toEqual(['none', 'windup', 'recovery']);
    expect(seen.glow).toBeGreaterThan(0.3);
    // What the player sees and what the alarm did: a shockwave, the screen pulse, the Walker told.
    // A sonic wave: three violet rings in a row (D-046).
    expect(
      await page.evaluate(() => (window as unknown as { __rings: number }).__rings),
    ).toBeGreaterThanOrEqual(3);
    expect(await pulses()).toBe('1');
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __pulse: number }).__pulse))
      .toBeGreaterThan(0.3);
    expect(events).toContain(`${walker} hasted 1.35`);
    // …and frenzied: its eyes flare violet while it lasts (D-046).
    expect(events).toContain(`${walker} frenzied scream`);
    expect(await enemy(page, walker)).toMatchObject({
      target: 'player',
      hasted: true,
      frenzied: 'scream',
    });
    expect(await page.evaluate((w) => window.tls!.inspect().enemyView.eyes(w)?.color, walker)).toBe(
      0xc070ff,
    );
    expect(events.filter((e) => e.startsWith(`${screamer} hit`))).toEqual([]); // it never hits

    // The next scream can be interrupted: a body shot during the wind-up staggers it.
    await page.evaluate(() => window.tls!.killEnemy(window.tls!.enemies()[1]!.id));
    await expect
      .poll(async () => (await enemy(page, screamer))?.attack, { timeout: 20_000 })
      .toBe('none');
    expect(await page.evaluate((s) => window.tls!.forceAbility(s), screamer)).toBe(true);
    await page.evaluate(() => window.tls!.freezeEnemies(true));
    await shootAt(page, screamer, 'TORSO');
    expect(await enemy(page, screamer)).toMatchObject({ state: 'STAGGER', attack: 'none' });
    expect(await log(page)).toContain(`${screamer} cancelled stagger`);
    await page.evaluate(() => window.tls!.freezeEnemies(false));
    await page.waitForTimeout(1500);
    expect((await log(page)).filter((e) => e.startsWith('alarm'))).toHaveLength(1);
    expect(issues.problems()).toEqual([]);
  });

  test('traits: plates, a helmet and spikes on the body; the helmet breaks off; applied and removed live', async ({
    page,
    issues,
  }) => {
    test.setTimeout(180_000);
    await play(page);
    await emptyYard(page);
    await record(page);
    const ids = await page.evaluate(() => {
      window.tls!.freezeEnemies(true);
      return window.tls!.spawnMixed(4, 7);
    });
    expect(ids).toEqual(['walker-1', 'runner-2', 'tank-3', 'screamer-4']);
    await page.evaluate(() => {
      window.tls!.setTraits('walker-1', ['armored']);
      window.tls!.setTraits('runner-2', 'helmeted');
      window.tls!.setTraits('tank-3', ['elite']);
      window.tls!.setTraits('screamer-4', ['elite', 'helmeted', 'armored']);
    });
    await frames(page, 2);
    const attachments = () =>
      page.evaluate(
        (list) => list.map((id) => window.tls!.inspect().enemyView.attachments(id)),
        ids,
      );
    expect(await attachments()).toEqual([
      ['plates'],
      ['helmet'],
      ['spikes'],
      ['plates', 'helmet', 'spikes'],
    ]);
    const enemies = await page.evaluate(() => window.tls!.enemies());
    expect(enemies.map((e) => [e.id, e.traits, e.maxHealth])).toEqual([
      ['walker-1', ['armored'], 120],
      ['runner-2', ['helmeted'], 60],
      ['tank-3', ['elite'], 576],
      ['screamer-4', ['armored', 'helmeted', 'elite'], 128],
    ]);

    // Armored: a body shot loses its armor's worth. Helmeted: the first headshot knocks it off.
    await shootAt(page, 'walker-1', 'TORSO');
    expect(await lastHit(page)).toMatchObject({ target: 'walker-1', amount: 16 });
    await shootAt(page, 'runner-2', 'HEAD');
    expect(await lastHit(page)).toMatchObject({ target: 'runner-2', zone: 'HEAD', amount: 15 });
    expect(await log(page)).toContain('runner-2 lost helmet');
    await frames(page, 2);
    expect((await attachments())[1]).toEqual([]); // the helmet is gone from its head
    expect(await enemy(page, 'runner-2')).toMatchObject({ state: 'STAGGER', health: 45 });
    await shootAt(page, 'runner-2', 'HEAD');
    expect(await lastHit(page)).toMatchObject({ target: 'runner-2', killed: true });

    // Live changes: removed and added through the debug tools, drawn at once.
    expect(await page.evaluate(() => window.tls!.removeTrait('tank-3', 'elite'))).toEqual([]);
    expect(await page.evaluate(() => window.tls!.applyTrait('walker-1', 'elite'))).toEqual([
      'armored',
      'elite',
    ]);
    await frames(page, 2);
    expect((await attachments())[0]).toEqual(['plates', 'spikes']);
    expect((await attachments())[2]).toEqual([]);
    expect(await enemy(page, 'tank-3')).toMatchObject({ maxHealth: 360 });
    expect(await log(page)).toEqual(
      expect.arrayContaining(['tank-3 traits ', 'walker-1 traits armored+elite']),
    );
    await expect(page.evaluate(() => window.tls!.applyTrait('walker-1', 'cursed'))).rejects.toThrow(
      /Unknown trait/,
    );
    expect(issues.problems()).toEqual([]);
  });

  test('a mixed group: every archetype chases and fights through the same systems, nobody inside anybody', async ({
    page,
    issues,
  }) => {
    test.setTimeout(240_000);
    await play(page);
    await emptyYard(page);
    await page.evaluate(() => window.tls!.setGodMode(true));
    await record(page);
    const ids = await page.evaluate(() => window.tls!.spawnMixed(10, 9));
    expect(ids.map((id) => id.split('-')[0])).toEqual([
      'walker',
      'runner',
      'tank',
      'screamer',
      'spitter',
      'walker',
      'runner',
      'tank',
      'screamer',
      'spitter',
    ]);
    expect(await page.evaluate(() => window.tls!.alertEnemies())).toBe(10);
    await expect.poll(() => page.evaluate(() => window.tls!.inspect().enemyView.count)).toBe(10);
    expect(await page.evaluate(() => window.tls!.combat().targets)).toBe(10);

    // Every melee archetype lands a hit, a Screamer screams and a Spitter spits.
    await expect
      .poll(
        async () => {
          const events = await log(page);
          return ['walker', 'runner', 'tank', 'alarm', 'spat'].filter((kind) =>
            events.some((e) =>
              kind === 'alarm'
                ? e.startsWith('alarm')
                : kind === 'spat'
                  ? e.endsWith(' spat')
                  : new RegExp(`^${kind}-\\d+ hit`).test(e),
            ),
          );
        },
        { timeout: 200_000 },
      )
      .toEqual(['walker', 'runner', 'tank', 'alarm', 'spat']);
    const crowd = await page.evaluate(() => window.tls!.enemies());
    expect(crowd.every((e) => e.target === 'player')).toBe(true);
    for (const e of crowd) {
      expect(e.position[1], e.id).toBeCloseTo(0, 2);
    }
    // The AI view shows every archetype with its own rings (the Screamers’ scream range too).
    expect(await page.evaluate(() => window.tls!.showAI(true))).toBe(true);
    await frames(page, 3);
    await expect(page.locator('.enemy-debug__label[data-archetype="screamer"]')).toHaveCount(2);
    await expect(page.locator('.enemy-debug__label[data-archetype="tank"]')).toHaveCount(2);
    const abilityRings = await page.evaluate(() => {
      const scene = window.tls!.inspect().camera.parent;
      const root = scene?.getObjectByName('enemy-debug');
      return root?.children.map((marker) => marker.children[4]?.visible ?? false) ?? [];
    });
    expect(abilityRings.filter(Boolean)).toHaveLength(2);
    expect(await page.evaluate(() => window.tls!.killAll())).toBe(10);
    expect(issues.problems()).toEqual([]);
  });

  test('Spitter: rears back and glows, spits a visible arc; standing still costs 14, moving dodges it, it backs off, two headshots kill', async ({
    page,
    issues,
  }) => {
    test.setTimeout(180_000);
    await play(page);
    await emptyYard(page);
    await record(page);
    const spitter = await page.evaluate(() => window.tls!.spawnEnemy('spitter', 12));
    await watchPhases(page, spitter);
    // The most acid blobs drawn in any frame (a flight lasts about a second).
    await page.evaluate(() => {
      const w = window as unknown as { __acid: number };
      w.__acid = 0;
      const view = window.tls!.inspect().projectileView;
      const tick = (): void => {
        w.__acid = Math.max(w.__acid, view.visibleCount);
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });

    // Standing still: the telegraph, then the acid in flight, then 14 health.
    await expect.poll(() => log(page), { timeout: 60_000 }).toContain(`player -14 from ${spitter}`);
    const events = await log(page);
    expect(events.indexOf(`${spitter} spit`)).toBeLessThan(events.indexOf(`${spitter} spat`));
    expect(events).toContain('acid direct 14');
    const seen = await phases(page);
    expect(seen.phases.slice(0, 3)).toEqual(['none', 'windup', 'recovery']);
    expect(seen.glow).toBeGreaterThan(0.3);
    expect(
      await page.evaluate(() => (window as unknown as { __acid: number }).__acid),
    ).toBeGreaterThan(0);
    expect(events.filter((e) => e.startsWith(`${spitter} hit`))).toEqual([]); // never melee

    // Moving during the flight dodges it: aimed where the player was, with no lead.
    await page.evaluate(() => {
      const { enemies, player } = window.tls!.inspect();
      enemies.events.on('spat', () => {
        const p = player.motor.position;
        window.tls!.teleportPlayer(p.x + 3, p.y, p.z, player.look.yaw);
      });
    });
    const health = (await page.evaluate(() => window.tls!.playerHealth())).health;
    await expect
      .poll(async () => (await log(page)).filter((e) => e.startsWith('acid')).length, {
        timeout: 60_000,
      })
      .toBeGreaterThanOrEqual(2);
    expect((await log(page)).filter((e) => e.startsWith('acid')).at(-1)).toMatch(/^acid splash 0$/);
    expect((await page.evaluate(() => window.tls!.playerHealth())).health).toBe(health);

    // Rushed, it backs away before it spits again.
    await page.evaluate((id) => {
      const e = window.tls!.enemies().find((x) => x.id === id);
      if (e) {
        window.tls!.teleportPlayer(e.position[0], 0, e.position[2] + 4, 0);
      }
    }, spitter);
    await expect
      .poll(async () => (await enemy(page, spitter))?.targetDistance ?? 0, { timeout: 20_000 })
      .toBeGreaterThan(7);

    // Two Pistol headshots.
    await page.evaluate(() => window.tls!.freezeEnemies(true));
    await shootAt(page, spitter, 'HEAD');
    expect((await enemy(page, spitter))?.state).not.toBe('DEAD');
    await shootAt(page, spitter, 'HEAD');
    expect((await enemy(page, spitter))?.state).toBe('DEAD');
    expect(issues.problems()).toEqual([]);
  });
});
