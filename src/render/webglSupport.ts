/**
 * WebGL2 capability check (D-001: three.js requires WebGL2). The canvas factory is injected, so the
 * decision logic is unit-tested in Node; `main.ts` passes `() => document.createElement('canvas')`.
 */

/** The parts of a canvas / WebGL2 context the probe touches. */
export interface ProbeCanvas {
  getContext(contextId: 'webgl2'): ProbeContext | null;
}
export interface ProbeContext {
  getExtension(name: 'WEBGL_lose_context'): { loseContext(): void } | null;
}

export type WebGL2Support =
  | { readonly supported: true }
  | {
      readonly supported: false;
      /** `no-context`: the browser/GPU offers no WebGL2. `error`: creating the probe threw. */
      readonly reason: 'no-context' | 'error';
      readonly error?: unknown;
    };

export function detectWebGL2(createCanvas: () => ProbeCanvas): WebGL2Support {
  try {
    const gl = createCanvas().getContext('webgl2');
    if (gl === null) {
      return { supported: false, reason: 'no-context' };
    }
    // Release the probe context immediately: browsers cap live contexts per page.
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return { supported: true };
  } catch (error) {
    return { supported: false, reason: 'error', error };
  }
}
