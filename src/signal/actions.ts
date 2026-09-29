/**
 * The named trigger actions mutations use (D-009, D-045). Content refers to them only by name
 * (`{ on: 'enemy:died', action: 'deathCry' }`); the code lives here and is registered once.
 *
 * - `deathCry` (DEATH CRY, id SCREAM): a dying enemy's cry, raised as an alarm of kind `deathCry`
 *   through `EnemyManager.raiseAlarm`. Nearby enemies are told where the player is and briefly
 *   hastened (the larger haste wins, never stacked). It never calls reinforcements, so it can't
 *   change the wave's pacing or size.
 *
 * `environmentPulse` (OVERLOAD) is deliberately not registered: OVERLOAD is deferred (O-4).
 */

import type { EnemyManager } from '../enemies/EnemyManager';
import type { TriggerRegistry } from '../modifiers/TriggerRegistry';

export function registerMutationActions(
  triggers: TriggerRegistry,
  enemies: EnemyManager,
): () => void {
  return triggers.registerAction('deathCry', (_event, payload, params) => {
    if (!('position' in payload)) {
      return;
    }
    const multiplier = params.hasteMultiplier ?? 1;
    const duration = params.hasteDuration ?? 0;
    enemies.raiseAlarm({
      sourceId: payload.id,
      kind: 'deathCry',
      reinforcements: false,
      position: payload.position,
      radius: params.radius ?? 0,
      alertDuration: params.alertDuration ?? 0,
      haste: multiplier > 1 && duration > 0 ? { multiplier, duration } : null,
    });
  });
}
