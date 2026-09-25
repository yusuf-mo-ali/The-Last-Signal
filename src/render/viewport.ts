/**
 * Pure viewport math for the renderer: CSS size + device pixel ratio → drawing-buffer size.
 * Kept free of DOM and WebGL so it can be unit-tested in Node.
 */

export interface ViewportInput {
  /** Container size in CSS pixels (may be fractional, zero, or garbage during layout). */
  readonly cssWidth: number;
  readonly cssHeight: number;
  /** `window.devicePixelRatio`; changes with browser zoom and when moving between monitors. */
  readonly devicePixelRatio: number;
  /** Upper bound on the device pixel ratio (ARCHITECTURE.md §8: 2). */
  readonly maxPixelRatio: number;
  /** Resolution multiplier for performance (1 = native, 0.5 = half resolution). */
  readonly renderScale: number;
}

export interface Viewport {
  /** Size in whole CSS pixels. Zero when the container is collapsed or hidden. */
  readonly width: number;
  readonly height: number;
  /** Pixel ratio handed to the renderer: capped device pixel ratio × render scale. */
  readonly pixelRatio: number;
  /** Size of the WebGL drawing buffer in device pixels. */
  readonly bufferWidth: number;
  readonly bufferHeight: number;
  /** width / height, or 1 when either is zero (keeps the camera projection finite). */
  readonly aspect: number;
  /** False when there is nothing to draw into; the renderer skips the frame. */
  readonly drawable: boolean;
}

/** Smallest pixel ratio accepted, so a tiny render scale can never produce an empty buffer. */
const MIN_PIXEL_RATIO = 0.25;

export function computeViewport(input: ViewportInput): Viewport {
  const width = toWholePixels(input.cssWidth);
  const height = toWholePixels(input.cssHeight);

  const dpr = isPositiveFinite(input.devicePixelRatio) ? input.devicePixelRatio : 1;
  const cap = isPositiveFinite(input.maxPixelRatio) ? input.maxPixelRatio : 1;
  const scale = isPositiveFinite(input.renderScale) ? input.renderScale : 1;
  const pixelRatio = Math.max(MIN_PIXEL_RATIO, Math.min(dpr, cap) * scale);

  const drawable = width > 0 && height > 0;
  return {
    width,
    height,
    pixelRatio,
    // Matches three.js WebGLRenderer.setSize, which floors width × pixelRatio.
    bufferWidth: Math.floor(width * pixelRatio),
    bufferHeight: Math.floor(height * pixelRatio),
    aspect: drawable ? width / height : 1,
    drawable,
  };
}

/** True if two viewports would configure the renderer identically. */
export function sameViewport(a: Viewport, b: Viewport): boolean {
  return a.width === b.width && a.height === b.height && a.pixelRatio === b.pixelRatio;
}

function toWholePixels(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function isPositiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}
