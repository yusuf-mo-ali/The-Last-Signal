import { describe, expect, it } from 'vitest';
import { computeViewport, sameViewport, type ViewportInput } from './viewport';

const BASE: ViewportInput = {
  cssWidth: 1920,
  cssHeight: 1080,
  devicePixelRatio: 1,
  maxPixelRatio: 2,
  renderScale: 1,
};

function viewport(overrides: Partial<ViewportInput>) {
  return computeViewport({ ...BASE, ...overrides });
}

describe('computeViewport', () => {
  it.each([
    [1920, 1080],
    [1600, 900],
    [1366, 768],
    [1280, 720],
    [800, 600],
  ])('sizes the buffer 1:1 at %i x %i on a standard display', (cssWidth, cssHeight) => {
    const v = viewport({ cssWidth, cssHeight });
    expect(v).toMatchObject({
      width: cssWidth,
      height: cssHeight,
      pixelRatio: 1,
      bufferWidth: cssWidth,
      bufferHeight: cssHeight,
      drawable: true,
    });
    expect(v.aspect).toBeCloseTo(cssWidth / cssHeight);
  });

  it('renders at native resolution on a HiDPI display', () => {
    const v = viewport({ devicePixelRatio: 2 });
    expect(v.pixelRatio).toBe(2);
    expect(v.bufferWidth).toBe(3840);
    expect(v.bufferHeight).toBe(2160);
  });

  it('caps the device pixel ratio at maxPixelRatio', () => {
    const v = viewport({ cssWidth: 1280, cssHeight: 800, devicePixelRatio: 3 });
    expect(v.pixelRatio).toBe(2);
    expect(v.bufferWidth).toBe(2560);
  });

  it('supports fractional pixel ratios from browser zoom (e.g. 125%)', () => {
    const v = viewport({ cssWidth: 1536, cssHeight: 864, devicePixelRatio: 1.25 });
    expect(v.pixelRatio).toBe(1.25);
    expect(v.bufferWidth).toBe(1920);
    expect(v.bufferHeight).toBe(1080);
  });

  it('applies the render scale after the cap', () => {
    const v = viewport({ devicePixelRatio: 3, renderScale: 0.5 });
    expect(v.pixelRatio).toBe(1);
    expect(v.bufferWidth).toBe(1920);
  });

  it('never lets the render scale shrink the buffer to nothing', () => {
    const v = viewport({ cssWidth: 100, cssHeight: 100, renderScale: 0.001 });
    expect(v.pixelRatio).toBe(0.25);
    expect(v.bufferWidth).toBe(25);
  });

  it('floors fractional CSS sizes to whole pixels', () => {
    const v = viewport({ cssWidth: 1365.6, cssHeight: 767.4, devicePixelRatio: 1.5 });
    expect(v.width).toBe(1365);
    expect(v.height).toBe(767);
    expect(v.bufferWidth).toBe(Math.floor(1365 * 1.5));
    expect(v.bufferHeight).toBe(Math.floor(767 * 1.5));
  });

  it('stays usable for very small windows', () => {
    const v = viewport({ cssWidth: 320, cssHeight: 180 });
    expect(v.drawable).toBe(true);
    expect(v.aspect).toBeCloseTo(16 / 9);
  });

  it.each([
    ['collapsed', 0, 0],
    ['zero width', 0, 600],
    ['zero height', 800, 0],
    ['negative', -5, 100],
    ['NaN', Number.NaN, 100],
    ['infinite', Number.POSITIVE_INFINITY, 100],
  ])('is not drawable when the container is %s, with a finite aspect', (_, cssWidth, cssHeight) => {
    const v = viewport({ cssWidth, cssHeight });
    expect(v.drawable).toBe(false);
    expect(v.aspect).toBe(1);
    expect(Number.isFinite(v.bufferWidth)).toBe(true);
    expect(Number.isFinite(v.bufferHeight)).toBe(true);
  });

  it('falls back to safe values for invalid ratios and scales', () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(viewport({ devicePixelRatio: bad }).pixelRatio).toBe(1);
      expect(viewport({ renderScale: bad }).pixelRatio).toBe(1);
      expect(viewport({ devicePixelRatio: 2, maxPixelRatio: bad }).pixelRatio).toBe(1);
    }
  });
});

describe('sameViewport', () => {
  it('detects changes in size or pixel ratio only', () => {
    const a = viewport({});
    expect(sameViewport(a, viewport({}))).toBe(true);
    expect(sameViewport(a, viewport({ cssWidth: 1919.5 }))).toBe(false);
    expect(sameViewport(a, viewport({ devicePixelRatio: 1.5 }))).toBe(false);
    // Sub-pixel layout jitter that floors to the same size is not a change.
    expect(sameViewport(a, viewport({ cssWidth: 1920.4 }))).toBe(true);
  });
});
