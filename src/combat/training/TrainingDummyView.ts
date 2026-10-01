/**
 * Placeholder visuals for training dummies (D-030 blockout, D-041). Each dummy is drawn from its
 * hitbox rig's shapes, so what you see is where the hit volumes are; the rig itself stays in the
 * simulation and is never raycast from here (D-007). The zoned dummy paints each damage zone.
 *
 * Reactions (presentation only, driven by combat events): a white flash and a small push along the
 * shot on every hit, a bigger one on a stagger, a fall on death, standing up again on revive.
 *
 * Each dummy is one merged mesh (zone colours are vertex colours), so it costs one draw call plus
 * one shadow draw: with a mesh per shape, 24 dummies measured ~285 draw calls, over the Low budget
 * of 250 (TESTING §7.4). The merged geometry is shared by every dummy of the same look.
 */

import {
  CapsuleGeometry,
  Color,
  Float32BufferAttribute,
  Group,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  SphereGeometry,
  Vector3,
  type BufferGeometry,
  type Scene,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { HitboxRigDefinition, HitboxShape } from '../../config/combat';
import type { DamageZone } from '../../config/enemies';
import type { CombatSystem } from '../CombatSystem';
import type { TrainingDummy, TrainingRange } from './TrainingRange';

const PLAIN = 0xa88a5c;
/** Zone colours for the zoned dummy (none reads as the red of the signal beacon). */
const ZONE_COLORS: Readonly<Record<DamageZone, number>> = {
  HEAD: 0xf2d23c,
  TORSO: 0xdcdcd2,
  ARM_LEFT: 0x3fa7d6,
  ARM_RIGHT: 0x3fa7d6,
  LEG_LEFT: 0x5cb85c,
  LEG_RIGHT: 0x5cb85c,
};
const FLASH_TIME = 0.12;
const FALL_TIME = 0.45;
const _up = new Vector3(0, 1, 0);
const _axis = new Vector3();
const _q = new Quaternion();

interface DummyVisual {
  readonly dummy: TrainingDummy;
  readonly root: Group;
  /** Pivots at the feet: tilts for reactions and falls. */
  readonly body: Group;
  readonly material: MeshStandardMaterial;
  flash: number;
  /** Current push (radians about local x and z) and where the fall tips towards. */
  tiltX: number;
  tiltZ: number;
  fallX: number;
  fallZ: number;
  fall: number;
  dead: boolean;
}

export class TrainingDummyView {
  private readonly scene: Scene;
  private readonly range: TrainingRange;
  private readonly visuals = new Map<string, DummyVisual>();
  private readonly geometries = new Map<string, BufferGeometry>();
  private readonly unsubscribe: (() => void)[] = [];

  constructor(scene: Scene, range: TrainingRange, combat: CombatSystem) {
    this.scene = scene;
    this.range = range;
    this.unsubscribe.push(
      combat.events.on('damaged', (e) => {
        const v = this.visuals.get(e.targetId);
        if (v) {
          v.flash = FLASH_TIME;
          this.push(v, e.direction, Math.min(0.2, 0.03 + (e.amount / e.maxHealth) * 0.5));
        }
      }),
      combat.events.on('staggered', (e) => {
        const v = this.visuals.get(e.targetId);
        if (v) {
          this.push(v, e.direction, 0.3);
        }
      }),
      combat.events.on('killed', (e) => {
        const v = this.visuals.get(e.targetId);
        if (v) {
          const local = this.toLocal(v, e.direction);
          v.fallX = local.z;
          v.fallZ = -local.x;
          v.dead = true;
        }
      }),
      combat.events.on('revived', (e) => {
        const v = this.visuals.get(e.targetId);
        if (v) {
          v.dead = false;
          v.fall = 0;
          v.tiltX = 0;
          v.tiltZ = 0;
        }
      }),
    );
    this.sync();
  }

  /** Dummies currently drawn (tests, debug). */
  get count(): number {
    return this.visuals.size;
  }

  /** Whether a dummy is drawn lying down (tests, debug). */
  isDown(id: string): boolean {
    const v = this.visuals.get(id);
    return v ? v.fall >= 1 : false;
  }

  /** `dt`: simulated seconds this frame (0 while paused). */
  update(dt: number): void {
    this.sync();
    for (const v of this.visuals.values()) {
      v.flash = Math.max(0, v.flash - dt);
      v.material.emissiveIntensity = v.flash > 0 ? 0.55 : 0;
      const decay = Math.exp(-dt * 9);
      v.tiltX *= decay;
      v.tiltZ *= decay;
      if (v.dead) {
        v.fall = Math.min(1, v.fall + dt / FALL_TIME);
      }
      const f = v.fall * v.fall * (Math.PI / 2); // accelerating fall
      v.body.rotation.set(v.tiltX + v.fallX * f, 0, v.tiltZ + v.fallZ * f);
      const p = v.dummy.rig.position;
      v.root.position.set(p.x, p.y, p.z);
      v.root.rotation.y = v.dummy.rig.yaw;
    }
  }

  dispose(): void {
    for (const off of this.unsubscribe) {
      off();
    }
    for (const id of [...this.visuals.keys()]) {
      this.removeVisual(id);
    }
    for (const g of this.geometries.values()) {
      g.dispose();
    }
    this.geometries.clear();
  }

  /** Adds visuals for new dummies and removes those of dummies that are gone. */
  private sync(): void {
    const dummies = this.range.dummies;
    // Compared by object, not id: a reset re-creates dummies under the same ids.
    if (
      dummies.length === this.visuals.size &&
      dummies.every((d) => this.visuals.get(d.id)?.dummy === d)
    ) {
      return;
    }
    for (const [id, visual] of [...this.visuals]) {
      if (!dummies.includes(visual.dummy)) {
        this.removeVisual(id);
      }
    }
    for (const dummy of dummies) {
      if (!this.visuals.has(dummy.id)) {
        this.addVisual(dummy);
      }
    }
  }

  private addVisual(dummy: TrainingDummy): void {
    const root = new Group();
    root.name = `training-dummy:${dummy.id}`;
    const body = new Group();
    root.add(body);
    // Its own material, so its hit flash is its own; colours come from the shared geometry.
    const material = new MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.85,
      emissive: 0xffffff,
      emissiveIntensity: 0,
    });
    const mesh = new Mesh(
      this.geometry(dummy.rig.definition, dummy.definition.showZones),
      material,
    );
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = 'training-dummy-body';
    body.add(mesh);
    this.scene.add(root);
    this.visuals.set(dummy.id, {
      dummy,
      root,
      body,
      material,
      flash: 0,
      tiltX: 0,
      tiltZ: 0,
      fallX: -1,
      fallZ: 0,
      fall: dummy.health.isDead ? 1 : 0,
      dead: dummy.health.isDead,
    });
  }

  private removeVisual(id: string): void {
    const v = this.visuals.get(id);
    if (!v) {
      return;
    }
    v.root.removeFromParent();
    v.material.dispose();
    this.visuals.delete(id);
  }

  /**
   * One geometry per rig and look: every shape placed in the rig's local space and merged, each
   * vertex coloured by its zone (or plain). Shared by all dummies that look the same.
   */
  private geometry(rig: HitboxRigDefinition, zoned: boolean): BufferGeometry {
    const key = `${rig.id}:${zoned ? 'zoned' : 'plain'}`;
    const cached = this.geometries.get(key);
    if (cached) {
      return cached;
    }
    const parts = rig.shapes.map((shape) =>
      shapeGeometry(shape, zoned ? ZONE_COLORS[shape.zone] : PLAIN),
    );
    const merged = mergeGeometries(parts);
    for (const part of parts) {
      part.dispose();
    }
    this.geometries.set(key, merged);
    return merged;
  }

  /** A world direction in the dummy's local frame (only x and z matter here). */
  private toLocal(v: DummyVisual, direction: readonly number[]): Vector3 {
    _axis.set(direction[0] ?? 0, 0, direction[2] ?? 0);
    _q.setFromAxisAngle(_up, -v.dummy.rig.yaw);
    return _axis.applyQuaternion(_q);
  }

  /** Tips the top of the dummy along a direction by `amount` radians. */
  private push(v: DummyVisual, direction: readonly number[], amount: number): void {
    const local = this.toLocal(v, direction);
    // Rotating about +x moves the top towards +z; about +z moves it towards −x.
    v.tiltX += local.z * amount;
    v.tiltZ -= local.x * amount;
  }
}

/** One hit volume as coloured, placed geometry (local rig space). */
function shapeGeometry(shape: HitboxShape, color: number): BufferGeometry {
  let geometry: BufferGeometry;
  const m = new Matrix4();
  if (shape.kind === 'sphere') {
    geometry = new SphereGeometry(shape.radius, 16, 12);
    m.makeTranslation(shape.center[0], shape.center[1], shape.center[2]);
  } else {
    const a = new Vector3(...shape.a);
    const b = new Vector3(...shape.b);
    geometry = new CapsuleGeometry(shape.radius, a.distanceTo(b), 4, 12);
    const mid = a.clone().add(b).multiplyScalar(0.5);
    m.compose(
      mid,
      new Quaternion().setFromUnitVectors(_up, b.sub(a).normalize()),
      new Vector3(1, 1, 1),
    );
  }
  geometry.applyMatrix4(m);
  const c = new Color(color);
  const count = geometry.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  return geometry;
}
