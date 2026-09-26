/**
 * The player as something enemies can target and hit (D-042): an adapter from `Player` and
 * `PlayerHealth` to the generic `EnemyTarget`, so the enemy framework never depends on the player.
 */

import type { EnemyTarget } from '../enemies/types';
import type { Player } from './Player';
import type { PlayerHealth } from './PlayerHealth';

export function createPlayerTarget(player: Player, health: PlayerHealth): EnemyTarget {
  const { motor } = player;
  return {
    id: 'player',
    position: motor.position,
    get eyeHeight() {
      return motor.eyeHeight;
    },
    radius: motor.config.radius,
    isAlive: () => !health.isDead,
    receiveHit: (hit) =>
      health.damage({
        amount: hit.amount,
        source: { kind: 'enemy', id: hit.attackerId, archetype: hit.archetype },
        direction: hit.direction,
      }),
  };
}
