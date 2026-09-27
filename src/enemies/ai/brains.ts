/**
 * Behaviours by id (D-042): an archetype's `behavior` in config selects one. New behaviours
 * (the Screamer's support caster since Phase 5) are added here without touching the
 * enemy framework.
 */

import type { EnemyBehaviorId } from '../../config/enemies';
import type { EnemyBrain } from './brain';
import { meleeBrain } from './meleeBrain';
import { screamerBrain } from './screamerBrain';

export const BRAINS: Readonly<Record<EnemyBehaviorId, EnemyBrain>> = {
  melee: meleeBrain,
  screamer: screamerBrain,
};
