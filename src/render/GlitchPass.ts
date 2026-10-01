/**
 * Signal Glitch on screen (D-046): during a STATIC burst, the rendered 3D image tears into
 * horizontal bands that slip sideways, splits its red and blue a little, and keeps an afterimage
 * of a moment ago. Only during a burst: otherwise the frame takes the plain `Renderer.render` path
 * and nothing here costs anything.
 *
 * How (cheap, and no new scene shaders):
 * - during a burst the scene is rendered into a render target (`target`) instead of the screen;
 * - each time the tear pattern steps (at most 3 times a second) that image is copied into a second
 *   target, the afterimage (`history`), by the same quad drawn with no glitch;
 * - one full-screen quad samples both with the glitch and draws the screen.
 *
 * The target is flagged `isXRRenderTarget` with an sRGB colour space but plain RGBA8 storage: three
 * then gives the scene the screen's tone mapping and output encoding, so every scene material
 * keeps its on-screen program (same cache key, no compile mid-fight, D-022), and the stored values
 * are exactly what the screen would show. It is single-sample: a multisampled target and its
 * resolve made burst frames cost ~27 % instead of ~16 % (software rendering, TESTING §7.4), and a
 * burst's torn image hides the lost antialiasing for its fraction of a second.
 *
 * The first version copied the screen itself (`copyFramebufferToTexture` from the default
 * framebuffer) after the normal render. With antialiasing that copy has to resolve the
 * multisampled screen, and it sometimes read black: a burst frame held black (TESTING §8). This
 * version never reads the screen.
 *
 * The centre around the crosshair stays clear (a radial mask, `GLITCH_CLEAR`); the HUD is DOM
 * above the canvas and never glitched. Reduced motion: no tears or afterimage, a slight colour
 * split only (see `glitchFrame`). Both targets are allocated and the quad compiled at load
 * (`prewarm`), and again after a context restore.
 */

import {
  Mesh,
  NearestFilter,
  OrthographicCamera,
  PlaneGeometry,
  SRGBColorSpace,
  Scene,
  ShaderMaterial,
  Vector2,
  Vector4,
  WebGLRenderTarget,
  type PerspectiveCamera,
  type Texture,
} from 'three';
import type { Renderer } from './Renderer';
import { GLITCH_CLEAR, type GlitchFrame, type TearBand } from './glitch';

const MAX_BANDS = 6;

const VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const FRAGMENT = /* glsl */ `
uniform sampler2D tFrame;
uniform sampler2D tHistory;
uniform float uIntensity;
uniform float uShift;
uniform float uChroma;
uniform float uGhost;
uniform vec2 uResolution;
uniform vec2 uClear;
uniform vec4 uBands[${MAX_BANDS}];
varying vec2 vUv;
void main() {
  vec2 px = vUv * uResolution;
  float minSide = min(uResolution.x, uResolution.y);
  float d = length(px - 0.5 * uResolution);
  float mask = smoothstep(uClear.x * minSide, uClear.y * minSide, d) * uIntensity;
  float shift = 0.0;
  for (int i = 0; i < ${MAX_BANDS}; i++) {
    vec4 b = uBands[i];
    shift += b.w * step(abs(vUv.y - b.x), b.y) * b.z;
  }
  shift = clamp(shift, -1.0, 1.0) * uShift * mask;
  vec2 uv = vec2(fract(vUv.x + shift), vUv.y);
  float ch = uChroma * mask;
  vec3 color = vec3(
    texture2D(tFrame, uv + vec2(ch, 0.0)).r,
    texture2D(tFrame, uv).g,
    texture2D(tFrame, uv - vec2(ch, 0.0)).b
  );
  vec3 history = texture2D(tHistory, uv).rgb;
  color = mix(color, max(color, history), uGhost * mask);
  gl_FragColor = vec4(color, 1.0);
}
`;

export interface GlitchState {
  /** Whether the last frame drawn was glitched. */
  readonly active: boolean;
  readonly intensity: number;
  readonly step: number;
  /** Tear patterns shown so far in the current burst. */
  readonly steps: number;
  /** Glitched frames drawn since load. */
  readonly frames: number;
  /** The tear bands of the pattern showing (none when idle). */
  readonly bands: readonly TearBand[];
}

export class GlitchPass {
  private readonly renderer: Renderer;
  private readonly scene = new Scene();
  private readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly material: ShaderMaterial;
  private readonly size = new Vector2();
  /** The scene, rendered here instead of the screen during a burst. */
  private target: WebGLRenderTarget;
  /** The afterimage: `target` as it was when the tear pattern last stepped. */
  private history: WebGLRenderTarget;
  /** The WebGL context the targets belong to (`ContextLossMonitor.lossCount`). */
  private generation: number;
  private lastBurst = Number.NaN;
  private lastStep = -1;
  private stepsThisBurst = 0;
  private framesDrawn = 0;
  private wasActive = false;
  private intensity = 0;
  private bands: readonly TearBand[] = [];

  constructor(renderer: Renderer) {
    this.renderer = renderer;
    this.target = makeTarget(true);
    this.history = makeTarget(false);
    this.generation = renderer.context.lossCount;
    this.material = new ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: {
        tFrame: { value: this.target.texture },
        tHistory: { value: this.history.texture },
        uIntensity: { value: 0 },
        uShift: { value: 0 },
        uChroma: { value: 0 },
        uGhost: { value: 0 },
        uResolution: { value: new Vector2(1, 1) },
        uClear: { value: new Vector2(GLITCH_CLEAR.inner, GLITCH_CLEAR.outer) },
        uBands: { value: Array.from({ length: MAX_BANDS }, () => new Vector4()) },
      },
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    const quad = new Mesh(new PlaneGeometry(2, 2), this.material);
    quad.frustumCulled = false;
    this.scene.add(quad);
  }

  get state(): GlitchState {
    return {
      active: this.wasActive,
      intensity: this.intensity,
      step: this.lastStep,
      steps: this.stepsThisBurst,
      frames: this.framesDrawn,
      bands: this.bands,
    };
  }

  /**
   * At load (and after a context restore), never mid-fight: compiles the quad, allocates both
   * targets at the screen size, and renders `scene` once into the target and copies it to the
   * history, so any per-target setup happens now.
   */
  prewarm(scene: Scene, camera: PerspectiveCamera): void {
    const webgl = this.renderer.webgl;
    webgl.compile(this.scene, this.camera);
    this.renewAfterContextLoss();
    this.fitToScreen();
    webgl.setRenderTarget(this.target);
    webgl.render(scene, camera);
    this.snapshot();
    webgl.setRenderTarget(null);
  }

  /**
   * Draws one frame of `scene`: glitched when `glitch` is active, the plain render otherwise.
   * Returns false when nothing could be drawn (no area, context lost).
   */
  draw(scene: Scene, camera: PerspectiveCamera, glitch: GlitchFrame): boolean {
    if (!glitch.active) {
      this.wasActive = false;
      this.intensity = 0;
      this.bands = [];
      this.lastBurst = Number.NaN;
      return this.renderer.render(scene, camera);
    }
    if (!this.renderer.prepare(camera)) {
      return false;
    }
    this.wasActive = true;
    this.intensity = glitch.envelope;
    this.bands = glitch.bands;
    const webgl = this.renderer.webgl;
    this.renewAfterContextLoss();
    this.fitToScreen();
    if (glitch.burstStart !== this.lastBurst) {
      this.lastBurst = glitch.burstStart;
      this.stepsThisBurst = 0;
      this.lastStep = -1;
    }
    webgl.setRenderTarget(this.target);
    webgl.render(scene, camera);
    // Counted with the scene: the frame's stats (draw calls, triangles) keep the scene's numbers
    // plus the quad's, rather than being reset to the quad alone.
    const autoReset = webgl.info.autoReset;
    webgl.info.autoReset = false;
    if (glitch.step !== this.lastStep) {
      // A new tear pattern: the afterimage is the frame as it is now.
      this.snapshot();
      this.lastStep = glitch.step;
      this.stepsThisBurst++;
    }
    webgl.setRenderTarget(null);
    const u = this.material.uniforms;
    const p = glitch.params;
    (u.uIntensity as { value: number }).value = glitch.envelope;
    (u.uShift as { value: number }).value = p.maxShift;
    (u.uChroma as { value: number }).value = p.chroma;
    (u.uGhost as { value: number }).value = p.ghost;
    (u.uResolution as { value: Vector2 }).value.copy(this.size);
    const bands = (u.uBands as { value: Vector4[] }).value;
    bands.forEach((b, i) => {
      const t = glitch.bands[i];
      b.set(t?.center ?? 0, t?.halfHeight ?? 0, t?.shift ?? 0, t ? 1 : 0);
    });
    webgl.render(this.scene, this.camera);
    webgl.info.autoReset = autoReset;
    this.framesDrawn++;
    return true;
  }

  dispose(): void {
    this.target.dispose();
    this.history.dispose();
    this.material.dispose();
    (this.scene.children[0] as Mesh | undefined)?.geometry.dispose();
  }

  /**
   * Copies the target into the history: the same quad with no glitch (intensity 0 draws its input
   * unchanged), reading the target in place of the history so nothing samples what it draws to.
   * The same program as the glitched draw, so nothing new compiles; no read of the screen.
   */
  private snapshot(): void {
    const webgl = this.renderer.webgl;
    const u = this.material.uniforms;
    (u.uIntensity as { value: number }).value = 0;
    (u.uGhost as { value: number }).value = 0;
    (u.tHistory as { value: Texture }).value = this.target.texture;
    webgl.setRenderTarget(this.history);
    webgl.render(this.scene, this.camera);
    (u.tHistory as { value: Texture }).value = this.history.texture;
  }

  /**
   * After a context loss, fresh targets. The old ones' GPU objects died with the old context, but
   * three's dispose listeners on them still point at it: resizing or disposing them would delete
   * objects of a dead context (WebGL warns). They are dropped without disposing.
   */
  private renewAfterContextLoss(): void {
    const generation = this.renderer.context.lossCount;
    if (generation === this.generation) {
      return;
    }
    this.generation = generation;
    this.target = makeTarget(true);
    this.history = makeTarget(false);
    const u = this.material.uniforms;
    (u.tFrame as { value: Texture }).value = this.target.texture;
    (u.tHistory as { value: Texture }).value = this.history.texture;
  }

  /** Keeps both targets at the drawing-buffer size (a resize reallocates them on next use). */
  private fitToScreen(): void {
    this.renderer.webgl.getDrawingBufferSize(this.size);
    const width = Math.max(1, this.size.x);
    const height = Math.max(1, this.size.y);
    if (width !== this.target.width || height !== this.target.height) {
      this.target.setSize(width, height);
      this.history.setSize(width, height);
    }
  }
}

function makeTarget(depthBuffer: boolean): WebGLRenderTarget {
  const target = new WebGLRenderTarget(1, 1, {
    colorSpace: SRGBColorSpace,
    // Plain storage: the scene's shaders already write display-ready (sRGB-encoded) values.
    internalFormat: 'RGBA8',
    minFilter: NearestFilter,
    magFilter: NearestFilter,
    depthBuffer,
    generateMipmaps: false,
  });
  // The screen's tone mapping and output encoding, so the scene's programs are the screen's.
  Object.assign(target, { isXRRenderTarget: true });
  return target;
}
