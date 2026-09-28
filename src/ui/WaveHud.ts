/**
 * Minimal wave readout (Phase 6 placeholder until the UI phase, GAME_DESIGN §14): `WAVE 7 · 12
 * LEFT` in the top-left corner while a run is played, and a banner in the middle of the screen at
 * the start of a wave ("WAVE 7") and when it is cleared ("WAVE 7 CLEARED", with the breather's
 * countdown). It only reads the wave runtime's status; DOM writes happen only when a value changes.
 *
 * The root carries `data-wave`, `data-remaining` and `data-phase` (intro / active / cleared /
 * idle), and the banner `data-text`, so automated checks can read them in any build.
 */

import type { WaveManager } from '../waves/WaveManager';

type Phase = 'idle' | 'intro' | 'active' | 'cleared';

export class WaveHud {
  readonly element: HTMLElement;
  readonly banner: HTMLElement;
  private readonly waves: WaveManager;
  private lastKey = '';
  private lastBanner = '';

  constructor(container: HTMLElement, waves: WaveManager) {
    this.waves = waves;
    const doc = container.ownerDocument;
    this.element = doc.createElement('div');
    this.element.className = 'wave-hud';
    this.element.hidden = true;
    this.element.dataset.phase = 'idle';
    this.banner = doc.createElement('div');
    this.banner.className = 'wave-banner';
    this.banner.hidden = true;
    container.append(this.element, this.banner);
  }

  /** Once per frame. `visible`: the HUD is on screen (a run is being played, mouse captured). */
  update(visible: boolean): void {
    const s = this.waves.status;
    const phase: Phase =
      !this.waves.isAttached || s.wave === 0
        ? 'idle'
        : s.state === 'WAVE_START'
          ? 'intro'
          : s.state === 'WAVE_ACTIVE' || s.state === 'BOSS'
            ? 'active'
            : s.state === 'WAVE_COMPLETE' || s.state === 'UPGRADE_SELECTION'
              ? 'cleared'
              : 'idle';
    const shown = visible && phase !== 'idle';
    const text = phase === 'active' ? `WAVE ${s.wave} · ${s.remaining} LEFT` : `WAVE ${s.wave}`;
    const key = `${shown}|${phase}|${text}`;
    if (key !== this.lastKey) {
      this.lastKey = key;
      this.element.hidden = !shown;
      this.element.textContent = text;
      this.element.dataset.phase = phase;
      this.element.dataset.wave = String(s.wave);
      this.element.dataset.remaining = String(s.remaining);
    }
    const banner = !shown
      ? ''
      : phase === 'intro'
        ? `WAVE ${s.wave}`
        : phase === 'cleared'
          ? `WAVE ${s.wave} CLEARED · NEXT WAVE IN ${Math.ceil(s.timer)}`
          : '';
    if (banner !== this.lastBanner) {
      this.lastBanner = banner;
      this.banner.hidden = banner === '';
      this.banner.textContent = banner;
      this.banner.dataset.text = banner;
    }
  }

  dispose(): void {
    this.element.remove();
    this.banner.remove();
  }
}
