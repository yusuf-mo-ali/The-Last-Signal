/**
 * The contract between the enemy framework and a behaviour ("brain", ARCHITECTURE §7.4, D-042).
 * An archetype names its brain in config (`behavior`); `EnemyManager` runs it:
 *
 * - `think` at a limited rate (the think interval, staggered across enemies): perception,
 *   target acquisition and loss, route planning, idle decisions. The expensive part.
 * - `update` every fixed step: timers, time-exact transitions (reaction, stagger recovery,
 *   attack wind-up and strike) and the steering outputs the manager turns into movement.
 * - `onDamaged` / `onStaggered`: reactions to combat events, applied immediately.
 *
 * Brains are stateless objects: all state lives on the `Enemy`, so one brain serves every enemy.
 */

import type { EventBus } from '../../core/EventBus';
import type { EnemyRules } from '../../config/enemies';
import type { LineTester } from '../../navigation/LineTester';
import type { RouteGraph } from '../../navigation/RouteGraph';
import type { Rng } from '../../utils/Rng';
import type { Enemy } from '../Enemy';
import type { EnemyEvents } from '../events';
import type { EnemyTarget } from '../types';

export interface BrainContext {
  /** Simulated seconds since the manager's run began. */
  readonly now: number;
  /** The fixed step, seconds. */
  readonly dt: number;
  readonly lines: LineTester;
  /** The level's route graph (null when the level has none). */
  readonly routes: RouteGraph | null;
  /** Everything enemies may target this step (the player). */
  readonly targets: readonly EnemyTarget[];
  /** Seeded randomness (patrol points, pauses): reproducible from the seed (D-014). */
  readonly rng: Rng;
  readonly rules: EnemyRules;
  readonly events: EventBus<EnemyEvents>;
  /** Route node an enemy should head for to reach a target (cached per target and step). */
  goalNodeFor(target: EnemyTarget): number;
}

export interface EnemyBrain {
  think(enemy: Enemy, ctx: BrainContext): void;
  update(enemy: Enemy, ctx: BrainContext): void;
  /** Took damage from `attacker` (the likely attacker, when known). */
  onDamaged(enemy: Enemy, ctx: BrainContext, attacker: EnemyTarget | null): void;
  onStaggered(enemy: Enemy, ctx: BrainContext): void;
  /** Made aware of a target from outside, for good (waves: "the horde knows where you are"). */
  alert(enemy: Enemy, ctx: BrainContext, target: EnemyTarget): void;
}
