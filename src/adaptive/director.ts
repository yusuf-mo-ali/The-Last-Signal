/**
 * The adaptive director (D-026, D-047): after a wave, what the horde does about the profile. Pure,
 * with no randomness: the same profile and state always give the same outcome (ties go to the
 * adaptation's priority, then its id, then the variant's key).
 *
 * For each active adaptation, in order:
 * - **fades** when its signal drops below the exit threshold, its confidence below the exit
 *   confidence, its gate fails, or it has shaped `maxActiveWaves` waves (then it rests
 *   `cooldownWaves`);
 * - **drops to level 1** while the strain governor is on;
 * - **escalates** to level 2 after `escalate.afterWaves` waves at level 1 with high confidence
 *   (unless its `maxLevel` is 1, or the active adaptations' combined pressure would pass
 *   `maxPressure`, D-048);
 * - otherwise stays.
 *
 * Then, from wave `firstAdaptiveWave` (and each adaptation's and variant's own `firstWave`, from
 * which its answer acts, D-048) and with `minWavesOfEvidence` fought waves, adaptations whose
 * signal and confidence are at or above their enter thresholds may **enter** at level 1, by
 * priority, at most one per family and `maxActiveAdaptations` in all, within `maxPressure` (a
 * heavy answer stands alone), unless the governor is on.
 * Nothing changes for the final wave: it gets no adaptation at all.
 */

import {
  ADAPTATION_GUARDRAILS,
  ADAPTATION_IDS,
  ADAPTATIONS,
  type AdaptationConfig,
  type AdaptationVariant,
} from '../config/adaptation';
import { ENEMY_STATS } from '../config/enemies';
import { FINAL_WAVE } from '../config/waves';
import { pressureOf, totalPressure } from './compose';
import { confidence, memoryOf } from './profile';
import type {
  ActiveAdaptation,
  AdaptationChange,
  AdaptationChangeKind,
  AdaptationOutcome,
  AdaptationState,
  BehaviorProfile,
} from './types';

/** Adaptations in the order they are considered. */
const BY_PRIORITY = [...ADAPTATION_IDS].sort(
  (a, b) => ADAPTATIONS[a].priority - ADAPTATIONS[b].priority || a.localeCompare(b),
);

/** The SIGNAL ANALYSIS line for a change. */
export function analysisText(
  config: AdaptationConfig,
  key: string,
  kind: AdaptationChangeKind,
): string {
  if (kind === 'hold') {
    return ADAPTATION_GUARDRAILS.strain.text;
  }
  if (kind === 'rest') {
    return ADAPTATION_GUARDRAILS.restText;
  }
  const variant = config.variants.find((v) => v.key === key);
  const name = variant?.subject ? ENEMY_STATS[variant.subject].name : config.name;
  return config.analysis[kind].replaceAll('{name}', name);
}

function gatePasses(config: AdaptationConfig, profile: BehaviorProfile): boolean {
  const gate = config.gate;
  if (!gate) {
    return true;
  }
  const mean = memoryOf(profile, gate.signal).mean;
  return (
    (gate.min === undefined || mean >= gate.min) && (gate.max === undefined || mean <= gate.max)
  );
}

/** The variant most strongly shown, if any is at or above its enter thresholds. */
function enteringVariant(
  config: AdaptationConfig,
  profile: BehaviorProfile,
  nextWave: number,
): AdaptationVariant | null {
  let best: AdaptationVariant | null = null;
  let bestConfidence = -1;
  let bestMean = -1;
  for (const v of [...config.variants].sort((a, b) => a.key.localeCompare(b.key))) {
    if (nextWave < (v.firstWave ?? config.firstWave)) {
      continue; // D-048: never announced before its answer can act
    }
    const m = memoryOf(profile, v.signal);
    const c = confidence(m);
    if (m.mean < config.threshold.enter || c < config.confidence.enter) {
      continue;
    }
    if (c > bestConfidence || (c === bestConfidence && m.mean > bestMean)) {
      best = v;
      bestConfidence = c;
      bestMean = m.mean;
    }
  }
  return best;
}

/** The combined pressure (D-048) if `a` went to level 2, with the others as they are. */
function pressureAfterEscalating(active: readonly ActiveAdaptation[], a: ActiveAdaptation): number {
  return active.reduce(
    (sum, other) => sum + pressureOf(other.id === a.id ? { id: a.id, level: 2 } : other),
    0,
  );
}

/** Whether the strain governor is on (heavy damage, wave after wave). */
export function governorOn(profile: BehaviorProfile): boolean {
  const strain = memoryOf(profile, 'strain');
  const g = ADAPTATION_GUARDRAILS.strain;
  return strain.mean >= g.threshold && confidence(strain) >= g.confidence;
}

/**
 * What the horde does for wave `nextWave`, given the profile after the wave just fought and the
 * state that shaped it.
 */
export function decide(
  profile: BehaviorProfile,
  state: AdaptationState,
  nextWave: number,
  finalWave: number = FINAL_WAVE,
): AdaptationOutcome {
  const g = ADAPTATION_GUARDRAILS;
  const governor = governorOn(profile);
  if (g.noAdaptationOnFinale && nextWave === finalWave) {
    // The finale is hand-tuned: nothing changes for it (and nothing is applied to it).
    return { forWave: nextWave, state, changes: [], governor };
  }
  const changes: AdaptationChange[] = [];
  const change = (a: { id: ActiveAdaptation['id']; key: string }, kind: AdaptationChangeKind) => {
    changes.push({
      id: a.id,
      key: a.key,
      kind,
      text: analysisText(ADAPTATIONS[a.id], a.key, kind),
    });
  };
  const restUntil = { ...state.restUntil };
  const active: ActiveAdaptation[] = [];

  // 1. What is active: fade, hold, escalate or stay.
  for (const a of state.active) {
    const config = ADAPTATIONS[a.id];
    const variant = config.variants.find((v) => v.key === a.key);
    const memory = variant ? memoryOf(profile, variant.signal) : null;
    const c = memory ? confidence(memory) : 0;
    const worn = nextWave - a.since >= config.maxActiveWaves;
    const gone =
      !variant ||
      !memory ||
      config.status === 'dormant' ||
      memory.mean < config.threshold.exit ||
      c < config.confidence.exit ||
      !gatePasses(config, profile);
    if (gone || worn) {
      restUntil[a.id] = nextWave + config.cooldownWaves;
      change(a, gone ? 'fade' : 'rest');
      continue;
    }
    if (a.level === 2 && governor) {
      active.push({ ...a, level: 1, levelSince: nextWave });
      change(a, 'hold');
      continue;
    }
    if (
      a.level === 1 &&
      (config.maxLevel ?? 2) >= 2 &&
      pressureAfterEscalating(state.active, a) <= g.maxPressure &&
      !governor &&
      c >= g.escalate.confidence &&
      memory.mean >= config.threshold.enter &&
      nextWave - a.levelSince >= g.escalate.afterWaves
    ) {
      active.push({ ...a, level: 2, levelSince: nextWave });
      change(a, 'escalate');
      continue;
    }
    active.push(a);
  }

  // 2. What may enter.
  if (nextWave >= g.firstAdaptiveWave && profile.wavesObserved >= g.minWavesOfEvidence) {
    let held = false;
    for (const id of BY_PRIORITY) {
      const config = ADAPTATIONS[id];
      if (
        config.status === 'dormant' ||
        nextWave < config.firstWave ||
        nextWave < (restUntil[id] ?? 0) ||
        active.some((a) => a.id === id || ADAPTATIONS[a.id].family === config.family)
      ) {
        continue;
      }
      const variant = enteringVariant(config, profile, nextWave);
      if (!variant || !gatePasses(config, profile)) {
        continue;
      }
      if (governor) {
        held = true;
        continue;
      }
      if (active.length >= g.maxActiveAdaptations) {
        break;
      }
      if (totalPressure(active) + pressureOf({ id, level: 1 }) > g.maxPressure) {
        continue; // D-048: a heavy answer stands alone
      }
      const entered: ActiveAdaptation = {
        id,
        key: variant.key,
        level: 1,
        since: nextWave,
        levelSince: nextWave,
      };
      active.push(entered);
      change(entered, 'enter');
    }
    if (held && !changes.some((c) => c.kind === 'hold')) {
      changes.push({ id: 'governor', key: 'governor', kind: 'hold', text: g.strain.text });
    }
  }

  return { forWave: nextWave, state: { active, restUntil }, changes, governor };
}
