/**
 * Minimal weapon HUD (Phase 2 placeholder until the UI phase, plan §22): a crosshair and the held
 * weapon's name and ammunition. The loadout strip (Primary, Secondary with its lock, Melee) arrives
 * with the full HUD (GAME_DESIGN §14). DOM writes happen only when a value changes.
 */

import type { WeaponStatus } from '../weapons/types';

export interface WeaponHudState {
  readonly visible: boolean;
  readonly name: string;
  readonly status: WeaponStatus;
}

export class WeaponHud {
  readonly element: HTMLElement;
  private readonly crosshair: HTMLElement;
  private readonly name: HTMLElement;
  private readonly ammo: HTMLElement;
  private lastKey = '';

  constructor(container: HTMLElement) {
    const doc = container.ownerDocument;
    this.element = doc.createElement('div');
    this.element.className = 'weapon-hud';
    this.element.hidden = true;
    this.crosshair = doc.createElement('div');
    this.crosshair.className = 'weapon-hud__crosshair';
    const panel = doc.createElement('div');
    panel.className = 'weapon-hud__panel';
    this.name = doc.createElement('span');
    this.name.className = 'weapon-hud__name';
    this.ammo = doc.createElement('span');
    this.ammo.className = 'weapon-hud__ammo';
    panel.append(this.name, this.ammo);
    this.element.append(this.crosshair, panel);
    container.appendChild(this.element);
  }

  update(state: WeaponHudState): void {
    const { status } = state;
    const ammo = status.ammo;
    const ammoText =
      status.state === 'reloading'
        ? 'RELOADING'
        : ammo
          ? `${ammo.magazine} / ${Number.isFinite(ammo.reserve) ? ammo.reserve : '∞'}`
          : '';
    const key = `${state.visible}|${state.name}|${ammoText}|${status.state}`;
    if (key === this.lastKey) {
      return;
    }
    this.lastKey = key;
    this.element.hidden = !state.visible;
    this.element.dataset.weapon = status.id;
    this.element.dataset.state = status.state;
    this.element.dataset.magazine = ammo ? String(ammo.magazine) : '';
    this.name.textContent = state.name.toUpperCase();
    this.ammo.textContent = ammoText;
  }

  dispose(): void {
    this.element.remove();
  }
}
