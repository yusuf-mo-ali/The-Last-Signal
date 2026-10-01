/**
 * Drop rolls (D-041): which pickups a death leaves behind. Pure apart from the injected seeded
 * `Rng` (D-014), so a seed reproduces every drop. Not tied to any kind of target: whoever owns a
 * death (a training dummy now, an enemy later) rolls its own table.
 */

import type { DropEntry, PickupId } from '../config/drops';
import type { Rng } from '../utils/Rng';

/**
 * Rolls every entry of a table once, in order. `chanceMultiplier` scales each chance (the
 * Scavenger upgrade, later); chances are clamped to [0, 1].
 */
export function rollDrops(table: readonly DropEntry[], rng: Rng, chanceMultiplier = 1): PickupId[] {
  const drops: PickupId[] = [];
  for (const entry of table) {
    const chance = Math.min(1, Math.max(0, entry.chance * chanceMultiplier));
    // Always draw, so one entry's chance never shifts the rolls of the entries after it.
    const roll = rng.next();
    if (roll < chance) {
      drops.push(entry.pickup);
    }
  }
  return drops;
}
