/**
 * Upgrade catalogue (plan §16–17, GAME_DESIGN §11). Builds emerge from tags, not classes.
 * Effect values arrive with the progression system (Phase 9).
 */

import type { Effect } from './effects';

export const UPGRADE_TAGS = [
  'PRECISION',
  'CLOSE_QUARTERS',
  'MOBILITY',
  'SURVIVAL',
  'UTILITY',
] as const;
export type UpgradeTag = (typeof UPGRADE_TAGS)[number];

export const UPGRADE_IDS = [
  'gunner',
  'executioner',
  'adrenaline',
  'scavenger',
  'vampire',
  'heavyHands',
  'technician',
  'quickHands',
  'deepPockets',
  'thickSkin',
  'steadyAim',
  'pointBlank',
  'longShot',
  'secondWind',
  'scrapper',
] as const;
export type UpgradeId = (typeof UPGRADE_IDS)[number];

export interface UpgradeConfig {
  readonly name: string;
  readonly summary: string;
  readonly tags: readonly UpgradeTag[];
  /** `plan` = named in the plan; `proposed` = GAME_DESIGN §11.1 addition. */
  readonly source: 'plan' | 'proposed';
  /** Kept out of offers until its system exists (Technician needs a utility system, O-6). */
  readonly blocked: boolean;
  /** Filled in Phase 9. */
  readonly effects: readonly Effect[];
}

const upgrade = (
  name: string,
  summary: string,
  tags: readonly UpgradeTag[],
  source: 'plan' | 'proposed',
  blocked = false,
): UpgradeConfig => ({ name, summary, tags, source, blocked, effects: [] });

export const UPGRADES: Readonly<Record<UpgradeId, UpgradeConfig>> = {
  gunner: upgrade('Gunner', 'Higher fire rate', ['MOBILITY'], 'plan'),
  executioner: upgrade('Executioner', 'More headshot damage', ['PRECISION'], 'plan'),
  adrenaline: upgrade('Adrenaline', 'Faster movement', ['MOBILITY'], 'plan'),
  scavenger: upgrade('Scavenger', 'Higher ammo drop chance', ['UTILITY'], 'plan'),
  vampire: upgrade('Vampire', 'Heal a little on each kill', ['SURVIVAL'], 'plan'),
  heavyHands: upgrade('Heavy Hands', 'More melee damage', ['CLOSE_QUARTERS'], 'plan'),
  technician: upgrade('Technician', 'Faster trap/utility cooldown', ['UTILITY'], 'plan', true),
  quickHands: upgrade('Quick Hands', 'Faster reloads', ['MOBILITY'], 'proposed'),
  deepPockets: upgrade('Deep Pockets', 'Larger magazines', ['UTILITY'], 'proposed'),
  thickSkin: upgrade('Thick Skin', 'Higher maximum health', ['SURVIVAL'], 'proposed'),
  steadyAim: upgrade('Steady Aim', 'Less recoil and spread', ['PRECISION'], 'proposed'),
  pointBlank: upgrade('Point Blank', 'More close-range damage', ['CLOSE_QUARTERS'], 'proposed'),
  longShot: upgrade('Long Shot', 'Less damage falloff', ['PRECISION'], 'proposed'),
  secondWind: upgrade('Second Wind', 'Heal when a wave completes', ['SURVIVAL'], 'proposed'),
  scrapper: upgrade('Scrapper', 'More Scrap gained', ['UTILITY'], 'proposed'),
};

/** Upgrades offered per selection (plan §16). */
export const UPGRADE_CHOICES_PER_OFFER = 3;
