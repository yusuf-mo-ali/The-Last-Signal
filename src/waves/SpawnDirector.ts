/**
 * Where a wave's next group enters (D-044): one of the level's authored spawn points, chosen so the
 * spawn is fair and varied.
 *
 * A point is eligible when:
 *   1. it is at least `minDistance` from the player (horizontally);
 *   2. the player cannot see it: it is outside the view cone (half the horizontal FOV plus a
 *      margin) or a wall blocks the line from the eye to head height at the point;
 *   3. every member of the group has room to stand around it (a small ring of offsets).
 * `elevated` points are never used by normal waves (reserved for adaptive content, D-043).
 *
 * Among eligible points the draw is weighted: a preferred distance band, points used by the last
 * few groups less likely, favoured regions (spawn bias) more likely. Seeded (D-014). When nothing
 * is eligible the caller retries; after a while it may relax the view rule (never the distance).
 */

import { Vector3 } from 'three';
import type { ImplementedEnemyId } from '../config/enemies';
import { WAVE_RULES, type SpawnRegionId, type WaveRules } from '../config/waves';
import type { Rng } from '../utils/Rng';
import type { SpawnPointDefinition } from '../world/levels/types';

/** Where the player is looking from (the camera). */
export interface SpawnViewer {
  readonly eye: Vector3;
  /** Look yaw: 0 faces −z (north), positive turns left (the player's convention). */
  readonly yaw: number;
  /** Horizontal field of view, degrees. */
  readonly fovDeg: number;
}

export interface SpawnDirectorOptions {
  readonly points: readonly SpawnPointDefinition[];
  /** Room for `archetype`'s body at feet position `at` (EnemyManager.canStand). */
  readonly canStand: (archetype: ImplementedEnemyId, at: Vector3) => boolean;
  /** Nothing solid between two points (LineTester.lineOfSight). */
  readonly lineOfSight: (from: Vector3, to: Vector3) => boolean;
  /** A body of `radius` can walk straight from `from` to `to` (LineTester.walkable). */
  readonly walkable: (from: Vector3, to: Vector3, radius: number) => boolean;
  readonly rng: Rng;
  readonly rules?: WaveRules;
}

export type SpawnPointStatus = 'eligible' | 'tooClose' | 'inView' | 'blocked' | 'reserved';

export interface SpawnPick {
  readonly point: SpawnPointDefinition;
  /** Feet positions, one per group member, in order. */
  readonly positions: readonly Vector3[];
  /** Picked with the view rule relaxed. */
  readonly relaxed: boolean;
}

/** Height above the point the player would have to see (a head). */
const HEAD_HEIGHT = 1.5;
/** Ring slots around a point, as fractions of a turn. */
const RING = [0, 1, 2, 3, 4, 5].map((k) => (k / 6) * Math.PI * 2);

const _head = new Vector3();
const _probe = new Vector3();

export class SpawnDirector {
  private readonly options: SpawnDirectorOptions;
  private readonly rules: WaveRules;
  private rng: Rng;
  private readonly recent: string[] = [];
  private readonly points: readonly SpawnPointDefinition[];

  constructor(options: SpawnDirectorOptions) {
    this.options = options;
    this.rules = options.rules ?? WAVE_RULES;
    this.rng = options.rng;
    this.points = options.points;
  }

  /** Every point the level declares (including reserved ones). */
  get all(): readonly SpawnPointDefinition[] {
    return this.points;
  }

  /** A new run: forget the recent points and draw from `rng`. */
  reset(rng: Rng): void {
    this.rng = rng;
    this.recent.length = 0;
  }

  /** Whether the player can see `point` from `viewer` (in the view cone and not behind a wall). */
  inView(point: SpawnPointDefinition, viewer: SpawnViewer): boolean {
    const [x, y, z] = point.position;
    const dx = x - viewer.eye.x;
    const dz = z - viewer.eye.z;
    // Direction the viewer faces: (−sin yaw, −cos yaw); angle to the point, horizontally.
    const facing = Math.atan2(-Math.sin(viewer.yaw), -Math.cos(viewer.yaw));
    let delta = Math.atan2(dx, dz) - facing;
    delta = Math.atan2(Math.sin(delta), Math.cos(delta));
    const half = ((viewer.fovDeg / 2 + this.rules.spawn.viewMarginDeg) * Math.PI) / 180;
    if (Math.abs(delta) > half) {
      return false;
    }
    return this.options.lineOfSight(viewer.eye, _head.set(x, y + HEAD_HEIGHT, z));
  }

  /** Why `point` can or cannot take a group of `archetype` now (debug view, tests). */
  status(
    point: SpawnPointDefinition,
    viewer: SpawnViewer,
    archetype: ImplementedEnemyId = 'tank',
    relaxView = false,
  ): SpawnPointStatus {
    if (point.tags?.includes('elevated')) {
      return 'reserved';
    }
    const [x, y, z] = point.position;
    if (Math.hypot(x - viewer.eye.x, z - viewer.eye.z) < this.rules.spawn.minDistance) {
      return 'tooClose';
    }
    if (!relaxView && this.inView(point, viewer)) {
      return 'inView';
    }
    return this.options.canStand(archetype, _probe.set(x, y, z)) ? 'eligible' : 'blocked';
  }

  /**
   * Chooses a point for `group` (archetypes in spawn order) and places each member around it, or
   * returns null when no point is eligible.
   */
  pick(
    group: readonly ImplementedEnemyId[],
    viewer: SpawnViewer,
    bias: readonly SpawnRegionId[] = [],
    relaxView = false,
  ): SpawnPick | null {
    const s = this.rules.spawn;
    const options: { point: SpawnPointDefinition; positions: Vector3[]; weight: number }[] = [];
    let total = 0;
    for (const point of this.points) {
      const lead = group[0] ?? 'walker';
      if (this.status(point, viewer, lead, relaxView) !== 'eligible') {
        continue;
      }
      const positions = this.place(point, group);
      if (!positions) {
        continue;
      }
      const [x, , z] = point.position;
      const d = Math.hypot(x - viewer.eye.x, z - viewer.eye.z);
      let weight =
        d < s.preferMin
          ? 0.4 + (0.6 * (d - s.minDistance)) / Math.max(1e-6, s.preferMin - s.minDistance)
          : d > s.preferMax
            ? Math.max(0.2, s.preferMax / d)
            : 1;
      if (this.recent.includes(point.id)) {
        weight *= s.repeatPenalty;
      }
      if (bias.includes(point.region)) {
        weight *= s.biasWeight;
      }
      options.push({ point, positions, weight });
      total += weight;
    }
    if (options.length === 0) {
      return null;
    }
    let r = this.rng.next() * total;
    let chosen = options[options.length - 1];
    for (const option of options) {
      r -= option.weight;
      if (r < 0) {
        chosen = option;
        break;
      }
    }
    if (!chosen) {
      return null;
    }
    this.recent.push(chosen.point.id);
    if (this.recent.length > s.repeatMemory) {
      this.recent.shift();
    }
    return { point: chosen.point, positions: chosen.positions, relaxed: relaxView };
  }

  /** Feet positions for each member: the point itself, then a ring around it (null if too few fit). */
  private place(
    point: SpawnPointDefinition,
    group: readonly ImplementedEnemyId[],
  ): Vector3[] | null {
    const [x, y, z] = point.position;
    const centre = new Vector3(x, y, z);
    const slots: Vector3[] = [centre];
    const spacing = this.rules.spawn.groupSpacing;
    for (const angle of RING) {
      slots.push(new Vector3(x + Math.cos(angle) * spacing, y, z + Math.sin(angle) * spacing));
    }
    const taken = new Set<number>();
    const positions: Vector3[] = [];
    for (const archetype of group) {
      let placed = false;
      for (let i = 0; i < slots.length; i++) {
        const slot = slots[i];
        if (!slot || taken.has(i) || !this.options.canStand(archetype, slot)) {
          continue;
        }
        // Members stand where they could walk from the point (no slot behind a thin wall).
        if (i > 0 && !this.options.walkable(centre, slot, 0.3)) {
          continue;
        }
        taken.add(i);
        positions.push(slot.clone());
        placed = true;
        break;
      }
      if (!placed) {
        return null;
      }
    }
    return positions;
  }
}
