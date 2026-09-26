/**
 * Minimal health readout (Phase 4 placeholder until the UI phase, plan §22, GAME_DESIGN §14):
 * the player's health and a bar in the bottom-left corner, and a brief red vignette when the
 * player is hurt. It only reads `PlayerHealth` and listens to its events; the full HUD (low-health
 * vignette and heartbeat, damage direction) arrives with the UI and audio phases.
 *
 * The root carries `data-health`, `data-max` and `data-state` (alive / dead) so automated checks
 * can read it in any build. DOM writes happen only when a value changes.
 */

import type { PlayerHealth } from '../player/PlayerHealth';

/** Seconds the damage vignette takes to fade. */
const FLASH_TIME = 0.45;

export class HealthHud {
  readonly element: HTMLElement;
  private readonly value: HTMLElement;
  private readonly bar: HTMLElement;
  private readonly flash: HTMLElement;
  private readonly health: PlayerHealth;
  private readonly unsubscribe: () => void;
  private flashTimer = 0;
  private lastKey = '';
  private lastFlash = -1;

  constructor(container: HTMLElement, health: PlayerHealth) {
    this.health = health;
    const doc = container.ownerDocument;
    this.flash = doc.createElement('div');
    this.flash.className = 'damage-flash';
    this.flash.style.opacity = '0';
    this.element = doc.createElement('div');
    this.element.className = 'health-hud';
    this.element.hidden = true;
    const label = doc.createElement('span');
    label.className = 'health-hud__label';
    label.textContent = 'HEALTH';
    this.value = doc.createElement('span');
    this.value.className = 'health-hud__value';
    const track = doc.createElement('div');
    track.className = 'health-hud__track';
    this.bar = doc.createElement('div');
    this.bar.className = 'health-hud__bar';
    track.appendChild(this.bar);
    this.element.append(label, this.value, track);
    container.append(this.flash, this.element);
    this.unsubscribe = health.events.on('damaged', () => {
      this.flashTimer = FLASH_TIME;
    });
  }

  /** Once per frame. `dt`: simulated seconds (the flash holds while paused). */
  update(dt: number, visible: boolean): void {
    this.flashTimer = Math.max(0, this.flashTimer - dt);
    const flash = Math.round((this.flashTimer / FLASH_TIME) * 100) / 100;
    if (flash !== this.lastFlash) {
      this.lastFlash = flash;
      this.flash.style.opacity = String(flash);
    }
    const { current, max, isDead } = this.health;
    const shown = Math.ceil(current);
    const key = `${visible}|${shown}|${max}|${isDead}`;
    if (key === this.lastKey) {
      return;
    }
    this.lastKey = key;
    this.element.hidden = !visible;
    this.element.dataset.health = String(shown);
    this.element.dataset.max = String(max);
    this.element.dataset.state = isDead ? 'dead' : 'alive';
    this.value.textContent = String(shown);
    this.bar.style.width = `${Math.max(0, Math.min(1, current / max)) * 100}%`;
  }

  dispose(): void {
    this.unsubscribe();
    this.element.remove();
    this.flash.remove();
  }
}
