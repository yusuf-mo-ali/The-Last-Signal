/**
 * Pickups on the ground (plan §10 ammo drops, D-041): the foundation only. A pickup is spawned
 * somewhere (a drop from a death, later a cache), waits for the player to come close, and is
 * collected if the `collect` callback accepts it; otherwise it stays until its lifetime ends. What
 * a pickup gives is decided by that callback (ammunition goes to `WeaponManager.addAmmo`), so this
 * class knows nothing about weapons, enemies or economy. Browser-independent.
 */

import { Vector3 } from 'three';
import { PICKUP_RULES, PICKUPS, type PickupDefinition, type PickupId } from '../config/drops';
import { EventBus } from '../core/EventBus';
import type { FixedUpdateSystem } from '../core/Game';
import type { Vec3Tuple } from '../weapons/types';

export interface Pickup {
  /** Unique for the lifetime of the manager. */
  readonly id: number;
  readonly definition: PickupDefinition;
  readonly position: Vector3;
  /** Seconds since it appeared. */
  age: number;
}

export interface PickupEvents {
  spawned: { readonly id: number; readonly pickup: PickupId; readonly position: Vec3Tuple };
  collected: { readonly id: number; readonly pickup: PickupId };
  expired: { readonly id: number; readonly pickup: PickupId };
}

export interface PickupManagerOptions {
  /** Where the collector (the player) stands this step (feet), or null when nobody can collect. */
  readonly collector: () => Vector3 | null;
  /** Applies a pickup; returns false if it was not needed (it then stays on the ground). */
  readonly collect: (pickup: Pickup) => boolean;
  readonly definitions?: Readonly<Record<PickupId, PickupDefinition>>;
  readonly maxActive?: number;
}

export class PickupManager implements FixedUpdateSystem {
  readonly events = new EventBus<PickupEvents>();
  private readonly collector: () => Vector3 | null;
  private readonly collect: (pickup: Pickup) => boolean;
  private readonly definitions: Readonly<Record<PickupId, PickupDefinition>>;
  private readonly maxActive: number;
  private readonly list: Pickup[] = [];
  private nextId = 1;

  constructor(options: PickupManagerOptions) {
    this.collector = options.collector;
    this.collect = options.collect;
    this.definitions = options.definitions ?? PICKUPS;
    this.maxActive = options.maxActive ?? PICKUP_RULES.maxActive;
  }

  get active(): readonly Pickup[] {
    return this.list;
  }

  spawn(id: PickupId, position: Vector3 | Vec3Tuple): Pickup {
    const definition = this.definitions[id] as PickupDefinition | undefined;
    if (!definition) {
      throw new Error(`Unknown pickup "${id}"`);
    }
    while (this.list.length >= this.maxActive) {
      const oldest = this.list.shift();
      if (oldest) {
        this.events.emit('expired', { id: oldest.id, pickup: oldest.definition.id });
      }
    }
    const pickup: Pickup = {
      id: this.nextId++,
      definition,
      position: position instanceof Vector3 ? position.clone() : new Vector3(...position),
      age: 0,
    };
    this.list.push(pickup);
    this.events.emit('spawned', {
      id: pickup.id,
      pickup: definition.id,
      position: [pickup.position.x, pickup.position.y, pickup.position.z],
    });
    return pickup;
  }

  fixedUpdate(dt: number): void {
    const at = this.collector();
    for (let i = this.list.length - 1; i >= 0; i--) {
      const pickup = this.list[i];
      if (!pickup) {
        continue;
      }
      pickup.age += dt;
      if (at && this.inReach(pickup, at) && this.collect(pickup)) {
        this.list.splice(i, 1);
        this.events.emit('collected', { id: pickup.id, pickup: pickup.definition.id });
      } else if (pickup.age >= pickup.definition.lifetime) {
        this.list.splice(i, 1);
        this.events.emit('expired', { id: pickup.id, pickup: pickup.definition.id });
      }
    }
  }

  /** Removes every pickup (new run). */
  clear(): void {
    this.list.length = 0;
  }

  private inReach(pickup: Pickup, feet: Vector3): boolean {
    const dx = pickup.position.x - feet.x;
    const dz = pickup.position.z - feet.z;
    const r = pickup.definition.radius;
    return (
      dx * dx + dz * dz <= r * r &&
      Math.abs(pickup.position.y - feet.y) <= PICKUP_RULES.verticalReach
    );
  }
}
