/**
 * Placeholder zombie visuals (D-030 blockout, D-042): each enemy is drawn from its own hitbox rig,
 * so what you see is where the hit volumes are (D-007). No final art or animation.
 *
 * - Silhouette: head, torso, legs and arms in one skinned mesh with two bones (the body, pivoting
 *   at the feet, and the arms, pivoting at the shoulders), so each enemy is one draw call plus one
 *   shadow draw (the D-041 rule: at 64 Walkers, a mesh for the body and one for the arms had
 *   measured 272 draw calls, over the Low budget of 250). Zone colours (pale head and arms, dark
 *   shirt and trousers) keep the hit zones readable; yellow eyes show where it faces.
 * - Movement: a shambling bob and sway while it walks; it turns to face its heading.
 * - Attack tell: during the wind-up the arms rise to reach forward (matching the attack pose of
 *   its rig) and the body glows orange, strongest just before the strike; the arms swing down on
 *   the strike.
 * - Hit reaction: a white flash and a push away from the hit; a stagger rocks it back further.
 * - Death: it falls, lies there, and sinks into the floor before its body is removed.
 *
 * Presentation only: it reads the `EnemyManager` and listens to combat and enemy events.
 * Positions are interpolated between fixed steps. Visuals and materials are pooled; geometry is
 * shared per archetype.
 */

import {
  Bone,
  CapsuleGeometry,
  Color,
  Float32BufferAttribute,
  Group,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  Skeleton,
  SkinnedMesh,
  Sphere,
  SphereGeometry,
  Uint16BufferAttribute,
  Vector3,
  type BufferGeometry,
  type Scene,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { CombatSystem } from '../combat/CombatSystem';
import type { HitboxShape, Point3 } from '../config/combat';
import {
  enemyConfig,
  IMPLEMENTED_ENEMY_IDS,
  type DamageZone,
  type EnemyArchetypeConfig,
} from '../config/enemies';
import type { Enemy } from './Enemy';
import type { EnemyManager } from './EnemyManager';

/** Zombie palette by zone (none reads as the red of the signal beacon). */
const ZONE_COLORS: Readonly<Record<DamageZone, number>> = {
  HEAD: 0x9db38a,
  TORSO: 0x5a5048,
  ARM_LEFT: 0x8aa07a,
  ARM_RIGHT: 0x8aa07a,
  LEG_LEFT: 0x3b4454,
  LEG_RIGHT: 0x3b4454,
};
const EYE_COLOR = 0xffe36b;
const FLASH_TIME = 0.1;
const FALL_TIME = 0.5;
/** Seconds before removal during which a body sinks into the floor. */
const SINK_TIME = 1;
/**
 * Arm angle about x when reaching forward at shoulder height: the rig's attack pose. A positive
 * angle swings a hanging arm forward (toward −z, where it faces).
 */
const REACH = 1.45;
/**
 * Culling sphere around the feet that holds the body in any pose, standing or lying down. The
 * skinned mesh's own sphere is taken from the pose of its first frame, which a fall leaves.
 */
const POSE_BOUNDS = new Sphere(new Vector3(0, 0.9, 0), 2.2);
const BODY_BONE = 0;
const ARMS_BONE = 1;
const _up = new Vector3(0, 1, 0);
const _dir = new Vector3();
const _q = new Quaternion();

interface Look {
  /** The whole body, skinned: body shapes to the body bone, arm shapes to the arms bone. */
  readonly geometry: BufferGeometry;
  readonly shoulder: Point3;
}

interface Visual {
  /** The enemy drawn; null while pooled. */
  enemy: Enemy | null;
  readonly config: EnemyArchetypeConfig;
  readonly root: Group;
  readonly skeleton: Skeleton;
  /** Pivots at the feet: tilts, lean and fall. */
  readonly body: Bone;
  /** Pivots at the shoulders. */
  readonly arms: Bone;
  readonly material: MeshStandardMaterial;
  flash: number;
  pushX: number;
  pushZ: number;
  walkPhase: number;
  arm: number;
  lean: number;
  fall: number;
}

export class EnemyView {
  private readonly scene: Scene;
  private readonly manager: EnemyManager;
  private readonly visuals = new Map<string, Visual>();
  private readonly free = new Map<string, Visual[]>();
  private readonly looks = new Map<string, Look>();
  private readonly unsubscribe: (() => void)[] = [];

  constructor(scene: Scene, manager: EnemyManager, combat: CombatSystem) {
    this.scene = scene;
    this.manager = manager;
    this.unsubscribe.push(
      combat.events.on('damaged', (e) => {
        const v = this.visuals.get(e.targetId);
        if (v) {
          v.flash = FLASH_TIME;
          this.push(v, e.direction, Math.min(0.18, 0.03 + (e.amount / e.maxHealth) * 0.4));
        }
      }),
      manager.events.on('staggered', ({ id }) => {
        const v = this.visuals.get(id);
        if (v) {
          v.lean = 0.35;
        }
      }),
    );
    // One pooled, hidden visual per archetype from the start: the start-up shader prewarm, which
    // includes hidden objects (D-041), then compiles the enemy materials before the first spawn.
    for (const id of IMPLEMENTED_ENEMY_IDS) {
      this.release(this.create(enemyConfig(id)));
    }
    this.sync();
  }

  /** Enemies currently drawn (tests, debug). */
  get count(): number {
    return this.visuals.size;
  }

  /** Whether an enemy is drawn lying down (tests, debug). */
  isDown(id: string): boolean {
    return (this.visuals.get(id)?.fall ?? 0) >= 1;
  }

  /** Attack glow of an enemy, 0–1 (tests, debug). */
  telegraph(id: string): number {
    const v = this.visuals.get(id);
    return v ? v.material.emissiveIntensity : 0;
  }

  /**
   * Once per frame. `alpha`: interpolation between the last two fixed steps; `dt`: simulated
   * seconds this frame (0 while paused, so everything holds still).
   */
  update(alpha: number, dt: number): void {
    this.sync();
    for (const v of this.visuals.values()) {
      this.animate(v, alpha, dt);
    }
  }

  dispose(): void {
    for (const off of this.unsubscribe) {
      off();
    }
    for (const v of this.visuals.values()) {
      this.destroy(v);
    }
    this.visuals.clear();
    for (const list of this.free.values()) {
      for (const v of list) {
        this.destroy(v);
      }
    }
    this.free.clear();
    for (const look of this.looks.values()) {
      look.geometry.dispose();
    }
    this.looks.clear();
  }

  private sync(): void {
    const enemies = this.manager.enemies;
    for (const [id, v] of this.visuals) {
      if (this.manager.get(id) !== v.enemy) {
        this.visuals.delete(id);
        this.release(v);
      }
    }
    for (const enemy of enemies) {
      if (!this.visuals.has(enemy.id)) {
        this.visuals.set(enemy.id, this.acquire(enemy));
      }
    }
  }

  private release(v: Visual): void {
    v.enemy = null;
    v.root.visible = false;
    const list = this.free.get(v.config.id) ?? [];
    list.push(v);
    this.free.set(v.config.id, list);
  }

  private acquire(enemy: Enemy): Visual {
    const reused = this.free.get(enemy.config.id)?.pop();
    const v = reused ?? this.create(enemy.config);
    v.enemy = enemy;
    v.root.name = `enemy:${enemy.id}`;
    v.root.visible = true;
    v.flash = 0;
    v.pushX = 0;
    v.pushZ = 0;
    v.walkPhase = enemy.spawnNumber * 1.7;
    v.arm = 0;
    v.lean = 0;
    v.fall = enemy.health.isDead ? 1 : 0;
    v.material.emissiveIntensity = 0;
    return v;
  }

  private create(config: EnemyArchetypeConfig): Visual {
    const look = this.lookFor(config);
    const material = new MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.9,
      emissive: 0xffffff,
      emissiveIntensity: 0,
    });
    const root = new Group();
    const body = new Bone();
    const arms = new Bone();
    arms.position.set(...look.shoulder);
    body.add(arms);
    const mesh = new SkinnedMesh(look.geometry, material);
    mesh.add(body);
    const skeleton = new Skeleton([body, arms]); // order: BODY_BONE, ARMS_BONE
    mesh.bind(skeleton); // bind pose: the rest pose, at the origin
    mesh.boundingSphere = POSE_BOUNDS.clone();
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    root.add(mesh);
    this.scene.add(root);
    return {
      enemy: null,
      config,
      root,
      skeleton,
      body,
      arms,
      material,
      flash: 0,
      pushX: 0,
      pushZ: 0,
      walkPhase: 0,
      arm: 0,
      lean: 0,
      fall: 0,
    };
  }

  private destroy(v: Visual): void {
    v.root.removeFromParent();
    v.skeleton.dispose();
    v.material.dispose();
  }

  private animate(v: Visual, alpha: number, dt: number): void {
    const { enemy, material } = v;
    if (!enemy) {
      return;
    }
    const motor = enemy.motor;
    // Position and facing, interpolated between the last two fixed steps.
    v.root.position.lerpVectors(motor.previousPosition, motor.position, alpha);
    let turn = enemy.heading - enemy.previousHeading;
    if (turn > Math.PI) {
      turn -= Math.PI * 2;
    } else if (turn < -Math.PI) {
      turn += Math.PI * 2;
    }
    v.root.rotation.y = enemy.previousHeading + turn * alpha;

    v.flash = Math.max(0, v.flash - dt);
    const decay = Math.exp(-dt * 8);
    v.pushX *= decay;
    v.pushZ *= decay;
    v.lean *= Math.exp(-dt * 5);

    // Arms: rest, reaching and rising through the wind-up, swinging down on the strike.
    let armTarget = 0;
    let telegraph = 0;
    let lean = 0;
    const attack = enemy.config.attack;
    if (enemy.state === 'ATTACK' && enemy.attackPhase === 'windup') {
      const progress = 1 - enemy.attackTimer / attack.windup;
      armTarget = REACH + 0.45 * progress;
      telegraph = 0.15 + 0.55 * progress * progress;
      lean = 0.12 * progress;
    } else if (enemy.state === 'ATTACK' && enemy.attackPhase === 'recovery') {
      armTarget = REACH - 0.5;
      lean = -0.18;
    } else if (enemy.state === 'STAGGER') {
      armTarget = 0.9;
    }
    v.arm += (armTarget - v.arm) * (1 - Math.exp(-dt * 14));

    // Walking: a shamble scaled by speed.
    const speed = Math.hypot(motor.velocity.x, motor.velocity.z);
    v.walkPhase += dt * speed * 3.2;
    const stride = Math.min(1, speed / Math.max(0.1, enemy.config.moveSpeed));
    const bob = Math.abs(Math.sin(v.walkPhase)) * 0.035 * stride;
    const sway = Math.sin(v.walkPhase) * 0.06 * stride;
    const swing = enemy.state === 'ATTACK' ? 0 : Math.sin(v.walkPhase) * 0.18 * stride;

    // Death: fall backward, then sink before removal.
    if (enemy.health.isDead) {
      v.fall = Math.min(1, v.fall + dt / FALL_TIME);
    } else {
      v.fall = 0;
    }
    const f = v.fall * v.fall * (Math.PI / 2);
    const sink = enemy.health.isDead ? Math.max(0, SINK_TIME - enemy.corpseTimer) * 0.45 : 0;

    v.body.position.set(0, bob - sink, 0);
    // Positive x tips the top backward: lean back, then fall on its back.
    v.body.rotation.set(lean + v.lean + v.pushX + f, 0, sway + v.pushZ);
    v.arms.rotation.set(v.arm + swing + 0.12, 0, 0);

    const glow = Math.max(v.flash > 0 ? 0.6 : 0, telegraph);
    material.emissive.setHex(v.flash > 0 ? 0xffffff : 0xff8c1a);
    material.emissiveIntensity = enemy.health.isDead ? 0 : glow;
  }

  /** Tips the top of the body along a world direction by `amount` radians. */
  private push(v: Visual, direction: readonly number[], amount: number): void {
    _dir.set(direction[0] ?? 0, 0, direction[2] ?? 0);
    _q.setFromAxisAngle(_up, -(v.enemy?.heading ?? 0));
    _dir.applyQuaternion(_q);
    v.pushX += _dir.z * amount;
    v.pushZ -= _dir.x * amount;
  }

  /** Shared geometry per archetype: body (head, torso, legs, eyes) and arms (shoulder pivot). */
  private lookFor(config: EnemyArchetypeConfig): Look {
    const cached = this.looks.get(config.id);
    if (cached) {
      return cached;
    }
    const parts: BufferGeometry[] = [];
    let shoulder: Point3 = [0, 1.42, 0];
    let head: HitboxShape | undefined;
    for (const shape of config.rig.shapes) {
      if (shape.zone === 'ARM_LEFT' || shape.zone === 'ARM_RIGHT') {
        if (shape.kind === 'capsule') {
          shoulder = [0, shape.a[1], shape.a[2]];
        }
        parts.push(skin(shapeGeometry(shape, ZONE_COLORS[shape.zone]), ARMS_BONE));
      } else {
        parts.push(skin(shapeGeometry(shape, ZONE_COLORS[shape.zone]), BODY_BONE));
        if (shape.zone === 'HEAD') {
          head = shape;
        }
      }
    }
    if (head?.kind === 'sphere') {
      // Eyes on the front (−z) of the head.
      for (const side of [-1, 1]) {
        const eye = new SphereGeometry(0.022, 6, 4);
        eye.translate(
          head.center[0] + side * 0.045,
          head.center[1] + 0.015,
          head.center[2] - head.radius * 0.93,
        );
        colorize(eye, EYE_COLOR);
        parts.push(skin(eye, BODY_BONE));
      }
    }
    const geometry = mergeGeometries(parts);
    for (const part of parts) {
      part.dispose();
    }
    const look = { geometry, shoulder };
    this.looks.set(config.id, look);
    return look;
  }
}

function shapeGeometry(shape: HitboxShape, color: number): BufferGeometry {
  let geometry: BufferGeometry;
  const m = new Matrix4();
  if (shape.kind === 'sphere') {
    geometry = new SphereGeometry(shape.radius, 14, 10);
    m.makeTranslation(shape.center[0], shape.center[1], shape.center[2]);
  } else {
    const a = new Vector3(...shape.a);
    const b = new Vector3(...shape.b);
    geometry = new CapsuleGeometry(shape.radius, a.distanceTo(b), 4, 10);
    const mid = a.clone().add(b).multiplyScalar(0.5);
    m.compose(
      mid,
      new Quaternion().setFromUnitVectors(_up, b.sub(a).normalize()),
      new Vector3(1, 1, 1),
    );
  }
  geometry.applyMatrix4(m);
  colorize(geometry, color);
  return geometry;
}

/** Binds every vertex of `geometry` fully to one bone. */
function skin(geometry: BufferGeometry, bone: number): BufferGeometry {
  const count = geometry.getAttribute('position').count;
  const indices = new Uint16Array(count * 4);
  const weights = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    indices[i * 4] = bone;
    weights[i * 4] = 1;
  }
  geometry.setAttribute('skinIndex', new Uint16BufferAttribute(indices, 4));
  geometry.setAttribute('skinWeight', new Float32BufferAttribute(weights, 4));
  return geometry;
}

function colorize(geometry: BufferGeometry, color: number): void {
  const c = new Color(color);
  const count = geometry.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
}
