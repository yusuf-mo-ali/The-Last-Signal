/**
 * No adaptation silently makes a wave impossible (D-026, D-047): the mutation tripwire's scripted
 * defender (it stands at the spawn and shoots the nearest threat it can see, every 0.33 s,
 * alternating headshots and body shots) clears the unadapted waves comfortably and must survive
 * every adaptation alone and every pair the director allows (families and pressure, D-048), each
 * at its highest level, on the same waves and seeds. Composition only: the budget is the same, so
 * this checks the mix is never one the defender cannot handle.
 */

import { describe, expect, it } from 'vitest';
import {
  ADAPTATION_GUARDRAILS,
  ADAPTATION_IDS,
  ADAPTATIONS,
  type AdaptationId,
} from '../config/adaptation';
import { totalPressure } from './compose';
import { headlessGame } from './testGame';

const DEFENDER = { interval: 0.33, headshotEvery: 2, range: 22 };
const COMFORTABLE = 50;
const SEEDS = (process.env.SEEDS ?? '0,1,2,3,4,5,6,7,8,9').split(',').map(Number);
const WAVES = (process.env.WAVES ?? '8,12').split(',').map(Number);
/** Tuning runs: `ONLY=NEGLECT` measures just the pairs whose label contains it. */
const ONLY = process.env.ONLY ?? '';

interface Forced {
  readonly id: AdaptationId;
  readonly key: string;
}

const SINGLES: Forced[] = ADAPTATION_IDS.filter((id) => !ADAPTATIONS[id].status).flatMap((id) =>
  ADAPTATIONS[id].variants.map((v) => ({ id, key: v.key })),
);
/** Every single adaptation, then every pair the director allows (families, pressure, D-048). */
const PAIRS: Forced[][] = [
  ...SINGLES.map((a) => [a]),
  ...SINGLES.flatMap((a, i) =>
    SINGLES.slice(i + 1)
      .filter(
        (b) =>
          ADAPTATIONS[a.id].family !== ADAPTATIONS[b.id].family &&
          totalPressure([
            { id: a.id, level: 1 },
            { id: b.id, level: 1 },
          ]) <= ADAPTATION_GUARDRAILS.maxPressure,
      )
      .map((b) => [a, b]),
  ),
];

function defended(n: number, forced: readonly Forced[], seed: number) {
  // The mutation tripwire's seeds: known to clear their plain waves comfortably.
  const g = headlessGame(`tripwire-${n}-${seed}`);
  g.startRun();
  for (const f of forced) {
    g.adaptive.force(f.id, 2, f.key, n);
  }
  g.waves.startWave(n, 'none');
  g.until(() => g.game.state.current === 'WAVE_ACTIVE', 10);
  let taken = 0;
  g.playerHealth.events.on('damaged', (e) => (taken += e.amount));
  g.until(() => {
    g.defend(DEFENDER);
    return g.game.state.current !== 'WAVE_ACTIVE';
  }, 400);
  const climbers = g.waves.definition?.spawns.filter((s) => s.archetype === 'climber').length ?? 0;
  return { cleared: g.game.state.current === 'WAVE_COMPLETE', taken, climbers };
}

describe('adaptive tripwire: no adaptation silently makes a wave impossible', () => {
  it('the defender survives every adaptation and allowed pair at its highest level where it clears the plain wave comfortably', () => {
    const report: string[] = [];
    // Every death, reported together (after the measurement table).
    const deaths: string[] = [];
    let climbers = 0;
    for (const n of WAVES) {
      const base = SEEDS.map((seed) => defended(n, [], seed));
      base.forEach((r, k) => {
        expect(r.cleared, `wave ${n} seed ${SEEDS[k]}: plain`).toBe(true);
        expect(r.taken, `wave ${n} seed ${SEEDS[k]} is comfortable`).toBeLessThanOrEqual(
          COMFORTABLE,
        );
      });
      report.push(`wave ${n} plain: ${base.map((r) => Math.round(r.taken)).join(' / ')}`);
      for (const pair of PAIRS) {
        const label = pair.map((f) => `${f.id}${f.key === 'default' ? '' : `:${f.key}`}`).join('+');
        if (ONLY && !label.includes(ONLY)) {
          continue;
        }
        const runs = SEEDS.map((seed) => defended(n, pair, seed));
        report.push(
          `wave ${n} ${label}: ${runs.map((r) => (r.cleared ? Math.round(r.taken) : 'died')).join(' / ')}`,
        );
        runs.forEach((r, k) => {
          if (!r.cleared) {
            deaths.push(`wave ${n} ${label} seed ${SEEDS[k]}`);
          }
          climbers += r.climbers;
        });
      }
    }
    if (process.env.BALANCE_REPORT) {
      console.log(`health lost by the scripted defender\n${report.join('\n')}`);
    }
    expect(deaths, 'the defender died').toEqual([]);
    // Not vacuous: Climbers did come (HIGH_GROUND pairs from wave 8).
    expect(climbers).toBeGreaterThan(0);
  }, 900_000);
});
