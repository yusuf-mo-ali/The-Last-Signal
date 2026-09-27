/**
 * Breakable armor on a combat target (D-043): a plate covers some zones and absorbs the damage
 * they would take until its durability is used up, then it is broken and stops protecting. The
 * state lives here (owned by the target's owner, reset on respawn); the data comes from config
 * (`ArmorPlateDefinition`, e.g. the Helmeted trait's helmet). Browser-independent.
 */

import type { DamageZone } from '../config/enemies';
import type { ArmorPlateDefinition } from '../config/traits';

export class ArmorPlate {
  readonly id: string;
  readonly zones: readonly DamageZone[];
  readonly max: number;
  readonly staggerOnBreak: boolean;
  durability: number;

  constructor(definition: ArmorPlateDefinition) {
    this.id = definition.id;
    this.zones = definition.zones;
    this.max = Math.max(0, definition.durability);
    this.staggerOnBreak = definition.staggerOnBreak;
    this.durability = this.max;
  }

  get broken(): boolean {
    return this.durability <= 1e-9;
  }

  covers(zone: DamageZone): boolean {
    return !this.broken && this.zones.includes(zone);
  }

  /** Takes as much of `amount` as it can; returns what it took. */
  absorb(amount: number): number {
    if (this.broken || !(amount > 0)) {
      return 0;
    }
    const taken = Math.min(amount, this.durability);
    this.durability -= taken;
    if (this.durability <= 1e-9) {
      this.durability = 0;
    }
    return taken;
  }

  /** Whole again (a respawn). */
  reset(): void {
    this.durability = this.max;
  }
}
