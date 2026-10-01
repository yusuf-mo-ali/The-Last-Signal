/**
 * Training dummies (Phase 3, D-041): **temporary validation targets** for the combat pipeline.
 * Each dummy is exactly what a zombie will be to combat, a hitbox rig plus a `Health` registered
 * with the `CombatSystem`, with none of a zombie's behaviour: no AI, no movement, no attacks.
 *
 * When a dummy dies it rolls its drop table (the same hook an enemy death will use), stays down
 * for its respawn delay, then stands up again at full health. `reset()` rebuilds the configured
 * range for a new run. Browser-independent and deterministic (drops use the injected `Rng`).
 */

import { HUMANOID_RIG } from '../../config/combat';
import { DROP_TABLES } from '../../config/drops';
import {
  TRAINING_DUMMIES,
  TRAINING_RANGE,
  type TrainingDummyDefinition,
  type TrainingDummyKind,
  type TrainingDummyPlacement,
} from '../../config/training';
import type { FixedUpdateSystem } from '../../core/Game';
import type { Rng } from '../../utils/Rng';
import { countDown } from '../../weapons/timing';
import { rollDrops } from '../../world/drops';
import type { PickupManager } from '../../world/PickupManager';
import type { CombatSystem } from '../CombatSystem';
import { Health } from '../Health';
import { HitboxRig } from '../hitbox';

export interface TrainingDummy {
  readonly id: string;
  readonly definition: TrainingDummyDefinition;
  readonly rig: HitboxRig;
  readonly health: Health;
  /** Seconds until a dead dummy stands up again (0 while alive). */
  readonly respawnTimer: number;
  /** Times it has been killed. */
  readonly deaths: number;
}

interface DummyRecord extends TrainingDummy {
  respawnTimer: number;
  deaths: number;
}

export interface TrainingRangeOptions {
  readonly combat: CombatSystem;
  /** Drop rolls (D-014). */
  readonly rng: Rng;
  /** Where drops appear; without it, deaths drop nothing. */
  readonly pickups?: PickupManager;
  readonly definitions?: Readonly<Record<TrainingDummyKind, TrainingDummyDefinition>>;
  /** The dummies `reset()` places; defaults to the configured range (none when it is disabled). */
  readonly placements?: readonly TrainingDummyPlacement[];
}

export class TrainingRange implements FixedUpdateSystem {
  private readonly combat: CombatSystem;
  private readonly rng: Rng;
  private readonly pickups: PickupManager | undefined;
  private readonly definitions: Readonly<Record<TrainingDummyKind, TrainingDummyDefinition>>;
  private readonly placements: readonly TrainingDummyPlacement[];
  private list: DummyRecord[] = [];
  private nextNumber = 1;

  constructor(options: TrainingRangeOptions) {
    this.combat = options.combat;
    this.rng = options.rng;
    this.pickups = options.pickups;
    this.definitions = options.definitions ?? TRAINING_DUMMIES;
    this.placements = options.placements ?? (TRAINING_RANGE.enabled ? TRAINING_RANGE.dummies : []);
  }

  get dummies(): readonly TrainingDummy[] {
    return this.list;
  }

  get(id: string): TrainingDummy | undefined {
    return this.list.find((d) => d.id === id);
  }

  /** Removes every dummy and places the configured range again (a new run). */
  reset(): void {
    this.clear();
    this.nextNumber = 1;
    for (const placement of this.placements) {
      this.spawn(placement.kind, placement.position, placement.yaw);
    }
  }

  /** Places a dummy (feet position, facing). Returns it; its id is `dummy-<n>`. */
  spawn(
    kind: TrainingDummyKind,
    position: readonly [number, number, number],
    yaw = 0,
  ): TrainingDummy {
    const definition = this.definitions[kind] as TrainingDummyDefinition | undefined;
    if (!definition) {
      throw new Error(`Unknown training dummy "${kind}"`);
    }
    const rig = new HitboxRig(HUMANOID_RIG);
    rig.position.set(position[0], position[1], position[2]);
    rig.yaw = yaw;
    const record: DummyRecord = {
      id: `dummy-${this.nextNumber++}`,
      definition,
      rig,
      health: new Health({ max: definition.health }),
      respawnTimer: 0,
      deaths: 0,
    };
    this.combat.add({
      id: record.id,
      rig,
      health: record.health,
      ...(definition.zoneMultipliers ? { zoneMultipliers: definition.zoneMultipliers } : {}),
      armor: definition.armor,
      resistance: definition.resistance,
      staggerThreshold: definition.staggerThreshold,
      onKilled: () => {
        this.onKilled(record);
      },
    });
    this.list.push(record);
    return record;
  }

  remove(id: string): boolean {
    const index = this.list.findIndex((d) => d.id === id);
    if (index < 0) {
      return false;
    }
    this.list.splice(index, 1);
    this.combat.remove(id);
    return true;
  }

  clear(): void {
    for (const dummy of this.list) {
      this.combat.remove(dummy.id);
    }
    this.list = [];
  }

  /** Stands every dummy up at full health immediately. */
  reviveAll(): void {
    for (const dummy of this.list) {
      dummy.respawnTimer = 0;
      if (dummy.health.isDead || dummy.health.current < dummy.health.max) {
        this.combat.revive(dummy.id);
      }
    }
  }

  fixedUpdate(dt: number): void {
    for (const dummy of this.list) {
      if (dummy.respawnTimer <= 0) {
        continue;
      }
      dummy.respawnTimer = countDown(dummy.respawnTimer, dt);
      if (dummy.respawnTimer <= 0) {
        this.combat.revive(dummy.id);
      }
    }
  }

  private onKilled(dummy: DummyRecord): void {
    dummy.deaths++;
    // Always positive, so a zero delay still waits for the next step.
    dummy.respawnTimer = Math.max(dummy.definition.respawnDelay, 1e-6);
    const table = dummy.definition.drops;
    if (!table || !this.pickups) {
      return;
    }
    for (const pickup of rollDrops(DROP_TABLES[table], this.rng)) {
      const p = dummy.rig.position;
      this.pickups.spawn(pickup, [p.x, p.y + 0.2, p.z]);
    }
  }
}
