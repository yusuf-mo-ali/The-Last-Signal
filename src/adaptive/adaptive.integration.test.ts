/**
 * The Adaptive system in the full headless game (D-047), wired as `main.ts` wires it:
 *
 *   a player who camps the catwalk wave after wave meets Climbers from wave 8; one who roams does not
 *   decisions happen only when a wave ends; nothing changes during a wave
 *   a new run forgets everything
 *   the same seed and the same play give the same decisions and waves at 30, 60 and 144 Hz
 *   the mutation schedule is the same with or without adaptation (it never touches mutations)
 */

import { describe, expect, it } from 'vitest';
import { CATWALK_HEIGHT } from '../world/levels/facility';
import type { AdaptiveEvents } from './AdaptiveSystem';
import { headlessGame, type HeadlessGame } from './testGame';

type Decision = AdaptiveEvents['adaptationDecided'];

/** Where the player stands during a wave: the catwalk, or a tour of the yard. */
type Style = 'camper' | 'roamer';

const CATWALK = [-22.25, CATWALK_HEIGHT, 1] as const;
const TOUR = [
  [0, 0, 11],
  [12, 0, 4],
  [6, 0, -8],
  [-10, 0, -6],
  [-14, 0, 8],
  [17, 0, 14],
] as const;

/**
 * Plays waves 1–`last`, each fought for `seconds` (the player standing where `style` says, in god
 * mode), then cleared. Returns the decisions, each wave's composition and the mutations played.
 */
function play(g: HeadlessGame, style: Style, last: number, { seconds = 50, hz = 60 } = {}) {
  const decisions: Decision[] = [];
  const compositions: Record<number, Record<string, number>> = {};
  g.adaptive.events.on('adaptationDecided', (d) => decisions.push(d));
  g.waves.events.on('waveStarting', ({ wave, definition }) => {
    compositions[wave] = { ...definition.enemyComposition };
  });
  g.playerHealth.godMode = true;
  g.startRun();
  for (let wave = 1; wave <= last; wave++) {
    g.until(() => g.game.state.current === 'WAVE_ACTIVE', 20, hz);
    const modifiersDuringWave = JSON.stringify(g.adaptive.modifiers(wave));
    for (let s = 0; s < seconds; s++) {
      if (style === 'camper') {
        g.place(...CATWALK);
      } else {
        const [x, y, z] = TOUR[(wave * 7 + s) % TOUR.length] ?? TOUR[0];
        g.place(x, y, z);
      }
      g.frames(hz, hz);
      // Nothing is decided during a wave.
      expect(JSON.stringify(g.adaptive.modifiers(wave))).toBe(modifiersDuringWave);
    }
    g.until(
      () => {
        g.killWave();
        return g.game.state.current === 'WAVE_COMPLETE';
      },
      120,
      hz,
    );
    g.until(() => g.game.state.current === 'WAVE_START', 20, hz);
  }
  return {
    decisions,
    compositions,
    mutations: g.waves.stats.snapshot().mutations,
  };
}

describe('adaptive integration: a run, played two ways', () => {
  it('the catwalk camper meets Climbers from wave 8; the roamer never adapts', () => {
    const camper = play(headlessGame('camper'), 'camper', 9);
    const entered = camper.decisions.flatMap((d) =>
      d.changes.filter((c) => c.kind === 'enter').map((c) => `${d.forWave}:${c.id}`),
    );
    // Evidence from waves 1–4 is enough by wave 5 (D-026: never earlier).
    expect(entered[0]).toBe('5:HIGH_GROUND');
    for (let w = 1; w <= 7; w++) {
      expect(camper.compositions[w]?.climber, `wave ${w}`).toBeUndefined();
    }
    // Level 2 by wave 7 (two waves at level 1): two Climbers on wave 8, its fourth wave; then it
    // rests two waves (anti-runaway) and the perch is still there to be noticed again.
    expect(camper.compositions[8]?.climber).toBe(2);
    expect(camper.compositions[9]?.climber).toBeUndefined();
    const kinds = camper.decisions.flatMap((d) => d.changes.map((c) => `${d.forWave}:${c.kind}`));
    expect(kinds).toEqual(['5:enter', '7:escalate', '9:rest']);
    const roamer = play(headlessGame('roamer'), 'roamer', 9);
    expect(roamer.decisions.flatMap((d) => d.changes)).toEqual([]);
    for (const c of Object.values(roamer.compositions)) {
      expect(c.climber).toBeUndefined();
    }
  }, 120_000);

  it('counts only while a wave is fought: nothing while paused, in the intro or the breather', () => {
    const g = headlessGame('counting');
    g.playerHealth.godMode = true;
    g.startRun();
    g.until(() => g.game.state.current === 'WAVE_ACTIVE', 20);
    g.until(() => g.adaptive.snapshot.telemetry.samples > 4, 30);
    const during = g.adaptive.snapshot.telemetry.samples;
    g.game.state.pause();
    g.frames(240);
    expect(g.adaptive.snapshot.telemetry.samples).toBe(during);
    g.game.state.resume();
    g.until(() => {
      g.killWave();
      return g.game.state.current === 'WAVE_COMPLETE';
    }, 60);
    const done = g.adaptive.snapshot.telemetry.samples;
    // The breather: an enemy left standing (a debug spawn) is not a wave enemy, and nothing counts.
    g.enemies.spawn('walker', [0, 0, 6], { patrol: false });
    g.frames(240);
    expect(g.adaptive.snapshot.telemetry.samples).toBe(done);
  });

  it('a new run forgets everything', () => {
    const g = headlessGame('reset');
    play(g, 'camper', 6, { seconds: 46 });
    expect(g.adaptive.snapshot.state.active.length).toBeGreaterThan(0);
    expect(g.adaptive.snapshot.profile.wavesObserved).toBeGreaterThan(0);
    g.game.state.transition('GAME_OVER');
    g.startRun();
    const s = g.adaptive.snapshot;
    expect(s.state.active).toEqual([]);
    expect(s.state.restUntil).toEqual({});
    expect(s.profile.wavesObserved).toBe(0);
    expect(s.modifiers).toEqual([]);
    expect(s.history).toEqual([]);
  }, 60_000);

  it('the same seed and play: identical decisions and waves at 30, 60 and 144 Hz', () => {
    const run = (hz: number) => {
      const r = play(headlessGame('determinism'), 'camper', 6, { seconds: 46, hz });
      return { decisions: r.decisions, compositions: r.compositions };
    };
    const at60 = run(60);
    expect(at60.decisions.some((d) => d.changes.length > 0)).toBe(true);
    expect(run(30)).toEqual(at60);
    expect(run(144)).toEqual(at60);
  }, 180_000);

  it('the mutation schedule is the same with adaptation as without it', () => {
    const adapted = play(headlessGame('mutations-untouched'), 'camper', 9, { seconds: 46 });
    const plain = play(headlessGame('mutations-untouched', { adaptive: false }), 'camper', 9, {
      seconds: 46,
    });
    expect(adapted.decisions.some((d) => d.changes.length > 0)).toBe(true);
    expect(plain.decisions).toEqual([]);
    expect(adapted.mutations).toEqual(plain.mutations);
    expect(adapted.mutations.filter((m) => m.id !== null).length).toBeGreaterThan(3);
  }, 120_000);
});
