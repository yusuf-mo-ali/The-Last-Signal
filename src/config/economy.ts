/**
 * Economy schema (plan §21, GAME_DESIGN §11). Exactly two currencies; reward amounts arrive with
 * the progression system (Phase 9), sinks with open question O-1.
 */

export const CURRENCIES = ['xp', 'scrap'] as const;
export type Currency = (typeof CURRENCIES)[number];

/** Plan §21 reward sources. */
export const REWARD_SOURCES = [
  'enemyKill',
  'headshot',
  'waveComplete',
  'bossKill',
  'optionalObjective',
  'rareEvent',
] as const;
export type RewardSource = (typeof REWARD_SOURCES)[number];

export type RewardTable = Readonly<Record<RewardSource, Readonly<Record<Currency, number>>>>;
