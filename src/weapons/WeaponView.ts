/**
 * Presentation of the weapons (D-003, D-040): a blockout first-person view model attached to the
 * camera, a muzzle flash, and impact markers where shots hit the level. It reads the
 * `WeaponManager` state and listens to its events; it never changes the simulation.
 *
 * Kept cheap (plan §25): every mesh, geometry and material is created once. Impact markers are a
 * fixed ring of meshes reused oldest-first, so firing allocates nothing on the GPU. No lights are
 * added (D-022): the flash is an unlit additive quad.
 */

import {
  AdditiveBlending,
  BoxGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Vector3,
  type Material,
  type PerspectiveCamera,
  type Scene,
} from 'three';
import type { ShotResult } from './types';
import type { WeaponManager } from './WeaponManager';

const IMPACT_MARKERS = 32;
const IMPACT_LIFETIME = 10;
const FLASH_TIME = 0.05;
const PUNCH_TIME = 0.25;
/** How far below the view a weapon starts when it is raised. */
const RAISE_DROP = 0.3;
/** Where the held weapon sits, relative to the camera. */
const FIREARM_REST = new Vector3(0.16, -0.15, -0.5);

export class WeaponView {
  /** The view model, a child of the camera. */
  readonly root = new Group();
  private readonly firearm = new Group();
  private readonly fists = new Group();
  private readonly rightFist: Mesh;
  private readonly flash: Mesh;
  private readonly markers: Mesh[] = [];
  private readonly markerAge: number[] = [];
  private nextMarker = 0;
  private flashTimer = 0;
  private punchTimer = 0;
  private kick = 0;
  private readonly manager: WeaponManager;
  private readonly camera: PerspectiveCamera;
  private readonly disposables: { dispose(): void }[] = [];
  private readonly unsubscribe: (() => void)[] = [];
  private readonly scratch = new Vector3();

  constructor(scene: Scene, camera: PerspectiveCamera, manager: WeaponManager) {
    this.manager = manager;
    this.camera = camera;

    // ---- view model (drawn over the world: no depth test, drawn last) -------------------------
    const metal = this.viewMaterial(
      new MeshStandardMaterial({ color: 0x59606a, roughness: 0.45, metalness: 0.3 }),
    );
    const grip = this.viewMaterial(new MeshStandardMaterial({ color: 0x33363b, roughness: 0.8 }));
    const skin = this.viewMaterial(new MeshStandardMaterial({ color: 0xb98a6a, roughness: 0.9 }));
    const body = this.viewMesh(new BoxGeometry(0.035, 0.045, 0.17), metal);
    body.position.set(0, 0.015, -0.03);
    const handle = this.viewMesh(new BoxGeometry(0.03, 0.085, 0.04), grip);
    handle.position.set(0, -0.035, 0.025);
    handle.rotation.x = -0.25;
    this.firearm.add(body, handle);

    const flashMaterial = this.track(
      new MeshBasicMaterial({
        color: 0xffd27a,
        transparent: true,
        opacity: 0.9,
        blending: AdditiveBlending,
        depthTest: false,
        depthWrite: false,
      }),
    );
    this.flash = this.viewMesh(new PlaneGeometry(0.1, 0.1), flashMaterial);
    this.flash.position.set(0, 0.018, -0.13);
    this.flash.visible = false;
    this.firearm.add(this.flash);

    const fistGeometry = this.track(new BoxGeometry(0.055, 0.055, 0.1));
    const leftFist = this.viewMesh(fistGeometry, skin);
    leftFist.position.set(-0.19, -0.19, -0.46);
    this.rightFist = this.viewMesh(fistGeometry, skin);
    this.rightFist.position.set(0.19, -0.19, -0.46);
    this.fists.add(leftFist, this.rightFist);

    this.root.add(this.firearm, this.fists);
    this.root.name = 'weapon-view';
    camera.add(this.root);

    // ---- impact markers (in the world) ------------------------------------------------------
    const markerGeometry = this.track(new PlaneGeometry(0.07, 0.07));
    const markerMaterial = this.track(
      new MeshBasicMaterial({
        color: 0x14100c,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      }),
    );
    for (let i = 0; i < IMPACT_MARKERS; i++) {
      const marker = new Mesh(markerGeometry, markerMaterial);
      marker.visible = false;
      marker.name = 'impact-marker';
      scene.add(marker);
      this.markers.push(marker);
      this.markerAge.push(Number.POSITIVE_INFINITY);
    }

    this.unsubscribe.push(
      manager.events.on('shot', (shot) => {
        this.onShot(shot);
      }),
      manager.events.on('melee', () => {
        this.punchTimer = PUNCH_TIME;
      }),
    );
    this.update(0);
  }

  /** Impact markers currently shown (tests, debug). */
  get activeImpactMarkers(): number {
    return this.markers.filter((m) => m.visible).length;
  }

  get muzzleFlashVisible(): boolean {
    return this.flash.visible;
  }

  /** Animates the view model; `dt` is simulated seconds this frame (0 while paused). */
  update(dt: number): void {
    const manager = this.manager;
    const weapon = manager.activeWeapon;
    const status = weapon.getState();
    const holdingFirearm = status.kind === 'firearm';

    // Shown before the timer advances, so a flash is drawn for at least one frame even when a
    // slow frame is longer than the flash itself.
    this.flash.visible = this.flashTimer > 0;
    this.flash.rotation.z = this.flashTimer * 40;
    this.flashTimer = Math.max(0, this.flashTimer - dt);
    this.punchTimer = Math.max(0, this.punchTimer - dt);
    this.kick *= Math.exp(-dt * 18);

    // Raise the newly selected weapon from below the view.
    const equipTime = weapon.definition.equipTime;
    const raise = equipTime > 0 ? manager.switchRemainingTime / equipTime : 0;
    const drop = RAISE_DROP * raise;

    const punching = this.punchTimer > 0;
    this.firearm.visible = holdingFirearm && !(punching && manager.isQuickMeleeing);
    this.fists.visible = !holdingFirearm || punching;

    // Firearm: dips while reloading, kicks back on each shot.
    const reloadDip = Math.sin(status.reloadProgress * Math.PI);
    this.firearm.position.set(
      FIREARM_REST.x,
      FIREARM_REST.y - drop - reloadDip * 0.06,
      FIREARM_REST.z + this.kick * 0.035,
    );
    this.firearm.rotation.set(this.kick * 0.18 - reloadDip * 0.45, 0, reloadDip * 0.35);

    // Fists: the right one jabs forward on a swing.
    const punch = punching ? Math.sin((1 - this.punchTimer / PUNCH_TIME) * Math.PI) : 0;
    this.fists.position.y = -drop;
    this.rightFist.position.z = -0.46 - punch * 0.18;
    this.rightFist.position.x = 0.19 - punch * 0.12;

    for (let i = 0; i < IMPACT_MARKERS; i++) {
      const age = (this.markerAge[i] ?? Number.POSITIVE_INFINITY) + dt;
      this.markerAge[i] = age;
      const marker = this.markers[i];
      if (marker && marker.visible && age > IMPACT_LIFETIME) {
        marker.visible = false;
      }
    }
  }

  dispose(): void {
    for (const off of this.unsubscribe) {
      off();
    }
    this.camera.remove(this.root);
    for (const marker of this.markers) {
      marker.removeFromParent();
    }
    for (const resource of this.disposables) {
      resource.dispose();
    }
    this.disposables.length = 0;
  }

  private onShot(shot: ShotResult): void {
    this.flashTimer = FLASH_TIME;
    this.kick = 1;
    for (const pellet of shot.pellets) {
      const hit = pellet.hit;
      if (hit?.kind !== 'world') {
        continue;
      }
      const index = this.nextMarker;
      this.nextMarker = (index + 1) % IMPACT_MARKERS;
      const marker = this.markers[index];
      if (!marker) {
        continue;
      }
      const [px, py, pz] = hit.point;
      const [nx, ny, nz] = hit.normal;
      marker.position.set(px + nx * 0.004, py + ny * 0.004, pz + nz * 0.004);
      marker.lookAt(this.scratch.set(px + nx, py + ny, pz + nz));
      marker.visible = true;
      this.markerAge[index] = 0;
    }
  }

  private viewMaterial<T extends Material>(material: T): T {
    material.depthTest = false;
    material.depthWrite = false;
    return this.track(material);
  }

  private viewMesh(
    geometry: BoxGeometry | PlaneGeometry,
    material: Material,
  ): Mesh<BoxGeometry | PlaneGeometry, Material> {
    this.track(geometry);
    const mesh = new Mesh(geometry, material);
    mesh.renderOrder = 10;
    mesh.frustumCulled = false;
    return mesh;
  }

  private track<T extends { dispose(): void }>(resource: T): T {
    if (!this.disposables.includes(resource)) {
      this.disposables.push(resource);
    }
    return resource;
  }
}
