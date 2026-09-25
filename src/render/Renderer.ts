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
 *
 * WebGL context loss (D-035): while the context is lost, `render` draws nothing and returns false;
 * the simulation keeps its state. On restoration the drawing buffer is re-applied and listeners are
 * told, so views can re-compile their shaders.
 */

import { ACESFilmicToneMapping, WebGLRenderer, type PerspectiveCamera, type Scene } from 'three';
import { ENGINE_CONFIG, type RenderConfig } from '../core/Config';
import { ContextLossMonitor } from './ContextLossMonitor';
import { computeViewport, sameViewport, type Viewport } from './viewport';

/** Overrides for `ENGINE_CONFIG.render` (defaults documented there). */
export type RendererOptions = Partial<RenderConfig>;

export class Renderer {
  readonly webgl: WebGLRenderer;
  readonly canvas: HTMLCanvasElement;

  private readonly container: HTMLElement;
  private readonly maxPixelRatio: number;
  private renderScale: number;
  private current: Viewport;
  private dirty = true;
  private forceResize = false;
  private resizeCount = 0;

  /** WebGL context loss and restoration on the canvas. */
  readonly context: ContextLossMonitor;

  private readonly resizeObserver: ResizeObserver;
  private pixelRatioQuery: MediaQueryList | null = null;

  constructor(container: HTMLElement, options: RendererOptions = {}) {
    this.container = container;
    const config = { ...ENGINE_CONFIG.render, ...options };
    this.maxPixelRatio = config.maxPixelRatio;
    this.renderScale = config.renderScale;

    this.webgl = new WebGLRenderer({
      antialias: config.antialias,
      powerPreference: 'high-performance',
    });
    this.webgl.toneMapping = ACESFilmicToneMapping;
    this.webgl.shadowMap.enabled = config.shadows;

    this.canvas = this.webgl.domElement;
    this.canvas.classList.add('game-canvas');
    container.appendChild(this.canvas);

    this.context = new ContextLossMonitor(this.canvas, {
      restoreTimeoutMs: config.contextRestoreTimeoutMs,
    });
    this.context.onChange((event) => {
      if (event.type === 'restored') {
        // The new context has default state: re-apply the drawing buffer size and pixel ratio.
        this.forceResize = true;
        this.dirty = true;
      }
    });

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
   * aspect ratio. Returns false (and draws nothing) while the container has no area or the WebGL
   * context is lost.
   */
  render(scene: Scene, camera: PerspectiveCamera): boolean {
    if (this.context.lost) {
      return false;
    }
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
    this.context.dispose();
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
    const force = this.forceResize;
    this.forceResize = false;
    if (!force && this.resizeCount > 0 && sameViewport(next, this.current)) {
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
