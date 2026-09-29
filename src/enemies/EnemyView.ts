/**
 * Placeholder zombie visuals (D-030 blockout, D-042, D-043): each enemy is drawn from its own
 * hitbox rig, so what you see is where the hit volumes are (D-007). No final art or animation.
 *
 * - Silhouette: head, torso, legs and arms in one skinned mesh with two bones (the body, pivoting
 *   at the feet, and the arms, pivoting at the shoulders), so each enemy is one draw call plus one
 *   shadow draw (the D-041 rule: at 64 Walkers, a mesh for the body and one for the arms had
 *   measured 272 draw calls, over the Low budget of 250). The rig gives each archetype its build
 *   (the Runner slighter, the Tank huge, the Screamer tall with a big head); `config/enemyLooks`
 *   its palette by zone, eyes, lean and features (the Screamer's gaping mouth).
 * - Traits change the outline, not just the colour: plates on the chest, back and shoulders
 *   (Armored), a steel dome on the head that is gone once the helmet breaks (Helmeted), bone
 *   spikes on the shoulders and spine and pale hot eyes (Elite). They are built into the same
 *   mesh: geometry is cached per archetype and set of visible attachments.
 * - Movement: a shamble scaled by speed; it turns to face its heading.
 * - Attack tell: during the wind-up the arms rise (reaching forward for a strike, overhead for a
 *   scream, matching the rig's attack pose) and the body glows in its archetype's telegraph
 *   colour, strongest just before the strike; a leap throws the body forward. A scream sends out
 *   an expanding ring as far as it carries.
 * - Hit reaction: a white flash and a push away from the hit; a stagger rocks it back further.
 * - Death: it falls, lies there, and sinks into the floor before its body is removed.
 *
 * Presentation only: it reads the `EnemyManager` and listens to combat and enemy events.
 * Positions are interpolated between fixed steps. Visuals and materials are pooled per archetype.
 */

import {
  AdditiveBlending,
  Bone,
  BoxGeometry,
  CapsuleGeometry,
  CircleGeometry,
  Color,
  ConeGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Quaternion,
  RingGeometry,
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
  ELITE_EYES,
  ENEMY_LOOKS,
  REACH_ARMS,
  TRAIT_LOOKS,
  type EnemyLook,
} from '../config/enemyLooks';
import {
  enemyConfig,
  IMPLEMENTED_ENEMY_IDS,
  type EnemyArchetypeConfig,
  type EnemyArchetypeId,
  type EnemyModifierId,
} from '../config/enemies';
import type { Enemy } from './Enemy';
import type { EnemyManager } from './EnemyManager';

const FLASH_TIME = 0.1;
const FALL_TIME = 0.5;
/** Seconds before removal during which a body sinks into the floor. */
const SINK_TIME = 1;
/** Seconds a scream's ring takes to reach its full radius and fade. */
const RING_TIME = 0.7;
/** A Screamer's scream (violet) and a DEATH CRY (red, D-045) look different at a glance. */
const SCREAM_RING_COLOR = 0xb46cff;
const DEATH_CRY_RING_COLOR = 0xff3b30;
const RING_POOL = 4;
/**
 * Culling sphere around the feet that holds the body in any pose, standing or lying down. The
 * skinned mesh's own sphere is taken from the pose of its first frame, which a fall leaves.
 */
const POSE_BOUNDS = new Sphere(new Vector3(0, 1, 0), 2.6);
const BODY_BONE = 0;
const ARMS_BONE = 1;
/** Bits of a look key: which attachments are drawn. */
const ARMOR_BIT = 1;
const HELMET_BIT = 2;
const ELITE_BIT = 4;
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
  /** Attack (or hit) glow this frame, 0–1. */
  glow: number;
  readonly config: EnemyArchetypeConfig;
  readonly look: EnemyLook;
  readonly root: Group;
  readonly mesh: SkinnedMesh;
  readonly skeleton: Skeleton;
  /** Pivots at the feet: tilts, lean and fall. */
  readonly body: Bone;
  /** Pivots at the shoulders. */
  readonly arms: Bone;
  readonly material: MeshStandardMaterial;
  /** Which attachments its geometry has (look key bits). */
  lookBits: number;
  flash: number;
  pushX: number;
  pushZ: number;
  walkPhase: number;
  arm: number;
  lean: number;
  fall: number;
}

interface Ring {
  readonly mesh: Mesh;
  readonly material: MeshBasicMaterial;
  age: number;
  radius: number;
}

function lookOf(config: EnemyArchetypeConfig): EnemyLook {
  const look = ENEMY_LOOKS[config.id] ?? ENEMY_LOOKS.walker;
  if (!look) {
    throw new Error('The Walker look is missing');
  }
  return look;
}

export class EnemyView {
  /**
   * Baseline glow of living enemies in their eye colour when not telegraphing (0 normally; the
   * environment's `eyeshine` in the dark, D-045). Set every frame by the composition root.
   */
  eyeshine = 0;
  private readonly scene: Scene;
  private readonly manager: EnemyManager;
  private readonly visuals = new Map<string, Visual>();
  private readonly free = new Map<string, Visual[]>();
  private readonly looks = new Map<string, Look>();
  private readonly rings: Ring[] = [];
  private readonly ringGeometry = new RingGeometry(0.9, 1, 48);
  private readonly unsubscribe: (() => void)[] = [];

  constructor(scene: Scene, manager: EnemyManager, combat: CombatSystem) {
    this.scene = scene;
    this.manager = manager;
    this.ringGeometry.rotateX(-Math.PI / 2);
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
      manager.events.on('alarm', (alarm) => {
        this.startRing(
          alarm.position,
          alarm.radius,
          alarm.kind === 'deathCry' ? DEATH_CRY_RING_COLOR : SCREAM_RING_COLOR,
        );
      }),
    );
    // One pooled, hidden visual per archetype from the start: the start-up shader prewarm, which
    // includes hidden objects (D-041), then compiles the enemy materials before the first spawn.
    for (const id of IMPLEMENTED_ENEMY_IDS) {
      this.release(this.create(enemyConfig(id)));
    }
    for (let i = 0; i < RING_POOL; i++) {
      const material = new MeshBasicMaterial({
        color: SCREAM_RING_COLOR,
        transparent: true,
        opacity: 0,
        blending: AdditiveBlending,
        depthWrite: false,
        side: DoubleSide,
      });
      const mesh = new Mesh(this.ringGeometry, material);
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = 10;
      this.scene.add(mesh);
      this.rings.push({ mesh, material, age: RING_TIME, radius: 0 });
    }
    this.sync();
  }

  /** Enemies currently drawn (tests, debug). */
  get count(): number {
    return this.visuals.size;
  }

  /** Scream rings currently expanding (tests, debug). */
  get activeRings(): number {
    return this.rings.filter((r) => r.age < RING_TIME).length;
  }

  /** Colours of the alarm rings currently expanding (tests, debug): violet scream, red death cry. */
  get activeRingColors(): number[] {
    return this.rings.filter((r) => r.age < RING_TIME).map((r) => r.material.color.getHex());
  }

  /** Whether an enemy is drawn lying down (tests, debug). */
  isDown(id: string): boolean {
    return (this.visuals.get(id)?.fall ?? 0) >= 1;
  }

  /** Attack glow of an enemy, 0–1 (tests, debug). */
  telegraph(id: string): number {
    return this.visuals.get(id)?.glow ?? 0;
  }

  /** The attachments an enemy is drawn with (tests, debug). */
  attachments(id: string): string[] {
    const bits = this.visuals.get(id)?.lookBits ?? 0;
    return [
      ...(bits & ARMOR_BIT ? ['plates'] : []),
      ...(bits & HELMET_BIT ? ['helmet'] : []),
      ...(bits & ELITE_BIT ? ['spikes'] : []),
    ];
  }

  /**
   * Builds the looks a coming wave needs (archetype × visible attachments, a broken helmet
   * included), so no geometry is merged mid-fight (D-044). Returns how many were new.
   */
  prewarm(
    spawns: readonly {
      readonly archetype: EnemyArchetypeId;
      readonly traits: readonly EnemyModifierId[];
    }[],
  ): number {
    let built = 0;
    for (const s of spawns) {
      const base =
        (s.traits.includes('armored') ? ARMOR_BIT : 0) |
        (s.traits.includes('elite') ? ELITE_BIT : 0);
      const variants = s.traits.includes('helmeted') ? [base | HELMET_BIT, base] : [base];
      for (const bits of variants) {
        if (!this.looks.has(`${s.archetype}:${bits}`)) {
          this.lookFor(enemyConfig(s.archetype), bits);
          built++;
        }
      }
    }
    return built;
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
    for (const ring of this.rings) {
      if (ring.age >= RING_TIME) {
        continue;
      }
      ring.age += dt;
      const t = Math.min(1, ring.age / RING_TIME);
      const r = Math.max(0.5, ring.radius * (1 - (1 - t) * (1 - t)));
      ring.mesh.scale.set(r, 1, r);
      ring.material.opacity = 0.8 * (1 - t);
      ring.mesh.visible = t < 1;
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
    for (const ring of this.rings) {
      ring.mesh.removeFromParent();
      ring.material.dispose();
    }
    this.ringGeometry.dispose();
  }

  private startRing(position: readonly number[], radius: number, color: number): void {
    const ring =
      this.rings.find((r) => r.age >= RING_TIME) ??
      this.rings.reduce((oldest, r) => (r.age > oldest.age ? r : oldest));
    ring.age = 0;
    ring.radius = radius;
    ring.material.color.setHex(color);
    ring.mesh.position.set(position[0] ?? 0, (position[1] ?? 0) + 0.08, position[2] ?? 0);
    ring.mesh.scale.set(0.5, 1, 0.5);
    ring.mesh.visible = true;
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
    const reused = this.free.get(enemy.archetype.id)?.pop();
    const v = reused ?? this.create(enemy.archetype);
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
    this.applyLook(v, enemy);
    return v;
  }

  private create(config: EnemyArchetypeConfig): Visual {
    const look = this.lookFor(config, 0);
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
      look: lookOf(config),
      root,
      mesh,
      skeleton,
      body,
      arms,
      material,
      lookBits: 0,
      flash: 0,
      glow: 0,
      pushX: 0,
      pushZ: 0,
      walkPhase: 0,
      arm: 0,
      lean: 0,
      fall: 0,
    };
  }

  /** Swaps in the geometry for the enemy's current attachments (traits, an intact helmet). */
  private applyLook(v: Visual, enemy: Enemy): void {
    const traits = enemy.config.traits;
    const helmet = enemy.plates.find((plate) => plate.id === 'helmet');
    const bits =
      (traits.includes('armored') ? ARMOR_BIT : 0) |
      (traits.includes('helmeted') && helmet && !helmet.broken ? HELMET_BIT : 0) |
      (traits.includes('elite') ? ELITE_BIT : 0);
    if (bits !== v.lookBits || v.mesh.geometry !== this.lookFor(v.config, bits).geometry) {
      v.lookBits = bits;
      v.mesh.geometry = this.lookFor(v.config, bits).geometry;
    }
  }

  private destroy(v: Visual): void {
    v.root.removeFromParent();
    v.skeleton.dispose();
    v.material.dispose();
  }

  private animate(v: Visual, alpha: number, dt: number): void {
    const { enemy, material, look } = v;
    if (!enemy) {
      return;
    }
    this.applyLook(v, enemy);
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

    // Arms: rest, rising through the wind-up (forward to strike, overhead to scream), swinging
    // down on the strike. The body leans into a strike, throws itself forward in a leap and rears
    // back to scream.
    let armTarget = 0;
    let telegraph = 0;
    let lean = 0;
    const attack = enemy.config.attack;
    const raised = look.windupArms > REACH_ARMS + 0.01;
    if (enemy.state === 'ATTACK' && enemy.attackPhase === 'windup') {
      const progress = 1 - enemy.attackTimer / attack.windup;
      armTarget = look.windupArms + (raised ? 0 : 0.45 * progress);
      telegraph = 0.15 + 0.55 * progress * progress;
      lean += (raised ? 0.18 : 0.12) * progress;
    } else if (enemy.state === 'ATTACK' && enemy.attackPhase === 'lunge') {
      armTarget = REACH_ARMS;
      telegraph = 0.7;
      lean -= 0.35;
    } else if (enemy.state === 'ATTACK' && enemy.attackPhase === 'recovery') {
      armTarget = raised ? look.windupArms * 0.6 : REACH_ARMS - 0.5;
      lean += raised ? 0.05 : -0.18;
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

    const glow = enemy.health.isDead ? 0 : Math.max(v.flash > 0 ? 0.6 : 0, telegraph);
    v.glow = glow;
    if (glow > 0) {
      material.emissive.setHex(v.flash > 0 ? 0xffffff : look.telegraph);
      material.emissiveIntensity = glow;
    } else if (this.eyeshine > 0 && !enemy.health.isDead) {
      // In the dark (BLACKOUT, D-045) a faint glow in its eye colour keeps the silhouette readable.
      material.emissive.setHex(look.eyes);
      material.emissiveIntensity = this.eyeshine;
    } else {
      material.emissiveIntensity = 0;
    }
  }

  /** Tips the top of the body along a world direction by `amount` radians. */
  private push(v: Visual, direction: readonly number[], amount: number): void {
    _dir.set(direction[0] ?? 0, 0, direction[2] ?? 0);
    _q.setFromAxisAngle(_up, -(v.enemy?.heading ?? 0));
    _dir.applyQuaternion(_q);
    v.pushX += _dir.z * amount;
    v.pushZ -= _dir.x * amount;
  }

  /** Shared geometry per archetype and set of attachments. */
  private lookFor(config: EnemyArchetypeConfig, bits: number): Look {
    const key = `${config.id}:${bits}`;
    const cached = this.looks.get(key);
    if (cached) {
      return cached;
    }
    const look = lookOf(config);
    const parts: BufferGeometry[] = [];
    let shoulder: Point3 = [0, 1.42, 0];
    let head: HitboxShape | undefined;
    let torso: HitboxShape | undefined;
    const armTops: Point3[] = [];
    for (const shape of config.rig.shapes) {
      const color = look.zoneColors[shape.zone];
      if (shape.zone === 'ARM_LEFT' || shape.zone === 'ARM_RIGHT') {
        if (shape.kind === 'capsule') {
          shoulder = [0, shape.a[1], shape.a[2]];
          armTops.push(shape.a);
        }
        parts.push(skin(shapeGeometry(shape, color), ARMS_BONE));
      } else {
        parts.push(skin(shapeGeometry(shape, color), BODY_BONE));
        if (shape.zone === 'HEAD') {
          head = shape;
        } else if (shape.zone === 'TORSO') {
          torso = shape;
        }
      }
    }
    if (head?.kind === 'sphere') {
      // Eyes on the front (−z) of the head.
      const r = head.radius;
      for (const side of [-1, 1]) {
        const eye = new SphereGeometry(r * 0.17, 6, 4);
        eye.translate(
          head.center[0] + side * r * 0.35,
          head.center[1] + r * 0.12,
          head.center[2] - r * 0.93,
        );
        colorize(eye, bits & ELITE_BIT ? ELITE_EYES : look.eyes);
        parts.push(skin(eye, BODY_BONE));
      }
      if (look.mouth) {
        const mouth = new CircleGeometry(r * look.mouth.size, 12);
        mouth.scale(0.8, 1.2, 1);
        mouth.rotateY(Math.PI);
        mouth.translate(head.center[0], head.center[1] - r * 0.4, head.center[2] - r * 0.86);
        colorize(mouth, look.mouth.color);
        parts.push(skin(mouth, BODY_BONE));
      }
      if (bits & HELMET_BIT) {
        const dome = new SphereGeometry(r * 1.2, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.55);
        dome.translate(head.center[0], head.center[1] - r * 0.05, head.center[2]);
        colorize(dome, TRAIT_LOOKS.helmeted.color);
        parts.push(skin(dome, BODY_BONE));
      }
    }
    if (torso?.kind === 'capsule') {
      const r = torso.radius;
      const top = Math.max(torso.a[1], torso.b[1]) + r * 0.6;
      const bottom = Math.min(torso.a[1], torso.b[1]) - r * 0.2;
      if (bits & ARMOR_BIT) {
        for (const side of [-1, 1]) {
          // Chest (−z) and back (+z) plates.
          const plate = new BoxGeometry(r * 1.9, top - bottom, r * 0.35);
          plate.translate(0, (top + bottom) / 2, side * r * 0.95);
          colorize(plate, TRAIT_LOOKS.armored.color);
          parts.push(skin(plate, BODY_BONE));
        }
        for (const at of armTops) {
          const pad = new BoxGeometry(r * 1.2, r * 0.45, r * 1.3);
          pad.translate(at[0] * 1.05, at[1] + r * 0.25, at[2]);
          colorize(pad, TRAIT_LOOKS.armored.color);
          parts.push(skin(pad, BODY_BONE));
        }
      }
      if (bits & ELITE_BIT) {
        const spike = (x: number, y: number, z: number, tiltX: number, tiltZ: number) => {
          const cone = new ConeGeometry(r * 0.2, r * 1.1, 5);
          cone.translate(0, r * 0.55, 0);
          cone.rotateX(tiltX);
          cone.rotateZ(tiltZ);
          cone.translate(x, y, z);
          colorize(cone, TRAIT_LOOKS.elite.color);
          parts.push(skin(cone, BODY_BONE));
        };
        for (const at of armTops) {
          const side = Math.sign(at[0]) || 1;
          for (let i = 0; i < 3; i++) {
            spike(
              at[0] * (1.1 - i * 0.2),
              at[1] + r * 0.3,
              at[2] + (i - 1) * r * 0.4,
              0,
              -side * 0.5,
            );
          }
        }
        for (let i = 0; i < 3; i++) {
          spike(0, top - r * 0.3 - i * r * 0.9, r * 0.9, 1.2, 0);
        }
      }
    }
    const geometry = mergeGeometries(parts);
    for (const part of parts) {
      part.dispose();
    }
    const result = { geometry, shoulder };
    this.looks.set(key, result);
    return result;
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
