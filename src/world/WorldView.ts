/**
 * Presentation of the world (D-003): the blockout level, its lighting and the signal beacon.
 *
 * Blockout rendering (plan §8: "not final art"), kept deliberately cheap:
 * - level meshes come from the same brush data as collision (D-013), merged into one mesh per
 *   surface kind, so the whole map is a handful of draw calls;
 * - flat-shaded solid colours per surface kind, plus a ground grid for reading distance and speed;
 * - a fixed light rig (D-022): hemisphere fill and one shadow-casting sun, whose shadow map size
 *   comes from the graphics quality profile (D-037);
 * - every shader is compiled before the first frame (`prewarm`).
 */

import {
  BoxGeometry,
  BufferGeometry,
  Color,
  DirectionalLight,
  Float32BufferAttribute,
  Fog,
  GridHelper,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  Scene,
  type Object3D,
  type PerspectiveCamera,
  type Triangle,
} from 'three';
import type { Renderer } from '../render/Renderer';
import { levelTriangles } from './levels/geometry';
import type { SurfaceKind, Vec3 } from './levels/types';
import type { World } from './World';

const BACKGROUND = 0x0b0e12;

// Light, distinct greys and a few hues: a blockout has to read clearly, indoors and out.
const SURFACE_COLORS: Readonly<Record<SurfaceKind, number>> = {
  ground: 0x4d5258,
  wall: 0x8c949c,
  structure: 0xa7adb3,
  crate: 0xa27c4d,
  metal: 0x5f788a,
  accent: 0xd9b030,
};

const BEACON_BOB_HEIGHT = 0.15;

export interface WorldViewOptions {
  /** Where the beacon hovers (level data). */
  readonly beaconPosition: Vec3;
}

export class WorldView {
  readonly scene = new Scene();
  private readonly renderer: Renderer;
  private readonly world: World;
  private readonly beacon: Mesh;
  private readonly beaconBase: Vec3;
  private readonly disposables: { dispose(): void }[] = [];

  constructor(renderer: Renderer, world: World, options: WorldViewOptions) {
    this.renderer = renderer;
    this.world = world;
    this.beaconBase = options.beaconPosition;

    this.scene.background = new Color(BACKGROUND);
    this.scene.fog = new Fog(BACKGROUND, 35, 110);

    // Light rig: fixed from the start (D-022). One shadow caster.
    this.scene.add(new HemisphereLight(0xc4d3e2, 0x3b3128, 2.2));
    const sun = new DirectionalLight(0xffe2b8, 2.4);
    sun.position.set(18, 30, 10);
    const shadows = renderer.quality.shadows;
    sun.castShadow = shadows.enabled;
    sun.shadow.mapSize.set(shadows.mapSize, shadows.mapSize);
    const extent = 34; // covers the whole 48 m map from the sun's angle
    sun.shadow.camera.left = -extent;
    sun.shadow.camera.right = extent;
    sun.shadow.camera.top = extent;
    sun.shadow.camera.bottom = -extent;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 90;
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.02;
    this.scene.add(sun, sun.target);

    for (const { surface, triangles } of levelTriangles(world.level.brushes, 'render')) {
      const material = this.track(
        new MeshStandardMaterial({
          color: SURFACE_COLORS[surface],
          roughness: surface === 'metal' ? 0.6 : 0.9,
          metalness: surface === 'metal' ? 0.25 : 0,
          flatShading: true,
        }),
      );
      const mesh = new Mesh(this.track(toGeometry(triangles)), material);
      mesh.name = `level:${surface}`;
      mesh.castShadow = surface !== 'ground';
      mesh.receiveShadow = true;
      this.scene.add(mesh);
    }

    const grid = new GridHelper(48, 48, 0x46505a, 0x353c44);
    grid.position.y = 0.002;
    this.track(grid.geometry);
    this.track(grid.material);
    this.scene.add(grid);

    const beaconMaterial = this.track(
      new MeshStandardMaterial({
        color: 0x3a0c0a,
        emissive: 0xc8332b,
        emissiveIntensity: 1.6,
        roughness: 0.4,
        metalness: 0.3,
      }),
    );
    this.beacon = new Mesh(this.track(new BoxGeometry(0.8, 0.8, 0.8)), beaconMaterial);
    this.beacon.name = 'beacon';
    this.beacon.castShadow = true;
    this.scene.add(this.beacon);
    this.syncBeacon(0);
  }

  /**
   * Compiles every shader now rather than on the first visible frame (D-022). Called once the
   * camera exists, and again after a WebGL context restore, when all programs are rebuilt.
   *
   * `compile` only visits visible objects, so pooled effects that start hidden (muzzle flash,
   * impact markers, hit sparks, pickups) would still pay their first-draw setup in the middle of
   * play: measured at ~200 ms on the first shot (TESTING §7.4). They are shown for one render
   * here, behind the start prompt, and hidden again.
   */
  prewarm(camera: PerspectiveCamera): void {
    const hidden: Object3D[] = [];
    this.scene.traverse((object) => {
      if (!object.visible) {
        hidden.push(object);
        object.visible = true;
      }
    });
    this.renderer.webgl.compile(this.scene, camera);
    this.renderer.render(this.scene, camera);
    for (const object of hidden) {
      object.visible = false;
    }
  }

  render(alpha: number, camera: PerspectiveCamera): void {
    this.syncBeacon(alpha);
    this.renderer.render(this.scene, camera);
  }

  dispose(): void {
    for (const resource of this.disposables) {
      resource.dispose();
    }
    this.disposables.length = 0;
    this.scene.clear();
  }

  private syncBeacon(alpha: number): void {
    const angle = this.world.beacon.interpolatedAngle(alpha);
    const [x, y, z] = this.beaconBase;
    this.beacon.rotation.set(0.4, angle, 0);
    this.beacon.position.set(x, y + Math.sin(angle * 2) * BEACON_BOB_HEIGHT, z);
  }

  private track<T extends { dispose(): void }>(resource: T): T {
    this.disposables.push(resource);
    return resource;
  }
}

/** A non-indexed geometry: every triangle keeps its own vertices, so normals stay flat. */
function toGeometry(triangles: readonly Triangle[]): BufferGeometry {
  const positions = new Float32Array(triangles.length * 9);
  let i = 0;
  for (const { a, b, c } of triangles) {
    positions.set([a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z], i);
    i += 9;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}
