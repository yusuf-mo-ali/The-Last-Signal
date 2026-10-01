/**
 * The simulated world (ARCHITECTURE §7.7): the level definition, its collision, and the signal
 * beacon. Built once from level data, so collision and render geometry come from the same source
 * (D-013). Browser-independent.
 */

import type { FixedUpdateSystem } from '../core/Game';
import { CollisionWorld } from '../physics/CollisionWorld';
import { levelTriangles } from './levels/geometry';
import type { LevelDefinition } from './levels/types';
import { SignalBeacon } from './SignalBeacon';

export class World implements FixedUpdateSystem {
  readonly level: LevelDefinition;
  readonly collision: CollisionWorld;
  readonly beacon = new SignalBeacon();

  constructor(level: LevelDefinition) {
    this.level = level;
    this.collision = new CollisionWorld(
      levelTriangles(level.brushes, 'collision').flatMap((group) => group.triangles),
    );
  }

  fixedUpdate(fixedDt: number): void {
    this.beacon.fixedUpdate(fixedDt);
  }
}
