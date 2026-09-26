/**
 * Placeholder visuals for pickups (D-030, D-041): a small bobbing, turning ammo box per pickup.
 * Meshes come from a fixed pool (one per allowed pickup), so drops never allocate GPU resources.
 */

import { BoxGeometry, Mesh, MeshStandardMaterial, type Scene } from 'three';
import { PICKUP_RULES } from '../config/drops';
import type { PickupManager } from './PickupManager';

export class PickupView {
  private readonly manager: PickupManager;
  private readonly meshes: Mesh[] = [];
  private readonly geometry = new BoxGeometry(0.34, 0.2, 0.22);
  private readonly material = new MeshStandardMaterial({
    color: 0x7f9a3a,
    roughness: 0.6,
    emissive: 0x2c3a10,
  });
  private time = 0;

  constructor(scene: Scene, manager: PickupManager) {
    this.manager = manager;
    for (let i = 0; i < PICKUP_RULES.maxActive; i++) {
      const mesh = new Mesh(this.geometry, this.material);
      mesh.name = 'pickup';
      mesh.visible = false;
      mesh.castShadow = true;
      scene.add(mesh);
      this.meshes.push(mesh);
    }
  }

  /** Pickups drawn this frame (tests, debug). */
  get visibleCount(): number {
    return this.meshes.filter((m) => m.visible).length;
  }

  /** `dt`: simulated seconds this frame (0 while paused). */
  update(dt: number): void {
    this.time += dt;
    const pickups = this.manager.active;
    for (let i = 0; i < this.meshes.length; i++) {
      const mesh = this.meshes[i];
      const pickup = pickups[i];
      if (!mesh) {
        continue;
      }
      mesh.visible = pickup !== undefined;
      if (pickup) {
        const phase = this.time * 2 + pickup.id;
        mesh.position.set(
          pickup.position.x,
          pickup.position.y + 0.1 + Math.sin(phase * 1.5) * 0.06,
          pickup.position.z,
        );
        mesh.rotation.y = phase;
      }
    }
  }

  dispose(): void {
    for (const mesh of this.meshes) {
      mesh.removeFromParent();
    }
    this.geometry.dispose();
    this.material.dispose();
  }
}
