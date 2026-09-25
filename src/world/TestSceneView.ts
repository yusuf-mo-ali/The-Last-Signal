/**
 * Presentation half of the Phase 0 test scene. It proves the render foundation end to end:
 * renderer, camera, a lit scene with one shadow caster, resize (through `Renderer.render`), and
 * fixed-step integration (the beacon is drawn at the interpolated simulation angle).
 *
 * Follows the rules the real world will use:
 * - geometry and materials are created once and shared (plan §25 "reusable materials"),
 * - the light rig is fixed at construction (D-022), shaders are compiled before the first frame.
 */

import {
  BoxGeometry,
  Color,
  DirectionalLight,
  Fog,
  GridHelper,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  Scene,
  type PerspectiveCamera,
} from 'three';
import type { Presentation } from '../core/Game';
import { createCamera } from '../render/camera';
import type { Renderer } from '../render/Renderer';
import type { TestScene } from './TestScene';

const BACKGROUND = 0x07090b;
const BEACON_BASE_HEIGHT = 1.6;
const BEACON_BOB_HEIGHT = 0.15;

/** Static crates around the beacon: [x, z, size]. */
const CRATES: readonly (readonly [number, number, number])[] = [
  [-4, -2, 1.2],
  [-3, 3, 0.8],
  [3.5, -3, 1.5],
  [5, 2, 1],
  [0, -6, 2],
];

export class TestSceneView implements Presentation {
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera = createCamera();

  private readonly renderer: Renderer;
  private readonly sim: TestScene;
  private readonly beacon: Mesh;
  private readonly disposables: { dispose(): void }[] = [];

  constructor(renderer: Renderer, sim: TestScene) {
    this.renderer = renderer;
    this.sim = sim;

    this.scene.background = new Color(BACKGROUND);
    this.scene.fog = new Fog(BACKGROUND, 18, 45);

    this.camera.position.set(7, 4.5, 9);
    this.camera.lookAt(0, 1.2, 0);

    // Light rig: fixed count from the start (D-022). One shadow caster.
    this.scene.add(new HemisphereLight(0x9fb4c8, 0x1a1410, 1.2));
    const sun = new DirectionalLight(0xffe2b8, 2.4);
    sun.position.set(6, 12, 4);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -12;
    sun.shadow.camera.right = 12;
    sun.shadow.camera.top = 12;
    sun.shadow.camera.bottom = -12;
    this.scene.add(sun);

    const floorGeometry = this.track(new PlaneGeometry(40, 40));
    const floorMaterial = this.track(
      new MeshStandardMaterial({ color: 0x2a2e33, roughness: 0.95 }),
    );
    const floor = new Mesh(floorGeometry, floorMaterial);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);

    const grid = new GridHelper(40, 40, 0x3c434b, 0x252a30);
    grid.position.y = 0.001;
    this.track(grid.geometry);
    this.track(grid.material);
    this.scene.add(grid);

    const crateGeometry = this.track(new BoxGeometry(1, 1, 1));
    const crateMaterial = this.track(new MeshStandardMaterial({ color: 0x5b4a36, roughness: 0.8 }));
    for (const [x, z, size] of CRATES) {
      const crate = new Mesh(crateGeometry, crateMaterial);
      crate.scale.setScalar(size);
      crate.position.set(x, size / 2, z);
      crate.castShadow = true;
      crate.receiveShadow = true;
      this.scene.add(crate);
    }

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
    this.beacon.castShadow = true;
    this.scene.add(this.beacon);
    this.syncBeacon(0);

    this.prewarm();
  }

  /**
   * Compiles every shader now rather than on the first visible frame (D-022). Called again after
   * a WebGL context restore, when all GPU programs have to be rebuilt.
   */
  prewarm(): void {
    this.renderer.webgl.compile(this.scene, this.camera);
  }

  render(alpha: number): void {
    this.syncBeacon(alpha);
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    for (const resource of this.disposables) {
      resource.dispose();
    }
    this.disposables.length = 0;
    this.scene.clear();
  }

  private syncBeacon(alpha: number): void {
    const angle = this.sim.interpolatedAngle(alpha);
    this.beacon.rotation.set(0.4, angle, 0);
    this.beacon.position.set(0, BEACON_BASE_HEIGHT + Math.sin(angle * 2) * BEACON_BOB_HEIGHT, 0);
  }

  private track<T extends { dispose(): void }>(resource: T): T {
    this.disposables.push(resource);
    return resource;
  }
}
