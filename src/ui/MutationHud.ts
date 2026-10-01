/**
 * The mutation's place on the HUD (D-045, GAME_DESIGN §9, §14): the player always knows which
 * mutation is on and what it does.
 *
 * - An intro card during the wave's announcement: the name in its colour, the one-line rule and a
 *   counter-play hint.
 * - A badge top centre for the whole wave ("◆ BLACKOUT"; BLOOD MOON adds its Elite count; it
 *   flickers with each STATIC burst), and "BLACKOUT LIFTED" in the breather.
 * - A surge cue (HIVE) the moment a surge is announced: "HIVE SURGE · EAST" and an arrow pointing
 *   where it will come from, until it arrives.
 *
 * DOM writes happen only when a value changes. Data attributes (`data-mutation`, `data-phase`,
 * `data-region`…) let automated checks read it in any build.
 */

import { MUTATIONS, type MutationId } from '../config/mutations';
import type { SignalMutationSystem } from '../signal/SignalMutationSystem';
import type { WaveManager } from '../waves/WaveManager';

/** Where the player stands and looks (the surge arrow). */
export interface HudViewer {
  readonly x: number;
  readonly z: number;
  /** Look yaw: 0 faces −z (north), positive turns left. */
  readonly yaw: number;
}

const REGION_NAMES: Readonly<Record<string, string>> = {
  north: 'NORTH',
  northeast: 'NORTH-EAST',
  east: 'EAST',
  southeast: 'SOUTH-EAST',
  south: 'SOUTH',
  southwest: 'SOUTH-WEST',
  west: 'WEST',
  northwest: 'NORTH-WEST',
};

/** Seconds a badge flickers for after a STATIC burst starts. */
const FLICKER_TIME = 0.4;

export class MutationHud {
  readonly badge: HTMLElement;
  readonly card: HTMLElement;
  readonly cue: HTMLElement;
  private readonly cardName: HTMLElement;
  private readonly cardRule: HTMLElement;
  private readonly cardHint: HTMLElement;
  private readonly cueText: HTMLElement;
  private readonly cueArrow: HTMLElement;
  private readonly mutations: SignalMutationSystem;
  private readonly waves: WaveManager;
  private readonly unsubscribe: (() => void)[] = [];
  private surge: { readonly pointId: string; readonly region: string } | null = null;
  private flicker = 0;
  private lastBadge = '';
  private lastCard = '';
  private lastCue = '';

  constructor(container: HTMLElement, mutations: SignalMutationSystem, waves: WaveManager) {
    this.mutations = mutations;
    this.waves = waves;
    const doc = container.ownerDocument;
    const make = (className: string, parent: HTMLElement = container) => {
      const el = doc.createElement('div');
      el.className = className;
      parent.appendChild(el);
      return el;
    };
    this.badge = make('mutation-badge');
    this.badge.hidden = true;
    this.card = make('mutation-card');
    this.card.hidden = true;
    this.cardName = make('mutation-card__name', this.card);
    this.cardRule = make('mutation-card__rule', this.card);
    this.cardHint = make('mutation-card__hint', this.card);
    this.cue = make('surge-cue');
    this.cue.hidden = true;
    this.cueArrow = make('surge-cue__arrow', this.cue);
    this.cueArrow.textContent = '▲';
    this.cueText = make('surge-cue__text', this.cue);
    this.unsubscribe.push(
      waves.events.on('surgeWarning', (e) => {
        this.surge = { pointId: e.pointId, region: e.region };
      }),
      waves.events.on('surgeSpawned', () => {
        this.surge = null;
      }),
      waves.events.on('waveStarting', () => {
        this.surge = null;
      }),
      mutations.events.on('staticBurst', () => {
        this.flicker = FLICKER_TIME;
      }),
    );
  }

  /**
   * Once per frame. `visible`: the HUD is on screen; `dt`: simulated seconds (0 while paused);
   * `viewer`: where the player is (for the surge arrow).
   */
  update(visible: boolean, dt: number, viewer: HudViewer | null): void {
    this.flicker = Math.max(0, this.flicker - dt);
    const status = this.mutations.status;
    const id: MutationId | null = status.id;
    const m = id ? MUTATIONS[id] : null;
    const phase = status.phase;
    const live = phase === 'announced' || phase === 'active';

    // Badge.
    let badge = '';
    if (visible && m && live) {
      badge = `◆ ${m.name.toUpperCase()}`;
      if (id === 'BLOOD_MOON') {
        const elites =
          this.waves.definition?.spawns.filter((s) => s.traits.includes('elite')).length ?? 0;
        badge += ` · ELITES ×${elites}`;
      }
    } else if (visible && m && phase === 'lifted') {
      badge = `${m.name.toUpperCase()} LIFTED`;
    }
    const flickering = this.flicker > 0 && badge !== '';
    const badgeKey = `${badge}|${phase}|${flickering}|${m?.accent ?? ''}`;
    if (badgeKey !== this.lastBadge) {
      this.lastBadge = badgeKey;
      this.badge.hidden = badge === '';
      this.badge.textContent = badge;
      this.badge.dataset.mutation = id ?? '';
      this.badge.dataset.phase = phase;
      this.badge.classList.toggle('mutation-badge--flicker', flickering);
      this.badge.classList.toggle('mutation-badge--lifted', phase === 'lifted');
      this.badge.style.setProperty('--accent', m?.accent ?? '#ffffff');
    }

    // Intro card (the announcement).
    const card = visible && m && phase === 'announced' ? `${m.name}|${m.rule}|${m.hint}` : '';
    if (card !== this.lastCard) {
      this.lastCard = card;
      this.card.hidden = card === '';
      if (m && card) {
        this.cardName.textContent = m.name.toUpperCase();
        this.cardRule.textContent = m.rule;
        this.cardHint.textContent = m.hint;
        this.card.dataset.mutation = m.id;
        this.card.style.setProperty('--accent', m.accent);
      }
    }

    // Surge cue (HIVE): where it will come from, relative to where the player looks.
    let cue = '';
    let rotation = 0;
    const pending = this.waves.status.surges.pending;
    if (visible && pending && this.surge) {
      cue = `${m ? m.name.toUpperCase() : 'SURGE'} SURGE · ${REGION_NAMES[this.surge.region] ?? ''}`;
      const point = this.waves.spawns.all.find((p) => p.id === this.surge?.pointId);
      if (point && viewer) {
        // Bearing of the point in the player's yaw convention, relative to the view.
        const dx = point.position[0] - viewer.x;
        const dz = point.position[2] - viewer.z;
        const bearing = Math.atan2(-dx, -dz);
        rotation = Math.round(((viewer.yaw - bearing) * 180) / Math.PI);
      }
    }
    const cueKey = `${cue}|${rotation}`;
    if (cueKey !== this.lastCue) {
      this.lastCue = cueKey;
      this.cue.hidden = cue === '';
      this.cueText.textContent = cue;
      this.cue.dataset.region = this.surge?.region ?? '';
      this.cueArrow.style.transform = `rotate(${rotation}deg)`;
    }
  }

  dispose(): void {
    for (const off of this.unsubscribe) {
      off();
    }
    this.badge.remove();
    this.card.remove();
    this.cue.remove();
  }
}
