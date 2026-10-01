/**
 * Wave configuration (plan §13, GAME_DESIGN §8, D-044): the plan's difficulty tiers, the run length
 * and every number the wave generator and the wave runtime use. Pass-1 values; reasoning in
 * BALANCING.md §2.14.
 *
 * Difficulty rises through the threat budget, the composition (which archetypes, which themes),
 * traits and how many enemies are alive at once, never through ever-growing enemy health. Every
 * curve is defined for any wave number (plan §13: unlimited waves).
 */

import type { BossId } from './bosses';
import type { EnemyArchetypeId, EnemyModifierId, ImplementedEnemyId } from './enemies';
import type { SurgeRule } from './effects';
import type { MutationId } from './mutations';

/** A standard run ends in victory after this wave (plan §42); the generator supports more (§13). */
export const FINAL_WAVE = 20;

/** Waves without a mutation at the start of a run [Proposed, O-7]. */
export const MUTATION_FREE_WAVES = 3;

export const DIFFICULTY_TIER_IDS = [
  'introduction',
  'variety',
  'pressure',
  'complex',
  'boss',
] as const;
export type DifficultyTierId = (typeof DIFFICULTY_TIER_IDS)[number];

/** Plan §13 tiers; wave ranges are inclusive. Waves after the last tier count as `complex`. */
export const DIFFICULTY_TIERS: readonly {
  readonly id: DifficultyTierId;
  readonly firstWave: number;
  readonly lastWave: number;
  readonly description: string;
}[] = [
  { id: 'introduction', firstWave: 1, lastWave: 3, description: 'Basic introduction' },
  { id: 'variety', firstWave: 4, lastWave: 7, description: 'More enemy variety' },
  { id: 'pressure', firstWave: 8, lastWave: 12, description: 'Higher pressure' },
  { id: 'complex', firstWave: 13, lastWave: 19, description: 'Complex combinations' },
  { id: 'boss', firstWave: 20, lastWave: 20, description: 'Boss / major event' },
];

/**
 * Composition themes (GAME_DESIGN §8 "swarm, heavy, mixed, ambush"): `intro` for the first waves,
 * the four rotating themes after, and `finale` for the final wave.
 */
export const WAVE_THEME_IDS = ['intro', 'mixed', 'swarm', 'heavy', 'ambush', 'finale'] as const;
export type WaveThemeId = (typeof WAVE_THEME_IDS)[number];
/** Themes that rotate from wave 4 (never the same twice in a row). */
export const ROTATING_THEMES: readonly WaveThemeId[] = ['mixed', 'swarm', 'heavy', 'ambush'];

/** Compass regions of the level's spawn points (spawn bias for alarms and, later, adaptation). */
export const SPAWN_REGION_IDS = [
  'north',
  'northeast',
  'east',
  'southeast',
  'south',
  'southwest',
  'west',
  'northwest',
] as const;
export type SpawnRegionId = (typeof SPAWN_REGION_IDS)[number];

/** One enemy of a wave, in spawn order. */
export interface WaveSpawn {
  readonly archetype: ImplementedEnemyId;
  /** Canonical order (`normalizeTraits`). */
  readonly traits: readonly EnemyModifierId[];
  /** Threat cost with its traits (`applyTraits(…).threatCost`). */
  readonly cost: number;
}

/**
 * How other systems shape a wave without owning it (D-024, D-026): the Adaptive system (Phase 8)
 * and mutations (Phase 7) hand these to the generator, which clamps every value. Adaptation
 * changes the mix, never the total: only a mutation's `budgetMultiplier` changes the budget.
 */
export interface CompositionModifier {
  readonly source: 'adaptive' | 'mutation' | 'debug';
  /** Weight multipliers per archetype (clamped to `WAVE_RULES.modifierClamp.weight`). */
  readonly archetypeWeights?: Readonly<Partial<Record<EnemyArchetypeId, number>>>;
  /** Added to the per-enemy trait chances (clamped to ± `modifierClamp.traitChance`). */
  readonly traitChance?: Readonly<Partial<Record<EnemyModifierId, number>>>;
  /**
   * Archetypes outside the default roster (the deferred Climber, D-043). Accepted only from the
   * adaptive source and only for implemented archetypes; capped per wave.
   */
  readonly extraArchetypes?: readonly EnemyArchetypeId[];
  /**
   * Exactly this many of an archetype outside the roster (the Climber, D-047). Adaptive source
   * only, from the archetype's `adaptiveUnlocks` wave, trait-free, within `extraArchetypeMax` and
   * the budget (paid for out of it, never added to it).
   */
  readonly extraCounts?: Readonly<Partial<Record<EnemyArchetypeId, number>>>;
  /** Mutations only (clamped to `modifierClamp.budget`). */
  readonly budgetMultiplier?: number;
  /** Spawn regions to favour (flank spawns). */
  readonly spawnBias?: readonly SpawnRegionId[];
  // ---- Mutations only (D-045; ignored from any other source, clamped by `modifierClamp`) ----
  /** Raises the wave's Elite limit. */
  readonly eliteMaxBonus?: number;
  /** At least this many Elites, when the budget allows. */
  readonly eliteMinimum?: number;
  /** Extra spawn events (surges). */
  readonly surges?: SurgeRule;
}

/** A surge scheduled in a wave: when the queue reaches `at`, a group of up to `size` arrives. */
export interface WaveSurge {
  /** Fraction of the wave's queue spawned (0–1). */
  readonly at: number;
  /** Largest group the surge brings (never above the room under `maxAlive`). */
  readonly size: number;
  /** Seconds of warning before it arrives. */
  readonly warning: number;
}

/** Plan §13: what each generated wave contains, plus what the runtime needs to run it. */
export interface WaveDefinition {
  readonly waveNumber: number;
  /** Threat points to spend. */
  readonly enemyBudget: number;
  /** Enemies spawned per second while below `maxAlive`. */
  readonly spawnRate: number;
  /** How many of each archetype (plan §13's composition). */
  readonly enemyComposition: Readonly<Partial<Record<EnemyArchetypeId, number>>>;
  readonly mutation: MutationId | null;
  readonly specialEvent: string | null;
  readonly bossFlag: boolean;
  /** Most wave enemies alive at once. */
  readonly maxAlive: number;
  // ---- Phase 6 (D-044) ----
  readonly tier: DifficultyTierId;
  readonly theme: WaveThemeId;
  /** The run's last wave (victory when cleared, unless endless). */
  readonly finale: boolean;
  readonly boss: BossId | null;
  /** Every enemy of the wave, in spawn order; groups are formed at run time. */
  readonly spawns: readonly WaveSpawn[];
  /** Threat actually spent: within 1 of the budget. */
  readonly budgetSpent: number;
  /** Enemies per spawn group. */
  readonly groupSize: { readonly min: number; readonly max: number };
  /** Regions spawns favour this wave (from the modifiers). */
  readonly spawnBias: readonly SpawnRegionId[];
  /** The modifiers that shaped it (for the future "SIGNAL ANALYSIS" line). */
  readonly modifiers: readonly CompositionModifier[];
  // ---- Phase 7 (D-045) ----
  /** Extra spawn events, in order (none without a surge mutation). */
  readonly surges: readonly WaveSurge[];
}

/** A per-wave value that starts at `from`, rises by `perWave` and stops at `max`. */
export interface TraitSchedule {
  readonly from: number;
  readonly perWave: number;
  readonly max: number;
}

export interface WaveRules {
  /** B(n) = base + linear·(n−1) + quadratic·(n−1)² up to the final wave, then + endlessSlope·(n − final). */
  readonly budget: {
    readonly base: number;
    readonly linear: number;
    readonly quadratic: number;
    readonly endlessSlope: number;
  };
  /** min(cap, base + perWave·n); after the final wave min(endlessCap, cap + ⌊(n − final)/endlessEvery⌋). */
  readonly maxAlive: {
    readonly base: number;
    readonly perWave: number;
    readonly cap: number;
    readonly endlessCap: number;
    readonly endlessEvery: number;
  };
  /** Enemies per second: min(cap, base + perWave·n). */
  readonly spawnRate: { readonly base: number; readonly perWave: number; readonly cap: number };
  /** Group size 1 … min(max, 1 + ⌊n / every⌋) (+ `ambushBonus` on ambush waves). */
  readonly groupSize: {
    readonly every: number;
    readonly max: number;
    readonly ambushBonus: number;
  };
  /** First wave each roster archetype can appear in (none for adaptive-only archetypes). */
  readonly unlocks: Readonly<Partial<Record<ImplementedEnemyId, number>>>;
  /**
   * First wave the adaptive system may bring each archetype outside the roster (D-047: the
   * Climber). Enforced by the generator whatever the adaptive system asks.
   */
  readonly adaptiveUnlocks: Readonly<Partial<Record<ImplementedEnemyId, number>>>;
  /** Base draw weights per tier. */
  readonly tierWeights: Readonly<
    Record<DifficultyTierId, Readonly<Partial<Record<ImplementedEnemyId, number>>>>
  >;
  /** Weight multipliers per theme. */
  readonly themeMultipliers: Readonly<
    Record<WaveThemeId, Readonly<Partial<Record<ImplementedEnemyId, number>>>>
  >;
  /** Most of an archetype per wave: 1 + ⌊(n − from) / every⌋ (uncapped archetypes are absent). */
  readonly caps: Readonly<
    Partial<Record<ImplementedEnemyId, { readonly from: number; readonly every: number }>>
  >;
  /** Walkers make up at least this share of the budget. */
  readonly minWalkerShare: number;
  /** At least this many of each on the final wave. */
  readonly finaleMinimum: Readonly<Partial<Record<ImplementedEnemyId, number>>>;
  /** Heavy archetypes are kept out of this first share of the spawn order. */
  readonly openingShare: number;
  readonly openingExcluded: readonly ImplementedEnemyId[];
  /** Per-enemy trait chances. */
  readonly traits: Readonly<Record<EnemyModifierId, TraitSchedule>>;
  /** Most Elites per wave: the last entry whose `fromWave` ≤ n; endless: 1 + ⌊n / endlessEvery⌋. */
  readonly eliteMax: {
    readonly steps: readonly { readonly fromWave: number; readonly max: number }[];
    readonly endlessEvery: number;
  };
  /** Most extra (adaptive) archetype enemies per wave. */
  readonly extraArchetypeMax: number;
  readonly modifierClamp: {
    readonly weight: readonly [number, number];
    readonly traitChance: number;
    readonly budget: readonly [number, number];
    /** Mutations only (D-045). */
    readonly eliteMaxBonus: number;
    readonly eliteMinimum: number;
    readonly surges: {
      readonly count: number;
      readonly extraGroupSize: number;
      readonly groupSize: number;
      readonly warning: readonly [number, number];
    };
    /**
     * The adaptive source alone (D-047), before it combines with the others: its weight product
     * per archetype, its Armored + Helmeted chance in total (never Elite), its spawn regions.
     */
    readonly adaptive: {
      readonly weight: readonly [number, number];
      readonly traitTotal: number;
      readonly biasRegions: number;
    };
  };
  /** Seconds of `WAVE_START` before spawning (the announcement). */
  readonly introTime: number;
  /** Seconds of `WAVE_COMPLETE` before the next wave (the breather). */
  readonly breather: number;
  /** Seconds into `WAVE_ACTIVE` before the first group. */
  readonly firstGroupDelay: number;
  readonly spawn: {
    /** Metres from the player (horizontal) a spawn point must be. */
    readonly minDistance: number;
    /** Degrees added to half the view's horizontal FOV when judging "in view". */
    readonly viewMarginDeg: number;
    /** Preferred distance band (full weight inside, falling off outside). */
    readonly preferMin: number;
    readonly preferMax: number;
    /** Weight of a point used by one of the last `repeatMemory` groups. */
    readonly repeatPenalty: number;
    readonly repeatMemory: number;
    /** Weight multiplier for favoured regions. */
    readonly biasWeight: number;
    /** Seconds between retries when no point is eligible. */
    readonly retryInterval: number;
    /** Seconds of failed retries before the view rule is relaxed (never the distance). */
    readonly relaxAfter: number;
    /** Metres between group members around the point. */
    readonly groupSpacing: number;
  };
  /** A wave that stalls on a few enemies that cannot reach the player. */
  readonly stragglers: {
    readonly maxRemaining: number;
    /** Seconds without a wave enemy dying or being hurt. */
    readonly timeout: number;
    /** Only stragglers farther than this from the player are moved. */
    readonly farDistance: number;
  };
}

// Pass-1 values; reasoning in BALANCING.md §2.14.
export const WAVE_RULES: WaveRules = {
  budget: { base: 6, linear: 2.2, quadratic: 0.08, endlessSlope: 5.2 },
  maxAlive: { base: 5, perWave: 1, cap: 24, endlessCap: 32, endlessEvery: 5 },
  spawnRate: { base: 0.5, perWave: 0.05, cap: 2 },
  groupSize: { every: 6, max: 4, ambushBonus: 1 },
  // The Spitter arrives on wave 10 (D-046): one on its first wave, a few more later.
  unlocks: { walker: 1, runner: 3, screamer: 4, tank: 6, spitter: 10 },
  adaptiveUnlocks: { climber: 8 },
  tierWeights: {
    introduction: { walker: 1, runner: 0.35 },
    variety: { walker: 1, runner: 0.5, screamer: 0.2, tank: 0.15 },
    pressure: { walker: 1, runner: 0.6, screamer: 0.25, tank: 0.25, spitter: 0.15 },
    complex: { walker: 1, runner: 0.7, screamer: 0.3, tank: 0.35, spitter: 0.2 },
    boss: { walker: 1, runner: 0.7, screamer: 0.3, tank: 0.35, spitter: 0.2 },
  },
  themeMultipliers: {
    intro: {},
    mixed: {},
    swarm: { runner: 1.8, walker: 1.2, tank: 0.3 },
    heavy: { tank: 2, walker: 1.2, runner: 0.6, spitter: 0.7 },
    ambush: { runner: 1.4, screamer: 1.5, spitter: 1.3 },
    finale: { tank: 1.2, screamer: 1.2 },
  },
  caps: {
    screamer: { from: 4, every: 5 },
    tank: { from: 6, every: 4 },
    spitter: { from: 10, every: 5 },
  },
  minWalkerShare: 0.3,
  finaleMinimum: { tank: 2, screamer: 2 },
  openingShare: 0.15,
  openingExcluded: ['tank', 'screamer', 'spitter', 'climber'],
  traits: {
    armored: { from: 8, perWave: 0.04, max: 0.25 },
    helmeted: { from: 8, perWave: 0.04, max: 0.25 },
    elite: { from: 13, perWave: 0.03, max: 0.12 },
  },
  eliteMax: {
    steps: [
      { fromWave: 13, max: 1 },
      { fromWave: 16, max: 2 },
      { fromWave: 20, max: 3 },
    ],
    endlessEvery: 8,
  },
  extraArchetypeMax: 2,
  modifierClamp: {
    weight: [0.5, 2],
    traitChance: 0.2,
    budget: [0.5, 1.5],
    eliteMaxBonus: 3,
    eliteMinimum: 2,
    surges: { count: 3, extraGroupSize: 2, groupSize: 6, warning: [1, 4] },
    adaptive: { weight: [0.75, 1.6], traitTotal: 0.15, biasRegions: 2 },
  },
  introTime: 3,
  breather: 10,
  firstGroupDelay: 2,
  spawn: {
    minDistance: 12,
    viewMarginDeg: 15,
    preferMin: 16,
    preferMax: 30,
    repeatPenalty: 0.3,
    repeatMemory: 2,
    biasWeight: 2,
    retryInterval: 0.5,
    relaxAfter: 3,
    groupSpacing: 1.2,
  },
  stragglers: { maxRemaining: 2, timeout: 40, farDistance: 25 },
};
