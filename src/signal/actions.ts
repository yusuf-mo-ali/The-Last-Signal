/**
 * The named trigger actions mutations use (D-009, D-045). Content refers to them only by name
 * (`{ on: 'enemy:died', action: 'deathCry' }`); the code lives here and is registered once.
 *
 * - `deathCry` (DEATH CRY, id SCREAM): a dying enemy's cry, raised as an alarm of kind `deathCry`
 *   through `EnemyManager.raiseAlarm`. Nearby enemies learn where the player was at the kill (not
 *   where they go next: `lastKnown`, D-046), rush that spot, and are briefly hastened and
 *   frenzied (the stronger value wins, never stacked). It never calls reinforcements, so it can't
 *   change the wave's pacing or size, and it never hurts anyone, so it cannot chain.
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
    const frenzyDuration = params.frenzyDuration ?? 0;
    enemies.raiseAlarm({
      sourceId: payload.id,
      kind: 'deathCry',
      reinforcements: false,
      position: payload.position,
      radius: params.radius ?? 0,
      alertDuration: params.alertDuration ?? 0,
      alertMode: 'lastKnown',
      haste: multiplier > 1 && duration > 0 ? { multiplier, duration } : null,
      frenzy:
        frenzyDuration > 0
          ? {
              duration: frenzyDuration,
              cooldownScale: params.frenzyCooldownScale ?? 1,
              windupScale: params.frenzyWindupScale ?? 1,
              turnScale: params.frenzyTurnScale ?? 1,
              staggerScale: params.frenzyStaggerScale ?? 1,
            }
          : null,
    });
  });
}
