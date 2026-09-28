/**
 * Development-only spawn point visualiser (D-044): a ring on the ground at every authored spawn
 * point, coloured by whether a wave group could enter there right now: green = eligible, red = the
 * player could see it, orange = too close, grey = no room for a body, violet = reserved (elevated,
 * never used by normal waves). Toggled with `tls.showSpawns()`. Reads the simulation; never changes
 * it.
 */

import {
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineLoop,
  type Scene,
} from 'three';
import type { SpawnDirector, SpawnPointStatus, SpawnViewer } from '../waves/SpawnDirector';

const RING_SEGMENTS = 32;
const RING_RADIUS = 0.9;

const COLORS: Readonly<Record<SpawnPointStatus, number>> = {
  eligible: 0x5ce65c,
  inView: 0xff4040,
  tooClose: 0xff8c1a,
  blocked: 0x9aa0a6,
  reserved: 0xb46cff,
};

export class SpawnDebugView {
  private readonly root = new Group();
  private readonly ring: BufferGeometry;
  private readonly materials: Record<SpawnPointStatus, LineBasicMaterial>;
  private readonly rings: LineLoop[] = [];
  private readonly spawns: SpawnDirector;
  private current: SpawnPointStatus[] = [];

  constructor(scene: Scene, spawns: SpawnDirector) {
    this.spawns = spawns;
    this.root.name = 'spawn-debug';
    scene.add(this.root);
    const points: number[] = [];
    for (let i = 0; i < RING_SEGMENTS; i++) {
      const a = (i / RING_SEGMENTS) * Math.PI * 2;
      points.push(Math.cos(a) * RING_RADIUS, 0.06, Math.sin(a) * RING_RADIUS);
    }
    this.ring = new BufferGeometry();
    this.ring.setAttribute('position', new Float32BufferAttribute(points, 3));
    this.materials = {
      eligible: new LineBasicMaterial({ color: COLORS.eligible, depthTest: false }),
      inView: new LineBasicMaterial({ color: COLORS.inView, depthTest: false }),
      tooClose: new LineBasicMaterial({ color: COLORS.tooClose, depthTest: false }),
      blocked: new LineBasicMaterial({ color: COLORS.blocked, depthTest: false }),
      reserved: new LineBasicMaterial({ color: COLORS.reserved, depthTest: false }),
    };
    for (const point of spawns.all) {
      const ring = new LineLoop(this.ring, this.materials.eligible);
      ring.name = `spawn:${point.id}`;
      ring.position.set(...point.position);
      ring.renderOrder = 10;
      this.rings.push(ring);
      this.root.add(ring);
    }
  }

  /** Each point's status at the last update, in level order (tests, `tls.spawnPoints()`). */
  get statuses(): readonly SpawnPointStatus[] {
    return this.current;
  }

  update(viewer: SpawnViewer): void {
    this.current = this.spawns.all.map((point) => this.spawns.status(point, viewer));
    this.current.forEach((status, i) => {
      const ring = this.rings[i];
      if (ring) {
        ring.material = this.materials[status];
      }
    });
  }

  dispose(): void {
    this.root.removeFromParent();
    this.ring.dispose();
    for (const material of Object.values(this.materials)) {
      material.dispose();
    }
  }
}
