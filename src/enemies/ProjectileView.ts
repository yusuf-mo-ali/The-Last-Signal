/**
 * The Spitter's acid on screen (D-046): a glowing green blob, stretched along its flight so its
 * path reads at a glance, and a splat that spreads and fades where it lands. Presentation only:
 * it draws `EnemyProjectiles.slots`, interpolated between fixed steps, and listens to impacts.
 *
 * Everything is pooled and created at load (one blob per projectile slot, a few splats), with
 * unlit additive materials: no lights, no shader compiled mid-fight (D-022).
 */

import {
  AdditiveBlending,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  RingGeometry,
  SphereGeometry,
  Vector3,
  type Scene,
} from 'three';
import type { EnemyProjectiles } from './EnemyProjectiles';

const ACID = 0x9dff3a;
const SPLAT_POOL = 8;
const SPLAT_TIME = 0.5;
/** How far the blob stretches along its flight per m/s (a short trail). */
const STRETCH_PER_SPEED = 0.2;

const _forward = new Vector3(0, 0, 1);
const _dir = new Vector3();
const _q = new Quaternion();

interface Splat {
  readonly mesh: Mesh;
  readonly material: MeshBasicMaterial;
  age: number;
}

export class ProjectileView {
  private readonly projectiles: EnemyProjectiles;
  private readonly blobs: Mesh[] = [];
  private readonly splats: Splat[] = [];
  private readonly blobGeometry = new SphereGeometry(1, 10, 8);
  private readonly blobMaterial = new MeshBasicMaterial({
    color: ACID,
    transparent: true,
    opacity: 0.9,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  private readonly splatGeometry = new RingGeometry(0.15, 1, 24);
  private readonly unsubscribe: () => void;

  constructor(scene: Scene, projectiles: EnemyProjectiles) {
    this.projectiles = projectiles;
    this.splatGeometry.rotateX(-Math.PI / 2);
    for (const _slot of projectiles.slots) {
      const mesh = new Mesh(this.blobGeometry, this.blobMaterial);
      mesh.name = 'acid';
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = 9;
      scene.add(mesh);
      this.blobs.push(mesh);
    }
    for (let i = 0; i < SPLAT_POOL; i++) {
      const material = new MeshBasicMaterial({
        color: ACID,
        transparent: true,
        opacity: 0,
        blending: AdditiveBlending,
        depthWrite: false,
        side: DoubleSide,
      });
      const mesh = new Mesh(this.splatGeometry, material);
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = 9;
      scene.add(mesh);
      this.splats.push({ mesh, material, age: SPLAT_TIME });
    }
    this.unsubscribe = projectiles.events.on('projectileImpact', (e) => {
      if (e.kind !== 'expired') {
        this.splat(e.position);
      }
    });
  }

  /** Acid blobs drawn this frame (tests, debug). */
  get visibleCount(): number {
    return this.blobs.filter((m) => m.visible).length;
  }

  /** Splats showing (tests, debug). */
  get activeSplats(): number {
    return this.splats.filter((s) => s.age < SPLAT_TIME).length;
  }

  /** `alpha`: interpolation between the last two fixed steps; `dt`: simulated seconds. */
  update(alpha: number, dt: number): void {
    const slots = this.projectiles.slots;
    for (let i = 0; i < this.blobs.length; i++) {
      const mesh = this.blobs[i];
      const slot = slots[i];
      if (!mesh) {
        continue;
      }
      mesh.visible = slot?.active === true;
      if (!slot?.active) {
        continue;
      }
      mesh.position.lerpVectors(slot.previous, slot.position, alpha);
      const speed = slot.velocity.length();
      const r = slot.params.radius;
      if (speed > 1e-6) {
        _dir.copy(slot.velocity).divideScalar(speed);
        mesh.quaternion.copy(_q.setFromUnitVectors(_forward, _dir));
      }
      mesh.scale.set(r, r, r * (1 + speed * STRETCH_PER_SPEED));
    }
    for (const s of this.splats) {
      if (s.age >= SPLAT_TIME) {
        continue;
      }
      s.age += dt;
      const t = Math.min(1, s.age / SPLAT_TIME);
      const size = 0.4 + 1.2 * Math.sqrt(t);
      s.mesh.scale.set(size, 1, size);
      s.material.opacity = 0.7 * (1 - t);
      s.mesh.visible = t < 1;
    }
  }

  dispose(): void {
    this.unsubscribe();
    for (const mesh of this.blobs) {
      mesh.removeFromParent();
    }
    for (const s of this.splats) {
      s.mesh.removeFromParent();
      s.material.dispose();
    }
    this.blobGeometry.dispose();
    this.blobMaterial.dispose();
    this.splatGeometry.dispose();
  }

  private splat(position: readonly number[]): void {
    const s =
      this.splats.find((x) => x.age >= SPLAT_TIME) ??
      this.splats.reduce((oldest, x) => (x.age > oldest.age ? x : oldest));
    s.age = 0;
    s.mesh.position.set(position[0] ?? 0, (position[1] ?? 0) + 0.05, position[2] ?? 0);
    s.mesh.scale.set(0.4, 1, 0.4);
    s.material.opacity = 0.7;
    s.mesh.visible = true;
  }
}
