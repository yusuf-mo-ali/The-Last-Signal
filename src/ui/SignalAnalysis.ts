/**
 * SIGNAL ANALYSIS (D-026, D-047, GAME_DESIGN §10): after a wave, what the horde learned about how
 * the player plays and what it does about it. Shown in the breather only (`WAVE_COMPLETE`, later the
 * upgrade screen), never during a wave: the player learns between waves, and nothing marks an
 * adapted enemy mid-fight.
 *
 * One line per change: an adaptation entering, escalating, fading or resting, or the strain
 * governor holding the horde back. A wave that changed nothing shows nothing. DOM writes happen only
 * when the content changes; `data-*` attributes let automated checks read it in any build.
 */

import type { AdaptiveSystem } from '../adaptive/AdaptiveSystem';
import type { AdaptationChange } from '../adaptive/types';
import type { GameStateMachine } from '../core/GameState';

export class SignalAnalysis {
  readonly root: HTMLElement;
  private readonly list: HTMLElement;
  private readonly state: GameStateMachine;
  private readonly unsubscribe: (() => void)[] = [];
  private changes: readonly AdaptationChange[] = [];
  private wave = 0;
  private last = '';

  constructor(container: HTMLElement, adaptive: AdaptiveSystem, state: GameStateMachine) {
    this.state = state;
    const doc = container.ownerDocument;
    this.root = doc.createElement('div');
    this.root.className = 'signal-analysis';
    this.root.hidden = true;
    const title = doc.createElement('div');
    title.className = 'signal-analysis__title';
    title.textContent = 'SIGNAL ANALYSIS';
    this.root.appendChild(title);
    this.list = doc.createElement('div');
    this.list.className = 'signal-analysis__lines';
    this.root.appendChild(this.list);
    container.appendChild(this.root);
    this.unsubscribe.push(
      adaptive.events.on('adaptationDecided', (e) => {
        this.changes = e.changes;
        this.wave = e.wave;
      }),
      adaptive.events.on('adaptationReset', () => {
        this.changes = [];
      }),
      state.onEnter('WAVE_START', () => {
        this.changes = [];
      }),
    );
  }

  /** Once per frame. `visible`: the HUD is on screen. */
  update(visible: boolean): void {
    const between = this.state.isIn('WAVE_COMPLETE') || this.state.isIn('UPGRADE_SELECTION');
    const show = visible && between && this.changes.length > 0;
    const key = show
      ? `${this.wave}|${this.changes.map((c) => `${c.id}:${c.kind}`).join(',')}`
      : '';
    if (key === this.last) {
      return;
    }
    this.last = key;
    this.root.hidden = !show;
    this.root.dataset.wave = show ? String(this.wave) : '';
    this.root.dataset.changes = show ? this.changes.map((c) => `${c.id}:${c.kind}`).join(',') : '';
    this.list.replaceChildren();
    if (!show) {
      return;
    }
    const doc = this.root.ownerDocument;
    for (const c of this.changes) {
      const line = doc.createElement('div');
      line.className = `signal-analysis__line signal-analysis__line--${c.kind}`;
      line.dataset.id = c.id;
      line.dataset.kind = c.kind;
      line.textContent = c.text;
      this.list.appendChild(line);
    }
  }

  dispose(): void {
    for (const off of this.unsubscribe) {
      off();
    }
    this.root.remove();
  }
}
