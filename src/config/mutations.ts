/**
 * Signal Mutation catalogue (plan §14, GAME_DESIGN §9). Mutations are pure data (D-009, D-024):
 * `WaveMutation` selects one, `SignalMutationSystem` applies its effects. Effect values arrive
 * with the mutation system (Phase 7).
 */

import type { Effect, EffectKind } from './effects';

export const MUTATION_IDS = [
  'BLACKOUT',
  'HUNGER',
  'STATIC',
  'SCREAM',
  'HIVE',
  'BLOOD_MOON',
  'LOW_GRAVITY',
  'OVERLOAD',
] as const;
export type MutationId = (typeof MUTATION_IDS)[number];

export interface MutationConfig {
  readonly name: string;
  /** The one-line rule shown to the player at wave start. */
  readonly rule: string;
  /** Which effect kinds implement it (GAME_DESIGN §9). */
  readonly effectKinds: readonly EffectKind[];
  /** In the 6-mutation initial set [Open O-4 default]. */
  readonly inV1: boolean;
  /** Filled in Phase 7. */
  readonly effects: readonly Effect[];
}

export const MUTATIONS: Readonly<Record<MutationId, MutationConfig>> = {
  BLACKOUT: {
    name: 'Blackout',
    rule: 'Lights drop sharply; emergency lights stay on.',
    effectKinds: ['environment'],
    inV1: true,
    effects: [],
  },
  HUNGER: {
    name: 'Hunger',
    rule: 'Enemies move faster.',
    effectKinds: ['stat'],
    inV1: true,
    effects: [],
  },
  STATIC: {
    name: 'Static',
    rule: 'Periodic visual interference.',
    effectKinds: ['screen'],
    inV1: true,
    effects: [],
  },
  SCREAM: {
    name: 'Scream',
    rule: 'Enemy deaths alert nearby enemies.',
    effectKinds: ['trigger'],
    inV1: true,
    effects: [],
  },
  HIVE: {
    name: 'Hive',
    rule: 'Additional spawn events occur.',
    effectKinds: ['spawnRule'],
    inV1: true,
    effects: [],
  },
  BLOOD_MOON: {
    name: 'Blood Moon',
    rule: 'Elite enemies are more likely.',
    effectKinds: ['spawnRule'],
    inV1: true,
    effects: [],
  },
  LOW_GRAVITY: {
    name: 'Low Gravity',
    rule: 'Player and enemy movement physics change.',
    effectKinds: ['stat'],
    inV1: false,
    effects: [],
  },
  OVERLOAD: {
    name: 'Overload',
    rule: 'Weapon fire causes environmental effects; recoil increases.',
    effectKinds: ['trigger', 'stat'],
    inV1: false,
    effects: [],
  },
};
