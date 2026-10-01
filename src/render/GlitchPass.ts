/**
 * Signal Glitch on screen (D-046): during a STATIC burst, the rendered 3D image tears into
 * horizontal bands that slip sideways, splits its red and blue a little, and keeps an afterimage
 * of a moment ago. Only during a burst: otherwise nothing here runs and the frame is the plain one.
 *
 * How (cheap, and no new scene shaders):
 * - the scene is rendered to the screen as usual;
 * - the frame is copied into a texture (`copyFramebufferToTexture`), and, each time the tear
 *   pattern steps (at most 3 times a second), into a second one, the afterimage;
 * - one full-screen quad samples them with the glitch and draws over the frame.
 * Rendering the scene into a render target instead would need a second program for every scene
 * material (tone mapping and colour space differ off-screen), compiled mid-fight. The quad's one
 * program is compiled at load (`prewarm`), so program ids never change (D-022).
 *
 * The centre around the crosshair stays clear (a radial mask, `GLITCH_CLEAR`); the HUD is DOM
 * above the canvas and never glitched. Reduced motion: no tears or afterimage, a slight colour
 * split only (see `glitchFrame`).
 */

import {
  FramebufferTexture,
  Mesh,
  NearestFilter,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Vector2,
  Vector4,
} from 'three';
import type { Renderer } from './Renderer';
import { GLITCH_CLEAR, type GlitchFrame } from './glitch';

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
}

export class GlitchPass {
  private readonly renderer: Renderer;
  private readonly scene = new Scene();
  private readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly material: ShaderMaterial;
  private readonly size = new Vector2();
  private frame: FramebufferTexture;
  private history: FramebufferTexture;
  private lastBurst = Number.NaN;
  private lastStep = -1;
  private stepsThisBurst = 0;
  private framesDrawn = 0;
  private wasActive = false;
  private intensity = 0;

  constructor(renderer: Renderer) {
    this.renderer = renderer;
    this.frame = makeTexture(1, 1);
    this.history = makeTexture(1, 1);
    this.material = new ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: {
        tFrame: { value: this.frame },
        tHistory: { value: this.history },
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
    };
  }

  /** Compiles the quad's program now (load, context restore), never mid-fight. */
  prewarm(): void {
    this.renderer.webgl.compile(this.scene, this.camera);
  }

  /**
   * Glitches the frame just rendered to the screen. Call right after the scene render, every
   * frame; with an idle `glitch` it does nothing.
   */
  apply(glitch: GlitchFrame): void {
    this.wasActive = glitch.active;
    this.intensity = glitch.envelope;
    if (!glitch.active) {
      this.lastBurst = Number.NaN;
      return;
    }
    const webgl = this.renderer.webgl;
    webgl.getDrawingBufferSize(this.size);
    if (this.size.x !== this.frame.image.width || this.size.y !== this.frame.image.height) {
      this.resize(this.size.x, this.size.y);
    }
    const newBurst = glitch.burstStart !== this.lastBurst;
    if (newBurst) {
      this.lastBurst = glitch.burstStart;
      this.stepsThisBurst = 0;
      this.lastStep = -1;
    }
    if (glitch.step !== this.lastStep) {
      // A new tear pattern: the afterimage is the frame as it is now.
      webgl.copyFramebufferToTexture(this.history);
      this.lastStep = glitch.step;
      this.stepsThisBurst++;
    }
    webgl.copyFramebufferToTexture(this.frame);
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
    // Over the frame, and counted with it: the frame's stats (draw calls, triangles) keep the
    // scene's numbers plus the quad's, rather than being reset to the quad alone.
    const autoClear = webgl.autoClear;
    const autoReset = webgl.info.autoReset;
    webgl.autoClear = false;
    webgl.info.autoReset = false;
    webgl.render(this.scene, this.camera);
    webgl.autoClear = autoClear;
    webgl.info.autoReset = autoReset;
    this.framesDrawn++;
  }

  dispose(): void {
    this.frame.dispose();
    this.history.dispose();
    this.material.dispose();
    (this.scene.children[0] as Mesh | undefined)?.geometry.dispose();
  }

  private resize(width: number, height: number): void {
    this.frame.dispose();
    this.history.dispose();
    this.frame = makeTexture(width, height);
    this.history = makeTexture(width, height);
    (this.material.uniforms.tFrame as { value: FramebufferTexture }).value = this.frame;
    (this.material.uniforms.tHistory as { value: FramebufferTexture }).value = this.history;
  }
}

function makeTexture(width: number, height: number): FramebufferTexture {
  const texture = new FramebufferTexture(width, height);
  texture.minFilter = NearestFilter;
  texture.magFilter = NearestFilter;
  return texture;
}
