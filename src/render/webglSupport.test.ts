import { describe, expect, it, vi } from 'vitest';
import { detectWebGL2, type ProbeCanvas } from './webglSupport';

describe('detectWebGL2', () => {
  it('reports support and releases the probe context', () => {
    const loseContext = vi.fn();
    const canvas: ProbeCanvas = {
      getContext: () => ({ getExtension: () => ({ loseContext }) }),
    };
    expect(detectWebGL2(() => canvas)).toEqual({ supported: true });
    expect(loseContext).toHaveBeenCalledOnce();
  });

  it('still reports support when WEBGL_lose_context is unavailable', () => {
    const canvas: ProbeCanvas = { getContext: () => ({ getExtension: () => null }) };
    expect(detectWebGL2(() => canvas)).toEqual({ supported: true });
  });

  it('reports no-context when the browser offers no WebGL2', () => {
    const canvas: ProbeCanvas = { getContext: () => null };
    expect(detectWebGL2(() => canvas)).toEqual({ supported: false, reason: 'no-context' });
  });

  it('reports error, with the cause, when probing throws', () => {
    const cause = new Error('GPU process crashed');
    const result = detectWebGL2(() => {
      throw cause;
    });
    expect(result).toEqual({ supported: false, reason: 'error', error: cause });
  });
});
