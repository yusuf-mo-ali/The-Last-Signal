/**
 * STATIC's interference (D-045): a layer of signal noise over the 3D view during a burst. The
 * simulation decides when bursts happen (`ScreenEffects`); this only draws the current one.
 *
 * It never hides what the player needs:
 * - it sits directly above the canvas and below every HUD element (DOM order), so the crosshair,
 *   hit markers, damage numbers, health, ammo, wave readout and mutation badge stay on top and
 *   untouched;
 * - it is at most `EFFECT_CLAMPS.static.opacity` opaque, and the centre around the crosshair is
 *   kept almost clear (a radial mask);
 * - its jitter steps at most 3 times a second (photosensitivity); with `prefers-reduced-motion`
 *   it doesn't move at all;
 * - it doesn't block the mouse (`pointer-events: none`).
 *
 * The noise texture is drawn once (seeded), so a burst costs a CSS opacity change, nothing more.
 */

import type { ScreenBurst } from '../modifiers/ScreenEffects';
import { Rng } from '../utils/Rng';

/** Seconds a burst takes to reach full strength, and to fade. */
const ATTACK = 0.06;
const RELEASE = 0.12;

export class StaticOverlay {
  readonly element: HTMLElement;
  private lastOpacity = -1;

  /** `anchor`: the game canvas (the layer goes right after it, under the HUD). */
  constructor(anchor: Element) {
    const doc = anchor.ownerDocument;
    this.element = doc.createElement('div');
    this.element.className = 'static-overlay';
    this.element.style.opacity = '0';
    this.element.dataset.active = 'false';
    const reduced =
      doc.defaultView?.matchMedia('(prefers-reduced-motion: reduce)').matches ?? false;
    if (reduced) {
      this.element.classList.add('static-overlay--still');
    }
    const canvas = doc.createElement('canvas');
    canvas.className = 'static-overlay__noise';
    canvas.width = 160;
    canvas.height = 90;
    drawNoise(canvas);
    this.element.appendChild(canvas);
    anchor.after(this.element);
  }

  /** Once per frame: `now` is the simulated time bursts are measured in. */
  update(burst: ScreenBurst | null, now: number, visible: boolean): void {
    let opacity = 0;
    if (visible && burst && now < burst.until) {
      const envelope = Math.min(1, (now - burst.start) / ATTACK, (burst.until - now) / RELEASE);
      opacity = Math.max(0, burst.intensity * envelope);
    }
    const rounded = Math.round(opacity * 100) / 100;
    if (rounded !== this.lastOpacity) {
      this.lastOpacity = rounded;
      this.element.style.opacity = String(rounded);
      this.element.dataset.active = String(rounded > 0);
      this.element.dataset.opacity = String(rounded);
    }
  }

  dispose(): void {
    this.element.remove();
  }
}

/** Grey noise with a few torn horizontal bands, drawn once. */
function drawNoise(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return; // no 2D canvas (headless tests): the layer is simply empty
  }
  const rng = new Rng('static-noise');
  const image = ctx.createImageData(canvas.width, canvas.height);
  const tears = new Set<number>();
  for (let i = 0; i < 6; i++) {
    tears.add(rng.int(0, canvas.height - 1));
  }
  for (let y = 0; y < canvas.height; y++) {
    const tear = tears.has(y);
    for (let x = 0; x < canvas.width; x++) {
      const i = (y * canvas.width + x) * 4;
      // Mid-grey grain (never pure white or black) and a few lighter tear lines.
      const v = tear ? 170 + rng.int(0, 40) : 70 + rng.int(0, 110);
      image.data[i] = v;
      image.data[i + 1] = v;
      image.data[i + 2] = v;
      image.data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
}
