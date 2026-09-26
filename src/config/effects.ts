/**
 * The effect vocabulary shared by upgrades, mutations, difficulty and adaptation (D-009).
 * Content refers to effects by data; the modifier/trigger system (Phase 7+) interprets them.
 */

export const EFFECT_KINDS = ['stat', 'trigger', 'spawnRule', 'environment', 'screen'] as const;
export type EffectKind = (typeof EFFECT_KINDS)[number];

export type StatOp = 'add' | 'mul' | 'override';

export type Effect =
  /** Changes a named stat, e.g. `{ target: 'weapon.fireRate', op: 'mul', value: 1.1 }`. */
  | { readonly kind: 'stat'; readonly target: string; readonly op: StatOp; readonly value: number }
  /** Runs a named action when an event fires, e.g. heal on `enemy:killed`. */
  | {
      readonly kind: 'trigger';
      readonly on: string;
      readonly action: string;
      readonly params?: Readonly<Record<string, number>>;
    }
  /** Changes how waves spawn, e.g. extra spawn events or elite probability. */
  | {
      readonly kind: 'spawnRule';
      readonly rule: string;
      readonly params?: Readonly<Record<string, number>>;
    }
  /** Applies an environment overlay (D-028), e.g. a blackout lighting state. */
  | { readonly kind: 'environment'; readonly state: string }
  /** A presentation-only screen effect, e.g. static interference. */
  | {
      readonly kind: 'screen';
      readonly effect: string;
      readonly params?: Readonly<Record<string, number>>;
    };
