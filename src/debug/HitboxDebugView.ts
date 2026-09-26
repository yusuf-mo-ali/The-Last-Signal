/**
 * Development-only hitbox visualiser (ARCHITECTURE §7.16, D-007 mitigation): draws every living
 * combat target's hit volumes as wireframes over the scene, straight from the simulation's rigs,
 * so a mismatch between what is drawn and what is hit is visible at a glance. HEAD volumes are
 * drawn gold, the rest cyan. Toggled with `tls.showHitboxes()`.
 */

import {
  CapsuleGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  SphereGeometry,
  Vector3,
  type BufferGeometry,
  type Scene,
} from 'three';
import type { CombatSystem } from '../combat/CombatSystem';

const _up = new Vector3(0, 1, 0);
const _a = new Vector3();
const _b = new Vector3();

export class HitboxDebugView {
  private readonly root = new Group();
  private readonly head = new MeshBasicMaterial({
    color: 0xffd23c,
    wireframe: true,
    depthTest: false,
  });
  private readonly body = new MeshBasicMaterial({
    color: 0x3fe0e0,
    wireframe: true,
    depthTest: false,
  });
  private readonly meshes: Mesh[] = [];
  private readonly geometries = new Map<string, BufferGeometry>();
  private readonly combat: CombatSystem;

  constructor(scene: Scene, combat: CombatSystem) {
    this.combat = combat;
    this.root.name = 'hitbox-debug';
    this.root.renderOrder = 20;
    scene.add(this.root);
  }

  /** Rebuilds the wireframes from the rigs' current positions (cheap: a few targets). */
  update(): void {
    let used = 0;
    for (const target of this.combat.targets) {
      if (target.health.isDead) {
        continue;
      }
      const rig = target.rig;
      for (const shape of rig.definition.shapes) {
        const mesh = this.mesh(used++);
        mesh.material = shape.zone === 'HEAD' ? this.head : this.body;
        if (shape.kind === 'sphere') {
          mesh.geometry = this.geometry(
            `s${shape.radius}`,
            () => new SphereGeometry(shape.radius, 10, 8),
          );
          rig.toWorld(shape.center, mesh.position);
          mesh.quaternion.identity();
        } else {
          rig.toWorld(shape.a, _a);
          rig.toWorld(shape.b, _b);
          const length = _a.distanceTo(_b);
          mesh.geometry = this.geometry(
            `c${shape.radius}:${length.toFixed(4)}`,
            () => new CapsuleGeometry(shape.radius, length, 3, 8),
          );
          mesh.position.copy(_a).add(_b).multiplyScalar(0.5);
          mesh.quaternion.setFromUnitVectors(_up, _b.sub(_a).normalize());
        }
        mesh.visible = true;
      }
    }
    for (let i = used; i < this.meshes.length; i++) {
      const mesh = this.meshes[i];
      if (mesh) {
        mesh.visible = false;
      }
    }
  }

  dispose(): void {
    this.root.removeFromParent();
    for (const g of this.geometries.values()) {
      g.dispose();
    }
    this.head.dispose();
    this.body.dispose();
  }

  private mesh(index: number): Mesh {
    let mesh = this.meshes[index];
    if (!mesh) {
      mesh = new Mesh(undefined, this.body);
      mesh.renderOrder = 20;
      mesh.frustumCulled = false;
      this.root.add(mesh);
      this.meshes.push(mesh);
    }
    return mesh;
  }

  private geometry(key: string, create: () => BufferGeometry): BufferGeometry {
    let geometry = this.geometries.get(key);
    if (!geometry) {
      geometry = create();
      this.geometries.set(key, geometry);
    }
    return geometry;
  }
}
