/**
 * Behaviours by id (D-042): an archetype's `behavior` in config selects one. New behaviours
 * (a Screamer that keeps its distance, a Runner's lunge) are added here without touching the
 * enemy framework.
 */

import type { EnemyBehaviorId } from '../../config/enemies';
import type { EnemyBrain } from './brain';
import { meleeBrain } from './meleeBrain';

export const BRAINS: Readonly<Record<EnemyBehaviorId, EnemyBrain>> = {
  melee: meleeBrain,
};
