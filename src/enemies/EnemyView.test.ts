/**
 * Enemy presentation logic that needs no GPU (D-046): the eye/silhouette/proximity material patch
 * (one program for every enemy, eyes marked in the geometry), the alarm looks (a scream's violet
 * sonic wave, a death cry's red echo), frenzied eyes, and the acid's view. Pixels are checked in the
 * browser (`tests/e2e`).
 */

import { Scene, ShaderLib, UniformsUtils, type Mesh, type MeshStandardMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import { ENEMY_STATS } from '../config/enemies';
import { ENEMY_LOOKS, FRENZY_EYES } from '../config/enemyLooks';
import { EnemyView } from './EnemyView';
import { ProjectileView } from './ProjectileView';
import { enemyTestWorld, TestTarget } from './testWorld';

function scene() {
  const t = enemyTestWorld({ targets: [new TestTarget(0, 40)] });
  const s = new Scene();
  const view = new EnemyView(s, t.manager, t.combat);
  return { t, s, view };
}

function enemyMeshes(s: Scene): Mesh[] {
  const out: Mesh[] = [];
  s.traverse((o) => {
    if ((o as { isSkinnedMesh?: boolean }).isSkinnedMesh) {
      out.push(o as Mesh);
    }
  });
  return out;
}

describe('EnemyView: eyes and the dark (D-046)', () => {
  it('every enemy material shares one patched program; eyes are marked in the geometry', () => {
    const { s } = scene();
    const meshes = enemyMeshes(s);
    expect(meshes.length).toBeGreaterThanOrEqual(5); // one pooled visual per archetype
    const keys = new Set(
      meshes.map((m) => (m.material as MeshStandardMaterial).customProgramCacheKey()),
    );
    expect(keys.size).toBe(1);
    for (const m of meshes) {
      const eye = m.geometry.getAttribute('aEye');
      expect(eye.count).toBe(m.geometry.getAttribute('position').count);
      const values = Array.from(eye.array as Float32Array);
      const eyes = values.filter((v) => v === 1).length;
      expect(eyes).toBeGreaterThan(0);
      expect(eyes).toBeLessThan(values.length / 4); // only the eyes, never the body
      expect(values.every((v) => v === 0 || v === 1)).toBe(true);
    }
  });

  it('the patch adds eye glow, silhouette and proximity to the standard shader', () => {
    const { s } = scene();
    const material = enemyMeshes(s)[0]?.material as MeshStandardMaterial;
    const shader = {
      uniforms: UniformsUtils.clone(ShaderLib.standard.uniforms),
      vertexShader: ShaderLib.standard.vertexShader,
      fragmentShader: ShaderLib.standard.fragmentShader,
    };
    material.onBeforeCompile(shader as never, undefined as never);
    expect(shader.vertexShader).toContain('attribute float aEye;');
    expect(shader.vertexShader).toContain('vEye = aEye;');
    expect(shader.fragmentShader).toContain(
      'totalEmissiveRadiance += uEyeColor * vEye * uEyeGlow;',
    );
    // The body (not the eyes) darkens by the silhouette, less so close to the camera.
    expect(shader.fragmentShader).toContain(
      'diffuseColor.rgb *= 1.0 - uSilhouette * 0.8 * (1.0 - vEye) * (1.0 - enemyNear);',
    );
    expect(shader.fragmentShader).toContain(
      'float enemyNear = uProximity * smoothstep(7.0, 2.5, length(vViewPosition));',
    );
    for (const name of ['uEyeGlow', 'uEyeColor', 'uSilhouette', 'uProximity']) {
      expect(shader.uniforms).toHaveProperty(name);
    }
  });

  it('the environment drives every enemy’s eyes and body; a body on the ground has no glow', () => {
    const { t, view } = scene();
    const walker = t.manager.spawn('walker', [0, 0, 0], { patrol: false });
    view.eyeGlow = 1.4;
    view.silhouette = 0.75;
    view.proximity = 0.6;
    view.update(1, 1 / 60);
    expect(view.eyes(walker?.id ?? '')).toEqual({
      glow: 1.4,
      color: ENEMY_LOOKS.walker?.eyes,
      silhouette: 0.75,
      proximity: 0.6,
    });
    t.manager.kill(walker?.id ?? '');
    view.update(1, 1 / 60);
    expect(view.eyes(walker?.id ?? '')?.glow).toBe(0);
  });

  it('frenzied eyes flare red for a death cry, violet for a scream, and calm down after', () => {
    const { t, view } = scene();
    const a = t.manager.spawn('walker', [0, 0, 0], { patrol: false });
    const b = t.manager.spawn('walker', [30, 0, 0], { patrol: false });
    t.step();
    const frenzy = ENEMY_STATS.screamer.ability?.frenzy ?? null;
    t.manager.raiseAlarm({
      sourceId: 'x',
      kind: 'deathCry',
      reinforcements: false,
      position: [0, 0, 0],
      radius: 5,
      alertDuration: 0,
      haste: null,
      frenzy,
    });
    t.manager.raiseAlarm({
      sourceId: 'y',
      kind: 'scream',
      reinforcements: true,
      position: [30, 0, 0],
      radius: 5,
      alertDuration: 0,
      haste: null,
      frenzy,
    });
    view.update(1, 1 / 60);
    expect(view.eyes(a?.id ?? '')?.color).toBe(FRENZY_EYES.deathCry);
    expect(view.eyes(b?.id ?? '')?.color).toBe(FRENZY_EYES.scream);
    expect(view.eyes(a?.id ?? '')?.glow).toBeGreaterThan(1);
    t.seconds((frenzy?.duration ?? 0) + 0.1);
    view.update(1, 1 / 60);
    expect(view.eyes(a?.id ?? '')?.color).toBe(ENEMY_LOOKS.walker?.eyes);
    expect(view.eyes(a?.id ?? '')?.glow).toBe(0);
  });
});

describe('EnemyView: Signal Glitch lag (D-046)', () => {
  it('during a burst an enemy is drawn behind where it is; its hit volumes are not', () => {
    const { t, view } = scene();
    const target = t.targets[0];
    const walker = t.manager.spawn('walker', [0, 0, 0], {
      patrol: false,
      ...(target ? { alertTo: target } : {}),
    });
    const id = walker?.id ?? '';
    // Walk for a second, drawing every step.
    for (let i = 0; i < 60; i++) {
      t.step();
      view.update(1, 1 / 60);
    }
    const plain = view.drawnPosition(id);
    expect(plain?.drawn).toEqual(plain?.real);
    view.desync = 0.18;
    t.step();
    view.update(1, 1 / 60);
    const lagged = view.drawnPosition(id);
    const lag = Math.hypot(
      (lagged?.drawn[0] ?? 0) - (lagged?.real[0] ?? 0),
      (lagged?.drawn[2] ?? 0) - (lagged?.real[2] ?? 0),
    );
    const speed = Math.hypot(walker?.motor.velocity.x ?? 0, walker?.motor.velocity.z ?? 0);
    expect(speed).toBeGreaterThan(1);
    expect(lag).toBeCloseTo(speed * 0.18, 1);
    // The hit volumes follow the simulation, not the drawing.
    expect(walker?.rig.position.x).toBeCloseTo(lagged?.real[0] ?? 0, 6);
    expect(walker?.rig.position.z).toBeCloseTo(lagged?.real[2] ?? 0, 6);
    view.desync = 0;
    t.step();
    view.update(1, 1 / 60);
    const after = view.drawnPosition(id);
    expect(after?.drawn).toEqual(after?.real);
  });
});

describe('EnemyView: alarms look different (D-046)', () => {
  const alarm = (kind: 'scream' | 'deathCry') => ({
    sourceId: 'x',
    kind,
    reinforcements: kind === 'scream',
    position: [0, 0, 0] as [number, number, number],
    radius: kind === 'scream' ? 18 : 8,
    alertDuration: 0,
    haste: null,
  });

  it('a scream: a violet sonic wave of three rings in a row and a tall column', () => {
    const { t, view } = scene();
    t.manager.raiseAlarm(alarm('scream'));
    expect(view.activeRings).toBe(3);
    expect(new Set(view.activeRingColors)).toEqual(new Set([0xb46cff]));
    expect(view.activeColumns).toEqual([{ color: 0xb46cff, height: 6 }]);
    view.update(1, 0.75);
    expect(view.activeRings).toBe(2); // the later rings are still going
    view.update(1, 0.4);
    expect(view.activeRings).toBe(0);
  });

  it('a death cry: a red echo of two rings and a short flare', () => {
    const { t, view } = scene();
    t.manager.raiseAlarm(alarm('deathCry'));
    expect(view.activeRings).toBe(2);
    expect(new Set(view.activeRingColors)).toEqual(new Set([0xff3b30]));
    expect(view.activeColumns).toEqual([{ color: 0xff3b30, height: 2.2 }]);
  });

  it('overlapping alarms reuse the pool: never more than eight rings', () => {
    const { t, view } = scene();
    for (let i = 0; i < 5; i++) {
      t.manager.raiseAlarm(alarm('scream'));
    }
    expect(view.activeRings).toBe(8);
  });
});

describe('ProjectileView: the acid', () => {
  it('draws one blob per projectile in flight and a splat where one lands', () => {
    const t = enemyTestWorld({ targets: [new TestTarget(0, 0)] });
    const s = new Scene();
    const view = new ProjectileView(s, t.projectiles);
    const acid = ENEMY_STATS.spitter.projectile;
    if (!acid) {
      throw new Error('no projectile');
    }
    t.projectiles.fire('spitter-x', 'spitter', [5, 1, 5], [0, -4, 0], acid);
    t.projectiles.fire('spitter-x', 'spitter', [-5, 1, 5], [0, -4, 0], acid);
    view.update(1, 1 / 60);
    expect(view.visibleCount).toBe(2);
    t.seconds(0.5);
    view.update(1, 1 / 60);
    expect(view.visibleCount).toBe(0);
    expect(view.activeSplats).toBe(2);
    view.update(1, 0.6);
    expect(view.activeSplats).toBe(0);
    view.dispose();
  });
});
