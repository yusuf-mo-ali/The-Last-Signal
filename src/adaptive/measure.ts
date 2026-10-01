/**
 * One wave's telemetry → its evidence, signal by signal (D-047). Pure and deterministic.
 *
 * Every signal is a share (0–1) of something the player did, never a single action: a share of
 * position samples, of hits, of shots, of spawns. Its weight says how much the wave showed (seconds
 * of fighting, hits, spawns over what makes a full wave), then shrinks:
 *
 * - on a mutated wave, for what the mutation pushes the player into (`MUTATION_DISCOUNT`);
 * - for archetypes an active adaptation brought in, toward that adaptation's own signal
 *   (`ADAPTATION_GUARDRAILS.attribution`): a response cannot feed the evidence that caused it.
 */

import {
  ADAPTATION_GUARDRAILS,
  MUTATION_DISCOUNT,
  SIGNAL_MEASURE,
  signalFamily,
  SUPPORT_ARCHETYPES,
  WEAPON_FOCUS_ROLES,
  type SignalId,
} from '../config/adaptation';
import type { SignalReading, WaveEvidence, WaveTelemetry } from './types';

export interface MeasureContext {
  /** Seconds between two position samples (`sampleEvery` × the fixed step). */
  readonly sampleSeconds: number;
  /** Per signal, the archetypes an active adaptation brought in for it (counted down). */
  readonly boosted?: ReadonlyMap<SignalId, ReadonlySet<string>>;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** A blank telemetry record for wave `wave`. */
export function emptyTelemetry(wave: number, mutation: WaveTelemetry['mutation']): WaveTelemetry {
  return {
    wave,
    mutation,
    samples: 0,
    elevated: 0,
    dwell: {},
    moves: {},
    hits: {},
    shots: 0,
    shotsHit: 0,
    firearmHits: 0,
    headHits: 0,
    focus: { precision: 0, burst: 0, automatic: 0, melee: 0 },
    firearmsOwned: 0,
    support: { screamer: { spawned: 0, completed: 0 }, spitter: { spawned: 0, completed: 0 } },
    damageTaken: 0,
    lowestHealth: 1,
    damageBy: {},
  };
}

/** The dwell cell of a position (`SIGNAL_MEASURE.dwellCell` metres). */
export function dwellCell(x: number, z: number): string {
  const size = SIGNAL_MEASURE.dwellCell;
  return `${Math.floor(x / size)},${Math.floor(z / size)}`;
}

/**
 * The most-used 3 × 3 block of dwell cells: its share of ground samples and the sample-weighted
 * centre of its cells. Ties go to the lowest cell key, so the result never depends on map order.
 */
export function bestDwellArea(dwell: Readonly<Record<string, number>>): {
  readonly samples: number;
  readonly total: number;
  readonly centroid: [number, number];
} | null {
  const keys = Object.keys(dwell).sort();
  let total = 0;
  for (const k of keys) {
    total += dwell[k] ?? 0;
  }
  if (total <= 0) {
    return null;
  }
  let best = -1;
  let bestCentroid: [number, number] = [0, 0];
  const size = SIGNAL_MEASURE.dwellCell;
  for (const key of keys) {
    const [cx, cz] = key.split(',').map(Number) as [number, number];
    let sum = 0;
    let sx = 0;
    let sz = 0;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const n = dwell[`${cx + dx},${cz + dz}`] ?? 0;
        sum += n;
        sx += n * (cx + dx + 0.5) * size;
        sz += n * (cz + dz + 0.5) * size;
      }
    }
    if (sum > best) {
      best = sum;
      bestCentroid = [sx / sum, sz / sum];
    }
  }
  return { samples: best, total, centroid: bestCentroid };
}

export function measureWave(t: WaveTelemetry, context: MeasureContext): WaveEvidence {
  const discounts = (t.mutation ? MUTATION_DISCOUNT[t.mutation] : undefined) ?? {};
  const attribution = ADAPTATION_GUARDRAILS.attribution;
  const factor = (signal: SignalId, archetype: string): number =>
    context.boosted?.get(signal)?.has(archetype) ? attribution : 1;
  const signals: Partial<Record<SignalId, SignalReading>> = {};
  const set = (signal: SignalId, score: number, weight: number): void => {
    const discount = discounts[signalFamily(signal)] ?? 1;
    signals[signal] = { score: clamp01(score), weight: clamp01(weight * discount) };
  };
  const M = SIGNAL_MEASURE;
  const seconds = (samples: number) => samples * context.sampleSeconds;

  // 1. High ground.
  const positional = clamp01(seconds(t.samples) / M.positionFullSeconds);
  set('elevation', t.samples > 0 ? t.elevated / t.samples : 0, positional);

  // 2. One area: the best 9 × 9 m block's share of ground samples.
  const area = bestDwellArea(t.dwell);
  set(
    'dwell',
    area ? area.samples / area.total : 0,
    area ? clamp01(seconds(area.total) / M.positionFullSeconds) : 0,
  );

  // 3. Mobility: sprinting and kiting, per nearest archetype (attributed).
  let moveSamples = 0;
  let sprint = 0;
  let kite = 0;
  for (const key of Object.keys(t.moves).sort()) {
    const m = t.moves[key];
    if (!m) {
      continue;
    }
    const f = factor('mobility', key);
    moveSamples += m.samples * f;
    sprint += m.sprint * f;
    kite += m.kite * f;
  }
  set(
    'mobility',
    moveSamples > 0 ? 0.5 * (sprint / moveSamples) + 0.5 * (kite / moveSamples) : 0,
    clamp01(seconds(moveSamples) / M.positionFullSeconds),
  );

  // 4–5. Range: shares of hits, per target archetype (attributed per signal).
  for (const signal of ['closeRange', 'longRange'] as const) {
    let total = 0;
    let part = 0;
    for (const key of Object.keys(t.hits).sort()) {
      const h = t.hits[key];
      if (!h) {
        continue;
      }
      const f = factor(signal, key);
      total += h.total * f;
      part += (signal === 'closeRange' ? h.close : h.long) * f;
    }
    set(signal, total > 0 ? part / total : 0, total / M.rangeFullHits);
  }

  // 9. Hit zones and accuracy.
  set(
    'headshot',
    t.firearmHits > 0 ? t.headHits / t.firearmHits : 0,
    t.firearmHits / M.headshotFullHits,
  );
  set('accuracy', t.shots > 0 ? t.shotsHit / t.shots : 0, t.shots / M.accuracyFullShots);

  // 6 and 8. Priority and neglect of the support archetypes.
  for (const a of SUPPORT_ARCHETYPES) {
    const { spawned, completed } = t.support[a];
    const share = spawned > 0 ? completed / spawned : 0;
    const weight = spawned / M.priorityFullSpawns;
    set(`priority.${a}`, spawned > 0 ? 1 - share : 0, weight * factor(`priority.${a}`, a));
    set(`neglect.${a}`, share, weight * factor(`neglect.${a}`, a));
  }

  // 7. Weapon focus: only with a real choice of firearms (dormant while one exists).
  let focusTotal = 0;
  for (const role of WEAPON_FOCUS_ROLES) {
    focusTotal += t.focus[role];
  }
  const choice = t.firearmsOwned >= M.focusMinFirearms;
  for (const role of WEAPON_FOCUS_ROLES) {
    set(
      `weaponFocus.${role}`,
      focusTotal > 0 ? t.focus[role] / focusTotal : 0,
      choice ? focusTotal / M.focusFullHits : 0,
    );
  }

  // 10. Strain: damage taken in a fought wave.
  set('strain', t.damageTaken / M.strainFullDamage, t.samples > 0 ? 1 : 0);

  return { wave: t.wave, signals, dwellCentroid: area ? area.centroid : null };
}
