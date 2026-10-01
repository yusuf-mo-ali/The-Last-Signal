/**
 * Adaptive horde configuration (plan §15, GAME_DESIGN §10, D-026, D-047).
 *
 * The adaptive system watches how the player plays, wave after wave, and changes which zombies
 * later waves bring: never the budget, never a mutation (D-024, D-045), never mid-wave. Two layers,
 * kept apart:
 *
 * - **Signals** (observed behaviour): per wave, each signal gets a score (0–1) and a weight (how
 *   much evidence the wave carried); the profile folds them into a decayed memory with a
 *   confidence (`adaptive/profile.ts`).
 * - **Adaptations** (decisions): when a signal is high with enough confidence, an adaptation
 *   enters at level 1, may escalate to level 2, fades when the evidence goes, and rests
 *   (`adaptive/director.ts`). Each level is a composition response (`adaptive/compose.ts`).
 *
 * Everything here is data; the code has no per-adaptation logic.
 */

import type { ImplementedEnemyId } from './enemies';
import type { MutationId } from './mutations';
import type { PlannedWeaponId, WeaponId } from './weapons';

/** Plan §15 player behaviour metrics: kept as the plan names them (see `PLAN_METRIC_SIGNALS`). */
export const ADAPTIVE_METRICS = [
  'shotgunUsage',
  'rifleUsage',
  'headshotRate',
  'averageDistance',
  'timeSpentInOneArea',
  'elevatedPositionUsage',
  'sprintUsage',
  'meleeUsage',
  'accuracy',
  'damageTaken',
  'kiteFrequency',
] as const;
export type AdaptiveMetric = (typeof ADAPTIVE_METRICS)[number];

// ---- signals --------------------------------------------------------------------------------------

/** What a weapon is used as, for the weapon-focus signal (GAME_DESIGN §5). */
export const WEAPON_FOCUS_ROLES = ['precision', 'burst', 'automatic', 'melee'] as const;
export type WeaponFocusRole = (typeof WEAPON_FOCUS_ROLES)[number];

export const WEAPON_FOCUS_ROLE: Readonly<Record<WeaponId | PlannedWeaponId, WeaponFocusRole>> = {
  pistol: 'precision',
  assaultRifle: 'automatic',
  shotgun: 'burst',
  bareHands: 'melee',
  knife: 'melee',
};

/** Archetypes with an ability the player can let them use (screams, acid): priority and neglect. */
export const SUPPORT_ARCHETYPES = [
  'screamer',
  'spitter',
] as const satisfies readonly ImplementedEnemyId[];
export type SupportArchetype = (typeof SUPPORT_ARCHETYPES)[number];

/** The signals measured every wave (GAME_DESIGN §10.1, the ten observed categories). */
export const BASE_SIGNAL_IDS = [
  'elevation', // 1. high ground / camping
  'dwell', // 2. staying in one area
  'mobility', // 3. sprinting / constant movement (kiting)
  'closeRange', // 4. close-range combat
  'longRange', // 5. long-range shooting
  'headshot', // 9. hit-zone preference
  'accuracy', // 9. accuracy (a gate, not a trigger)
  'strain', // 10. damage taken (the governor)
] as const;
export type BaseSignalId = (typeof BASE_SIGNAL_IDS)[number];

/** Every signal id: the base ones plus the per-archetype and per-role families. */
export type SignalId =
  | BaseSignalId
  | `priority.${SupportArchetype}` // 6. target priority
  | `neglect.${SupportArchetype}` // 8. ignoring enemy types
  | `weaponFocus.${WeaponFocusRole}`; // 7. weapon / category focus

export const SIGNAL_IDS: readonly SignalId[] = [
  ...BASE_SIGNAL_IDS,
  ...SUPPORT_ARCHETYPES.map((a) => `priority.${a}` as const),
  ...SUPPORT_ARCHETYPES.map((a) => `neglect.${a}` as const),
  ...WEAPON_FOCUS_ROLES.map((r) => `weaponFocus.${r}` as const),
];

/** The family a signal id belongs to (`neglect.spitter` → `neglect`), for discounts. */
export type SignalFamily = BaseSignalId | 'priority' | 'neglect' | 'weaponFocus';

export function signalFamily(id: SignalId): SignalFamily {
  const dot = id.indexOf('.');
  return (dot < 0 ? id : id.slice(0, dot)) as SignalFamily;
}

/** Which signal each of the plan's §15 metrics became (documentation, checked by a test). */
export const PLAN_METRIC_SIGNALS: Readonly<Record<AdaptiveMetric, SignalFamily>> = {
  shotgunUsage: 'weaponFocus',
  rifleUsage: 'weaponFocus',
  headshotRate: 'headshot',
  averageDistance: 'longRange',
  timeSpentInOneArea: 'dwell',
  elevatedPositionUsage: 'elevation',
  sprintUsage: 'mobility',
  meleeUsage: 'closeRange',
  accuracy: 'accuracy',
  damageTaken: 'strain',
  kiteFrequency: 'mobility',
};

/**
 * How each signal is measured from one wave's telemetry (`adaptive/measure.ts`). Distances in
 * metres, times in seconds. A signal's weight is its evidence count over `fullWeight`, capped at 1.
 */
export const SIGNAL_MEASURE = {
  /** Position samples: every `sampleEvery` fixed steps (4 Hz at 60 Hz) while enemies are alive. */
  sampleEvery: 15,
  /** Seconds of sampled fighting that make a full wave of positional evidence. */
  positionFullSeconds: 45,
  /** Feet this far above the floor count as high ground. */
  elevatedHeight: 1.2,
  /** Dwell grid cell (m); the dwell area is the best 3 × 3 block of cells. */
  dwellCell: 3,
  /** Moving at least this × walking speed counts as moving (sprint aside). */
  kiteSpeedFactor: 0.8,
  /** Moving away from the nearest enemy within this range counts as kiting. */
  kiteRange: 10,
  /** Hits at or under this distance are close range; melee hits count as `meleeDistance`. */
  closeDistance: 5,
  meleeDistance: 1.5,
  /** Hits at or beyond this distance are long range. */
  longDistance: 18,
  /** Hits (on wave enemies) that make a full wave of range evidence. */
  rangeFullHits: 40,
  /** Firearm hits that make a full wave of hit-zone evidence; shots for accuracy. */
  headshotFullHits: 30,
  accuracyFullShots: 40,
  /** Spawns of an archetype that make a full wave of priority evidence. */
  priorityFullSpawns: 3,
  /** Firearm hits for weapon focus. */
  focusFullHits: 40,
  /** Weapon focus counts only while the player owns at least this many firearms (D-047: dormant in V1). */
  focusMinFirearms: 2,
  /** Damage taken that scores 1 for strain (one full health bar). */
  strainFullDamage: 100,
} as const;

// ---- profile --------------------------------------------------------------------------------------

/** How the profile remembers (`adaptive/profile.ts`; exact maths in GAME_DESIGN §10.3). */
export const PROFILE_RULES = {
  /** Old evidence keeps this share per wave (evidence half-life ≈ 2 waves). */
  decay: 0.7,
  /** Evidence mass at which confidence stops growing (≈ 3 full waves). */
  massFull: 2,
  /** A wave's weight under this is no evidence: memory only decays. */
  minWeight: 0.15,
} as const;

/**
 * A mutated wave counts less as evidence for what the mutation itself pushes the player into
 * (multiplies the signal's weight; D-045 owns the mutation, this only discounts its evidence).
 */
export const MUTATION_DISCOUNT: Readonly<
  Partial<Record<MutationId, Readonly<Partial<Record<SignalFamily, number>>>>>
> = {
  BLACKOUT: { longRange: 0.4, headshot: 0.4, accuracy: 0.4 },
  STATIC: { headshot: 0.5, longRange: 0.7, accuracy: 0.5 },
  HUNGER: { mobility: 0.5, closeRange: 0.7 },
  SCREAM: { mobility: 0.7, dwell: 0.7 },
  HIVE: { strain: 0.6, closeRange: 0.6 },
  BLOOD_MOON: { headshot: 0.8 },
};

// ---- adaptations ----------------------------------------------------------------------------------

export const ADAPTATION_IDS = [
  'HIGH_GROUND',
  'ENTRENCHED',
  'SKIRMISHER',
  'CLOSE_QUARTERS',
  'LONG_RANGE',
  'HEADHUNTER',
  'WEAPON_FOCUS',
  'NEGLECT',
] as const;
export type AdaptationId = (typeof ADAPTATION_IDS)[number];

/** At most one adaptation per family is active: contradictory or compounding pairs cannot meet. */
export const ADAPTATION_FAMILIES = ['stance', 'range', 'precision', 'priority'] as const;
export type AdaptationFamily = (typeof ADAPTATION_FAMILIES)[number];

/** Archetypes only the adaptive system can bring in (D-043, D-047). */
export type AdaptiveExtraArchetype = 'climber';

/**
 * One level of an adaptation: a composition response. A narrowed `CompositionModifier` (only the
 * fields adaptation may use; never the budget, Elites, surges or anything a mutation owns).
 */
export interface AdaptiveResponse {
  /** Weight multipliers (per archetype; ignored for archetypes the wave has not unlocked). */
  readonly archetypeWeights?: Readonly<Partial<Record<ImplementedEnemyId, number>>>;
  /** Weight multiplier for the variant's subject archetype (NEGLECT: the ignored one). */
  readonly subjectWeight?: number;
  /** Added trait chances: Armored and Helmeted only, only once a trait's schedule has started. */
  readonly traitChance?: Readonly<Partial<Record<'armored' | 'helmeted', number>>>;
  /** An archetype outside the roster, exactly `count` per wave, from its adaptive unlock. */
  readonly extra?: {
    readonly archetype: AdaptiveExtraArchetype;
    readonly count: number;
    /** Used instead while `archetype` is not unlocked yet. */
    readonly fallback?: Omit<AdaptiveResponse, 'extra'>;
  };
  /** Spawn bias toward the regions nearest where the player dwells. */
  readonly spawnBias?: 'dwellNearest';
}

/** One way an adaptation can be triggered (a signal), with its response per level. */
export interface AdaptationVariant {
  /** The variant's key (an archetype for NEGLECT, a role for WEAPON_FOCUS, else `default`). */
  readonly key: string;
  readonly signal: SignalId;
  /** The archetype a `subjectWeight` applies to. */
  readonly subject?: ImplementedEnemyId;
  readonly levels: readonly [AdaptiveResponse, AdaptiveResponse];
}

export interface AdaptationConfig {
  readonly id: AdaptationId;
  /** Name shown in SIGNAL ANALYSIS. */
  readonly name: string;
  readonly family: AdaptationFamily;
  /** Lower goes first when more could enter than may (ties by id). */
  readonly priority: number;
  readonly variants: readonly AdaptationVariant[];
  /** The signal's remembered mean: enters at or above `enter`, leaves below `exit` (hysteresis). */
  readonly threshold: { readonly enter: number; readonly exit: number };
  /** Confidence (0–1): enters at or above `enter`, leaves below `exit`. */
  readonly confidence: { readonly enter: number; readonly exit: number };
  /** Another signal's mean must be within these bounds (e.g. accuracy for headshots). */
  readonly gate?: { readonly signal: SignalId; readonly min?: number; readonly max?: number };
  /** Waves it rests after it ends before it may enter again. */
  readonly cooldownWaves: number;
  /** Waves it may stay active before it is made to fade (and rest). */
  readonly maxActiveWaves: number;
  /** Not before this wave (D-026: 5). */
  readonly firstWave: number;
  /** Lines for SIGNAL ANALYSIS (`{name}` is the variant's subject name). */
  readonly analysis: { readonly enter: string; readonly escalate: string; readonly fade: string };
  /** `dormant`: defined but never evaluated (WEAPON_FOCUS until a second firearm exists). */
  readonly status?: 'dormant';
}

const COMMON = {
  confidence: { enter: 0.6, exit: 0.35 },
  cooldownWaves: 2,
  maxActiveWaves: 4,
  firstWave: 5,
} as const;

/** The V1 vocabulary (GAME_DESIGN §10.2; values reasoned in BALANCING §2.17). */
export const ADAPTATIONS: Readonly<Record<AdaptationId, AdaptationConfig>> = {
  HIGH_GROUND: {
    id: 'HIGH_GROUND',
    name: 'High ground',
    family: 'stance',
    priority: 1,
    variants: [
      {
        key: 'default',
        signal: 'elevation',
        levels: [
          {
            extra: {
              archetype: 'climber',
              count: 1,
              fallback: { archetypeWeights: { runner: 1.25 } },
            },
            spawnBias: 'dwellNearest',
          },
          {
            extra: {
              archetype: 'climber',
              count: 2,
              fallback: { archetypeWeights: { runner: 1.4 } },
            },
            spawnBias: 'dwellNearest',
          },
        ],
      },
    ],
    threshold: { enter: 0.45, exit: 0.25 },
    ...COMMON,
    analysis: {
      enter: 'The horde has noticed your perch. Climbers are coming.',
      escalate: 'More of them are learning to climb.',
      fade: 'The signal has lost your perch.',
    },
  },
  ENTRENCHED: {
    id: 'ENTRENCHED',
    name: 'Entrenched',
    family: 'stance',
    priority: 2,
    variants: [
      {
        key: 'default',
        signal: 'dwell',
        levels: [
          { spawnBias: 'dwellNearest', archetypeWeights: { spitter: 1.25 } },
          { spawnBias: 'dwellNearest', archetypeWeights: { spitter: 1.25, runner: 1.25 } },
        ],
      },
    ],
    threshold: { enter: 0.7, exit: 0.5 },
    gate: { signal: 'elevation', max: 0.25 },
    ...COMMON,
    analysis: {
      enter: 'You hold one place too long. They are closing in around it.',
      escalate: 'They know exactly where you will be.',
      fade: 'You keep moving. The horde loses your trail.',
    },
  },
  SKIRMISHER: {
    id: 'SKIRMISHER',
    name: 'Skirmisher',
    family: 'stance',
    priority: 3,
    variants: [
      {
        key: 'default',
        signal: 'mobility',
        levels: [{ archetypeWeights: { runner: 1.3 } }, { archetypeWeights: { runner: 1.5 } }],
      },
    ],
    threshold: { enter: 0.45, exit: 0.3 },
    ...COMMON,
    analysis: {
      enter: 'You never stop running. Faster ones are answering.',
      escalate: 'The fast ones are multiplying.',
      fade: 'You stand your ground. The runners thin out.',
    },
  },
  CLOSE_QUARTERS: {
    id: 'CLOSE_QUARTERS',
    name: 'Close quarters',
    family: 'range',
    priority: 4,
    variants: [
      {
        key: 'default',
        signal: 'closeRange',
        levels: [
          { archetypeWeights: { tank: 1.3 } },
          { archetypeWeights: { tank: 1.3 }, traitChance: { armored: 0.08 } },
        ],
      },
    ],
    threshold: { enter: 0.5, exit: 0.35 },
    ...COMMON,
    analysis: {
      enter: 'You fight them up close. Heavier bodies are coming.',
      escalate: 'They are arriving armoured.',
      fade: 'You keep your distance. The heavy ones hang back.',
    },
  },
  LONG_RANGE: {
    id: 'LONG_RANGE',
    name: 'Long range',
    family: 'range',
    priority: 5,
    variants: [
      {
        key: 'default',
        signal: 'longRange',
        levels: [
          { archetypeWeights: { runner: 1.3 } },
          { archetypeWeights: { runner: 1.3, screamer: 1.2 } },
        ],
      },
    ],
    threshold: { enter: 0.45, exit: 0.3 },
    ...COMMON,
    analysis: {
      enter: 'You pick them off from afar. The horde sends faster ones to close the gap.',
      escalate: 'Screamers are calling them in.',
      fade: 'The fight comes close again. The rush eases.',
    },
  },
  HEADHUNTER: {
    id: 'HEADHUNTER',
    name: 'Headhunter',
    family: 'precision',
    priority: 6,
    variants: [
      {
        key: 'default',
        signal: 'headshot',
        levels: [{ traitChance: { helmeted: 0.08 } }, { traitChance: { helmeted: 0.12 } }],
      },
    ],
    threshold: { enter: 0.55, exit: 0.4 },
    gate: { signal: 'accuracy', min: 0.4 },
    ...COMMON,
    confidence: { enter: 0.65, exit: 0.4 },
    analysis: {
      enter: 'Your aim goes for the head. They are covering up.',
      escalate: 'More helmets in the crowd.',
      fade: 'Your shots spread out. The helmets come off.',
    },
  },
  WEAPON_FOCUS: {
    id: 'WEAPON_FOCUS',
    name: 'Weapon focus',
    family: 'precision',
    priority: 7,
    variants: [
      {
        key: 'burst',
        signal: 'weaponFocus.burst',
        levels: [{ traitChance: { armored: 0.08 } }, { traitChance: { armored: 0.12 } }],
      },
      {
        key: 'automatic',
        signal: 'weaponFocus.automatic',
        levels: [{ archetypeWeights: { tank: 1.25 } }, { archetypeWeights: { tank: 1.4 } }],
      },
      {
        key: 'precision',
        signal: 'weaponFocus.precision',
        levels: [{ archetypeWeights: { runner: 1.25 } }, { archetypeWeights: { runner: 1.4 } }],
      },
    ],
    threshold: { enter: 0.75, exit: 0.55 },
    ...COMMON,
    confidence: { enter: 0.65, exit: 0.4 },
    analysis: {
      enter: 'You lean on one weapon. The horde is answering it.',
      escalate: 'The answer hardens.',
      fade: 'You vary your weapons. The answer fades.',
    },
    // D-047: only the Pistol exists; it would always fire. Live once a second firearm can be owned.
    status: 'dormant',
  },
  NEGLECT: {
    id: 'NEGLECT',
    name: 'Neglect',
    family: 'priority',
    priority: 8,
    variants: SUPPORT_ARCHETYPES.map((a): AdaptationVariant => ({
      key: a,
      signal: `neglect.${a}`,
      subject: a,
      levels: [{ subjectWeight: 1.3 }, { subjectWeight: 1.5 }],
    })),
    threshold: { enter: 0.6, exit: 0.4 },
    ...COMMON,
    analysis: {
      enter: 'You let the {name}s do their work. More of them are coming.',
      escalate: 'The {name}s are gathering.',
      fade: 'You hunt the {name}s first now. Fewer of them come.',
    },
  },
};

// ---- guardrails -----------------------------------------------------------------------------------

/** GAME_DESIGN §10.4 guardrails (D-026, D-047). */
export const ADAPTATION_GUARDRAILS = {
  /** No adaptation before this wave (D-026). */
  firstAdaptiveWave: 5,
  /** Waves of evidence required before any adaptation may enter. */
  minWavesOfEvidence: 2,
  /** Most adaptations active at once (from different families). */
  maxActiveAdaptations: 2,
  /** Level 2 needs this confidence and this many waves at level 1, and no strain. */
  escalate: { confidence: 0.85, afterWaves: 2 },
  /** Evidence from archetypes an active adaptation brought counts this much toward its own signal. */
  attribution: 0.25,
  /** No adaptation on the final wave (it is hand-tuned, like its mutation-free rule). */
  noAdaptationOnFinale: true,
  /**
   * The strain governor: while strain is high with this confidence, nothing enters, nothing
   * escalates and level 2 drops to level 1. Pressure only rises while the player copes.
   */
  strain: { threshold: 0.5, confidence: 0.6 },
  /** Hard caps on what adaptation may do to a wave, whatever is active. */
  caps: {
    /** Product of the active adaptive weight multipliers, per archetype. */
    weight: [0.75, 1.6] as const,
    /** Adaptive Armored + Helmeted chance together. */
    traitTotal: 0.15,
    /** Spawn regions favoured. */
    biasRegions: 2,
  },
} as const;
