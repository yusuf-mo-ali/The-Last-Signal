/**
 * The Adaptive system in a real browser (Phase 8, D-047): the horde's answer is explained between
 * waves (SIGNAL ANALYSIS), never during one; a camp on the catwalk is seen by the real telemetry;
 * once the evidence is there, the next waves bring Climbers, which come up the wall and can be
 * knocked off it; the mutation schedule is the same; no new shader program; dying names what the
 * horde adapted to and a new run forgets it. The development specs drive the waves through `tls`;
 * the last spec checks the DOM in every build.
 */

import type { Page } from '@playwright/test';
import {
  expect,
  frames,
  isDev,
  lockPrompt,
  openGame,
  test,
  type AdaptationSnapshot,
  type WaveSnapshot,
} from './helpers';

async function play(page: Page): Promise<void> {
  await openGame(page, '', { waves: true });
  await page.click('.lock-prompt');
  await frames(page, 4);
}

function wave(page: Page): Promise<WaveSnapshot> {
  return page.evaluate(() => window.tls!.wave());
}

function adaptation(page: Page): Promise<AdaptationSnapshot> {
  return page.evaluate(() => window.tls!.adaptation());
}

function programs(page: Page): Promise<string> {
  return page.evaluate(() =>
    (window.tls!.inspect().renderer.webgl.info.programs ?? []).map((p) => p.id).join(','),
  );
}

/** The SIGNAL ANALYSIS card as the player sees it (DOM only). */
function analysis(page: Page) {
  return page.evaluate(() => {
    const root = document.querySelector<HTMLElement>('.signal-analysis');
    if (!root) {
      return null;
    }
    return {
      shown: !root.hidden && root.getBoundingClientRect().height > 0,
      changes: root.dataset.changes ?? '',
      lines: [...root.querySelectorAll('.signal-analysis__line')].map((l) => l.textContent),
    };
  });
}

/** Starts wave `n` (god mode, no mutation) and waits until it is active. */
async function startActive(page: Page, n: number): Promise<void> {
  await page.evaluate((w) => {
    window.tls!.setGodMode(true);
    window.tls!.startWave(w, 'none');
    window.tls!.skipWaveTimer();
  }, n);
  await expect.poll(async () => (await wave(page)).state).toBe('WAVE_ACTIVE');
}

/** Clears the current wave and waits for the breather. */
async function clearWave(page: Page): Promise<void> {
  await page.evaluate(() => window.tls!.completeWave());
  await expect
    .poll(async () => (await wave(page)).state, { timeout: 15_000 })
    .toBe('WAVE_COMPLETE');
}

test.describe('adaptation (development build)', () => {
  // eslint-disable-next-line no-empty-pattern
  test.beforeEach(({}, testInfo) => {
    test.skip(!isDev(testInfo), 'needs the development debug tools (window.tls)');
  });

  test('SIGNAL ANALYSIS: between waves only; the next wave carries the answer, the mutations do not change', async ({
    page,
    issues,
  }) => {
    await play(page);
    const schedule = await page.evaluate(() => window.tls!.mutationSchedule(1, 20));
    await startActive(page, 7);
    // A decision taken during a wave (a debug feed) changes nothing on screen until it ends.
    const during = await page.evaluate(() => window.tls!.feedEvidence('closeRange', 0.95, 3));
    expect(during.active.map((x) => x.id)).toContain('CLOSE_QUARTERS');
    await frames(page, 3);
    expect((await analysis(page))?.shown).toBe(false);
    await clearWave(page);
    // In the breather: what the horde learned (the real wave's evidence folded in too).
    await page.evaluate(() => window.tls!.feedEvidence('elevation', 0.95, 3));
    await frames(page, 3);
    const card = await analysis(page);
    expect(card?.shown).toBe(true);
    expect(card?.changes).toContain('HIGH_GROUND:');
    expect(card?.lines.join(' ')).toMatch(/perch|climb/i);
    const a = await adaptation(page);
    expect(a.active.map((x) => x.id)).toContain('HIGH_GROUND');
    expect(a.forWave).toBe(8);
    // The mutation wave 8 will draw, from the run's own history (adaptation never enters it).
    expect(a.nextWave.wave).toBe(8);
    const drawn = a.nextWave.mutation;
    // Wave 8: the Climber arrives with it (adaptive unlock 8); the card is gone.
    await page.evaluate(() => window.tls!.skipWaveTimer());
    await expect.poll(async () => (await wave(page)).wave).toBe(8);
    expect((await wave(page)).composition?.climber).toBeGreaterThanOrEqual(1);
    await frames(page, 3);
    expect((await analysis(page))?.shown).toBe(false);
    // The mutations are the run's own (adaptation never touches them). After the debug jump to
    // wave 7 the history differs from a full run's, so wave 8 is compared with the draw announced
    // in the breather, not with the full-run schedule.
    expect(await page.evaluate(() => window.tls!.mutationSchedule(1, 20))).toEqual(schedule);
    expect((await wave(page)).mutation).toBe(drawn);
    expect(issues.problems()).toEqual([]);
  });

  test('a real camp on the catwalk is what the telemetry sees', async ({ page, issues }) => {
    await play(page);
    await startActive(page, 6);
    await page.evaluate(() => {
      window.tls!.teleportPlayer(-22.25, 2.5, 1, -Math.PI / 2);
    });
    await expect
      .poll(async () => (await adaptation(page)).telemetry.samples, { timeout: 30_000 })
      .toBeGreaterThanOrEqual(8);
    const t = (await adaptation(page)).telemetry;
    expect(t.wave).toBe(6);
    expect(t.elevated / t.samples).toBeGreaterThan(0.9);
    await clearWave(page);
    const a = await adaptation(page);
    // The wave's reading: almost every sample on high ground (its weight grows with the time fought).
    expect(a.lastEvidence?.elevation?.score).toBeGreaterThan(0.9);
    expect(a.lastEvidence?.elevation?.weight).toBeGreaterThan(0);
    // One wave is never enough (D-026): nothing has adapted.
    expect(a.active).toEqual([]);
    expect(issues.problems()).toEqual([]);
  });

  test('a Climber comes up the wall at the perch and a hit knocks it off; no new shader', async ({
    page,
    issues,
  }) => {
    await play(page);
    await startActive(page, 9);
    const before = await programs(page);
    const id = await page.evaluate(() => {
      window.tls!.pauseSpawning(true);
      window.tls!.clearEnemies();
      // From the yard, a Climber 4 m west, below the catwalk's open edge; then up onto the perch.
      window.tls!.teleportPlayer(-14, 0, 1, Math.PI / 2);
      const id = window.tls!.spawnEnemy('climber', 4);
      window.tls!.teleportPlayer(-22.25, 2.5, 1, -Math.PI / 2);
      window.tls!.alertEnemies();
      return id;
    });
    await expect
      .poll(async () => (await page.evaluate((i) => window.tls!.enemy(i), id)).climbing, {
        timeout: 30_000,
      })
      .not.toBeNull();
    // On the wall: it cannot attack; a body shot's worth of damage knocks it off.
    await page.evaluate((i) => window.tls!.damageEnemy(i, 30), id);
    await expect
      .poll(async () => (await page.evaluate((i) => window.tls!.enemy(i), id)).position[1], {
        timeout: 10_000,
      })
      .toBeLessThan(0.3);
    expect(await programs(page)).toBe(before);
    expect(issues.problems()).toEqual([]);
  });

  test('Phase 8.1: what the horde announces is what spawns — Climbers, then a Runner-heavy wave', async ({
    page,
    issues,
  }) => {
    test.setTimeout(300_000);
    await play(page);
    /** Plays the current wave out (god mode), killing wave enemies as they arrive. */
    const playOut = async () => {
      await page.evaluate(() => window.tls!.skipWaveTimer());
      await expect
        .poll(
          async () => {
            await page.evaluate(() => window.tls!.killAll());
            return (await wave(page)).state;
          },
          { timeout: 180_000, intervals: [500] },
        )
        .toBe('WAVE_COMPLETE');
      return wave(page);
    };

    // 1. HIGH_GROUND at level 2 on wave 8: two Climbers predicted against a wave with none.
    const high = await page.evaluate(() =>
      window.tls!.adaptationScenario('HIGH_GROUND', 2, 'default', 8),
    );
    expect(high.generated).toBe(true);
    expect(high.matchesGenerated).toBe(true);
    expect(high.adapted.composition.climber).toBe(2);
    expect(high.reference.composition.climber ?? 0).toBe(0);
    expect(high.delta.climber).toBe(2);
    expect(high.perAdaptation[0]?.affected).toBe(true);
    // Both Climbers really spawn in normal play, and everything else spawns as generated.
    const highPlayed = await playOut();
    expect(highPlayed.spawnedComposition.climber).toBe(2);
    expect(highPlayed.spawnedComposition).toEqual(high.adapted.composition);

    // 2. SKIRMISHER at level 2 on wave 9: a visibly Runner-heavy wave (its quota of the budget).
    const runners = await page.evaluate(() =>
      window.tls!.adaptationScenario('SKIRMISHER', 2, 'default', 9),
    );
    expect(runners.matchesGenerated).toBe(true);
    const adaptedRunners = runners.adapted.composition.runner ?? 0;
    expect(adaptedRunners).toBeGreaterThanOrEqual((runners.reference.composition.runner ?? 0) + 2);
    expect(adaptedRunners * 1.5).toBeGreaterThanOrEqual(0.45 * runners.budget);
    expect(runners.adapted.spent).toBeLessThanOrEqual(runners.budget);
    expect(runners.reference.spent).toBeLessThanOrEqual(runners.budget);
    const runnersPlayed = await playOut();
    expect(runnersPlayed.spawnedComposition.runner).toBe(adaptedRunners);
    expect(runnersPlayed.spawnedComposition).toEqual(runners.adapted.composition);
    expect(runnersPlayed.spawnedTraits).toEqual(runners.adapted.traits);
    // Switched off, with SKIRMISHER forced active again, the same wave is exactly the unadapted
    // one (the wave really generated, not only the preview).
    await page.evaluate(() => window.tls!.setAdaptive(false));
    const off = await page.evaluate(() =>
      window.tls!.adaptationScenario('SKIRMISHER', 2, 'default', 9),
    );
    expect((await adaptation(page)).active.map((x) => x.id)).toEqual(['SKIRMISHER']);
    expect(off.adapted).toEqual(runners.reference);
    expect(off.matchesGenerated).toBe(true);
    expect((await wave(page)).composition).toEqual(runners.reference.composition);
    expect(issues.problems()).toEqual([]);
  });

  test('dying names what the horde adapted to; a new run forgets it', async ({ page, issues }) => {
    await play(page);
    await startActive(page, 7);
    await clearWave(page);
    await page.evaluate(() => window.tls!.feedEvidence('elevation', 0.95, 3));
    await expect
      .poll(async () => {
        await page.evaluate(() => window.tls!.skipWaveTimer());
        return (await wave(page)).state;
      })
      .toBe('WAVE_ACTIVE');
    await page.evaluate(() => {
      window.tls!.setGodMode(false);
      window.tls!.killPlayer();
    });
    await expect.poll(async () => (await lockPrompt(page))?.mode).toBe('game-over');
    await expect(page.locator('.lock-prompt')).toContainText('The horde adapted to: High ground');
    await page.click('.lock-prompt');
    await frames(page, 4);
    const a = await adaptation(page);
    expect(a.active).toEqual([]);
    expect(a.history).toEqual([]);
    expect(a.wavesObserved).toBe(0);
    expect(issues.problems()).toEqual([]);
  });
});

test('any build: SIGNAL ANALYSIS sits under the HUD, hidden, never in the way', async ({
  page,
  issues,
}) => {
  await openGame(page, '', { waves: true });
  await page.click('.lock-prompt');
  await frames(page, 4);
  const card = await page.evaluate(() => {
    const root = document.querySelector<HTMLElement>('.signal-analysis');
    return root
      ? {
          hidden: root.hidden,
          pointerEvents: getComputedStyle(root).pointerEvents,
          afterCanvas:
            (document.querySelector('canvas')?.compareDocumentPosition(root) ?? 0) &
            Node.DOCUMENT_POSITION_FOLLOWING,
        }
      : null;
  });
  expect(card).toEqual({ hidden: true, pointerEvents: 'none', afterCanvas: 4 });
  expect(issues.problems()).toEqual([]);
});
