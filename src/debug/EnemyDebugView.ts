/**
 * Development-only AI visualiser (D-042): for every enemy, its state and health as a label over
 * its head, its detection range (yellow ring) and attack range (orange ring) on the ground, a
 * line to its target (green while it sees it, grey from memory) and the route it is following
 * (cyan). Toggled with `tls.showAI()`. Reads the simulation; never changes it.
 */

import {
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Line,
  LineBasicMaterial,
  LineLoop,
  Vector3,
  type Camera,
  type Scene,
} from 'three';
import type { Enemy } from '../enemies/Enemy';
import type { EnemyManager } from '../enemies/EnemyManager';

const RING_SEGMENTS = 48;
const _p = new Vector3();

interface Marker {
  readonly group: Group;
  readonly detection: LineLoop;
  readonly attack: LineLoop;
  readonly toTarget: Line;
  readonly route: Line;
  readonly label: HTMLElement;
}

export class EnemyDebugView {
  private readonly root = new Group();
  private readonly layer: HTMLElement;
  private readonly markers = new Map<string, Marker>();
  private readonly ring: BufferGeometry;
  private readonly materials = {
    detection: new LineBasicMaterial({ color: 0xffd23c, depthTest: false }),
    attack: new LineBasicMaterial({ color: 0xff8c1a, depthTest: false }),
    seen: new LineBasicMaterial({ color: 0x5ce65c, depthTest: false }),
    remembered: new LineBasicMaterial({ color: 0x9aa0a6, depthTest: false }),
    route: new LineBasicMaterial({ color: 0x3fe0e0, depthTest: false }),
  };
  private readonly manager: EnemyManager;

  constructor(scene: Scene, container: HTMLElement, manager: EnemyManager) {
    this.manager = manager;
    this.root.name = 'enemy-debug';
    scene.add(this.root);
    this.layer = container.ownerDocument.createElement('div');
    this.layer.className = 'enemy-debug';
    container.appendChild(this.layer);
    const points: number[] = [];
    for (let i = 0; i < RING_SEGMENTS; i++) {
      const a = (i / RING_SEGMENTS) * Math.PI * 2;
      points.push(Math.cos(a), 0.05, Math.sin(a));
    }
    this.ring = new BufferGeometry();
    this.ring.setAttribute('position', new Float32BufferAttribute(points, 3));
  }

  /** Labels currently shown (tests). */
  get labels(): readonly string[] {
    return [...this.markers.values()].map((m) => m.label.textContent);
  }

  update(camera: Camera): void {
    const seen = new Set<string>();
    const width = this.layer.clientWidth;
    const height = this.layer.clientHeight;
    for (const enemy of this.manager.enemies) {
      seen.add(enemy.id);
      const marker = this.markers.get(enemy.id) ?? this.create(enemy.id);
      this.place(marker, enemy);
      // Label above the head.
      _p.copy(enemy.motor.position);
      _p.y += enemy.config.body.height + 0.35;
      _p.project(camera);
      const onScreen = _p.z < 1 && Math.abs(_p.x) <= 1.1 && Math.abs(_p.y) <= 1.1;
      marker.label.hidden = !onScreen;
      marker.label.dataset.state = enemy.state;
      marker.label.textContent = `${enemy.id} ${enemy.state} ${Math.ceil(enemy.health.current)}`;
      if (onScreen) {
        const x = ((_p.x + 1) / 2) * width;
        const y = ((1 - _p.y) / 2) * height;
        marker.label.style.transform = `translate(${x.toFixed(0)}px, ${y.toFixed(0)}px) translate(-50%, -100%)`;
      }
    }
    for (const [id, marker] of this.markers) {
      if (!seen.has(id)) {
        marker.group.removeFromParent();
        marker.toTarget.geometry.dispose();
        marker.route.geometry.dispose();
        marker.label.remove();
        this.markers.delete(id);
      }
    }
  }

  dispose(): void {
    for (const marker of this.markers.values()) {
      marker.toTarget.geometry.dispose();
      marker.route.geometry.dispose();
    }
    this.markers.clear();
    this.root.removeFromParent();
    this.layer.remove();
    this.ring.dispose();
    for (const material of Object.values(this.materials)) {
      material.dispose();
    }
  }

  private create(id: string): Marker {
    const group = new Group();
    const detection = new LineLoop(this.ring, this.materials.detection);
    const attack = new LineLoop(this.ring, this.materials.attack);
    const toTarget = new Line(new BufferGeometry(), this.materials.seen);
    const route = new Line(new BufferGeometry(), this.materials.route);
    for (const line of [detection, attack, toTarget, route]) {
      line.frustumCulled = false;
      line.renderOrder = 20;
    }
    group.add(detection, attack, toTarget, route);
    this.root.add(group);
    const label = this.layer.ownerDocument.createElement('span');
    label.className = 'enemy-debug__label';
    this.layer.appendChild(label);
    const marker = { group, detection, attack, toTarget, route, label };
    this.markers.set(id, marker);
    return marker;
  }

  private place(marker: Marker, enemy: Enemy): void {
    const p = enemy.motor.position;
    const alive = enemy.health.isAlive;
    for (const [ring, radius] of [
      [marker.detection, enemy.config.detectionRange],
      [marker.attack, enemy.config.attackRange],
    ] as const) {
      ring.visible = alive;
      ring.position.copy(p);
      ring.scale.set(radius, 1, radius);
    }
    const target = alive ? enemy.target : null;
    marker.toTarget.visible = target !== null;
    if (target) {
      marker.toTarget.material = enemy.canSeeTarget
        ? this.materials.seen
        : this.materials.remembered;
      setPoints(marker.toTarget.geometry, [
        p.x,
        p.y + enemy.config.body.eyeHeight,
        p.z,
        target.position.x,
        target.position.y + target.eyeHeight,
        target.position.z,
      ]);
    }
    const routes = this.manager.routes;
    const route = enemy.navMode === 'route' && routes ? enemy.route.slice(enemy.routeCursor) : [];
    marker.route.visible = alive && route.length > 0;
    if (marker.route.visible && routes) {
      const points = [p.x, p.y + 0.1, p.z];
      for (const node of route) {
        const at = routes.position(node);
        points.push(at.x, at.y + 0.1, at.z);
      }
      setPoints(marker.route.geometry, points);
    }
  }
}

function setPoints(geometry: BufferGeometry, points: number[]): void {
  geometry.setAttribute('position', new Float32BufferAttribute(points, 3));
  geometry.computeBoundingSphere();
}
