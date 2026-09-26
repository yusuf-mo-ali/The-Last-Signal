/**
 * Boss configuration schema (plan §20, GAME_DESIGN §13). Bosses fight in phases, not as huge
 * health pools. Abilities and numbers arrive with the boss system (Phase 13).
 */

export const BOSS_IDS = ['siren', 'hunter'] as const;
export type BossId = (typeof BOSS_IDS)[number];

export interface BossPhaseConfig {
  /** The phase starts when health falls to this fraction (1 = full health). */
  readonly fromHealthFraction: number;
  readonly description: string;
  /** Ability ids, interpreted by the boss system (Phase 13). */
  readonly abilities: readonly string[];
}

export interface BossConfig {
  readonly name: string;
  /** The wave that spawns it [Open O-5 default: the Siren at wave 20]. */
  readonly wave: number | null;
  readonly inV1: boolean;
  readonly phases: readonly BossPhaseConfig[];
}

export const BOSSES: Readonly<Record<BossId, BossConfig>> = {
  siren: {
    name: 'The Siren',
    wave: 20,
    inV1: true,
    phases: [
      {
        fromHealthFraction: 1,
        description: 'Stalks at range; telegraphed sonic scream; summons Runners',
        abilities: [],
      },
      {
        fromHealthFraction: 2 / 3,
        description: 'Moves between elevated points; screams cut the lights; summons Screamers',
        abilities: [],
      },
      {
        fromHealthFraction: 1 / 3,
        description: 'Enraged; charges; weak point exposed after each scream',
        abilities: [],
      },
    ],
  },
  hunter: { name: 'The Hunter', wave: null, inV1: false, phases: [] },
};
