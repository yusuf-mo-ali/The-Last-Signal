/**
 * WebGL2 renderer foundation (D-001): owns the three.js WebGLRenderer and its canvas, and keeps
 * the drawing buffer matched to the container.
 *
 * Resizing is robust to everything that changes the pixel size of the canvas:
 * - container/layout changes and window resizes (ResizeObserver on the container),
 * - device pixel ratio changes from browser zoom or moving to another monitor (a media query
 *   that is re-armed for each new ratio).
 * Changes only mark the renderer dirty; the new size is applied once, at the start of the next
 * `render`, so a burst of resize events never resizes the GPU buffers more than once per frame.
 * A collapsed or hidden container (0 × 0) skips rendering instead of producing WebGL errors.
 */

import { ACESFilmicToneMapping, WebGLRenderer, type PerspectiveCamera, type Scene } from 'three';
import { computeViewport, sameViewport, type Viewport } from './viewport';

export interface RendererOptions {
  /** Cap on the device pixel ratio (ARCHITECTURE.md §8). Default 2. */
  readonly maxPixelRatio?: number;
  /** Resolution multiplier (1 = native). Default 1. A settings option later. */
  readonly renderScale?: number;
  /** MSAA on the default framebuffer. Default true. */
  readonly antialias?: boolean;
  /** Enable the shadow map (at most 2 shadow casters, D-022). Default true. */
  readonly shadows?: boolean;
}

export const RENDERER_DEFAULTS = {
  maxPixelRatio: 2,
  renderScale: 1,
  antialias: true,
  shadows: true,
} as const satisfies Required<RendererOptions>;

/** True if the browser can create a WebGL2 context (three.js requires WebGL2). */
export function isWebGL2Available(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    // Release the probe context immediately; browsers limit live contexts per page.
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return gl !== null;
  } catch {
    return false;
  }
}

export class Renderer {
  readonly webgl: WebGLRenderer;
  readonly canvas: HTMLCanvasElement;

  private readonly container: HTMLElement;
  private readonly maxPixelRatio: number;
  private renderScale: number;
  private current: Viewport;
  private dirty = true;
  private resizeCount = 0;

  private readonly resizeObserver: ResizeObserver;
  private pixelRatioQuery: MediaQueryList | null = null;

  constructor(container: HTMLElement, options: RendererOptions = {}) {
    this.container = container;
    this.maxPixelRatio = options.maxPixelRatio ?? RENDERER_DEFAULTS.maxPixelRatio;
    this.renderScale = options.renderScale ?? RENDERER_DEFAULTS.renderScale;

    this.webgl = new WebGLRenderer({
      antialias: options.antialias ?? RENDERER_DEFAULTS.antialias,
      powerPreference: 'high-performance',
    });
    this.webgl.toneMapping = ACESFilmicToneMapping;
    this.webgl.shadowMap.enabled = options.shadows ?? RENDERER_DEFAULTS.shadows;

    this.canvas = this.webgl.domElement;
    this.canvas.classList.add('game-canvas');
    container.appendChild(this.canvas);

    this.current = this.measure();
    this.resizeObserver = new ResizeObserver(this.markDirty);
    this.resizeObserver.observe(container);
    this.watchPixelRatio();
  }

  /** The viewport the renderer is currently configured for. */
  get viewport(): Viewport {
    return this.current;
  }

  /** How many times the drawing buffer has actually been resized (including the first). */
  get resizes(): number {
    return this.resizeCount;
  }

  setRenderScale(scale: number): void {
    this.renderScale = scale;
    this.dirty = true;
  }

  /**
   * Draws `scene` from `camera`, first applying any pending resize and syncing the camera's
   * aspect ratio. Returns false (and draws nothing) while the container has no area.
   */
  render(scene: Scene, camera: PerspectiveCamera): boolean {
    if (this.dirty) {
      this.applySize();
    }
    if (!this.current.drawable) {
      return false;
    }
    if (camera.aspect !== this.current.aspect) {
      camera.aspect = this.current.aspect;
      camera.updateProjectionMatrix();
    }
    this.webgl.render(scene, camera);
    return true;
  }

  dispose(): void {
    this.resizeObserver.disconnect();
    this.pixelRatioQuery?.removeEventListener('change', this.onPixelRatioChange);
    this.pixelRatioQuery = null;
    this.webgl.dispose();
    this.canvas.remove();
  }

  private readonly markDirty = (): void => {
    this.dirty = true;
  };

  private readonly onPixelRatioChange = (): void => {
    this.dirty = true;
    this.watchPixelRatio();
  };

  /** Listens for the device pixel ratio moving away from its current value. */
  private watchPixelRatio(): void {
    this.pixelRatioQuery?.removeEventListener('change', this.onPixelRatioChange);
    this.pixelRatioQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    this.pixelRatioQuery.addEventListener('change', this.onPixelRatioChange);
  }

  private measure(): Viewport {
    return computeViewport({
      cssWidth: this.container.clientWidth,
      cssHeight: this.container.clientHeight,
      devicePixelRatio: window.devicePixelRatio,
      maxPixelRatio: this.maxPixelRatio,
      renderScale: this.renderScale,
    });
  }

  private applySize(): void {
    this.dirty = false;
    const next = this.measure();
    if (this.resizeCount > 0 && sameViewport(next, this.current)) {
      return;
    }
    this.current = next;
    if (!next.drawable) {
      return;
    }
    this.webgl.setPixelRatio(next.pixelRatio);
    // `false`: CSS sizes the canvas (100% of the container); only the drawing buffer changes.
    this.webgl.setSize(next.width, next.height, false);
    this.resizeCount++;
  }
}
