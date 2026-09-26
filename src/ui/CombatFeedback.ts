/**
 * Hit feedback (GAME_DESIGN §6, D-041), placeholder presentation until the UI phase:
 * - a hit marker on the crosshair: white for a hit, gold for a headshot, red and larger for a kill;
 * - optional damage numbers that rise from the hit point and fade (pooled DOM nodes, D-018).
 *
 * It only listens to combat events and reads the camera; it never changes the simulation. The
 * root element also carries running totals (`data-hits`, `data-headshots`, `data-kills`) so
 * automated checks can read the feedback from any build without debug tools.
 */

import { Vector3, type Camera } from 'three';
import type { CombatEvents } from '../combat/CombatSystem';
import { COMBAT_FEEDBACK } from '../config/combat';
import type { EventBus } from '../core/EventBus';

export type HitMarkerKind = 'hit' | 'head' | 'kill';

interface DamageNumber {
  readonly element: HTMLElement;
  readonly position: Vector3;
  age: number;
  active: boolean;
}

const MARKER_TIME: Readonly<Record<HitMarkerKind, number>> = {
  hit: COMBAT_FEEDBACK.hitMarkerTime,
  head: COMBAT_FEEDBACK.headshotMarkerTime,
  kill: COMBAT_FEEDBACK.killMarkerTime,
};
/** Metres a damage number rises over its lifetime. */
const RISE = 0.45;

export class CombatFeedback {
  readonly element: HTMLElement;
  private readonly marker: HTMLElement;
  private readonly numbers: DamageNumber[] = [];
  private readonly scratch = new Vector3();
  private readonly unsubscribe: (() => void)[] = [];
  private markerTimer = 0;
  private nextNumber = 0;
  private hits = 0;
  private headshots = 0;
  private kills = 0;
  private showNumbers: boolean = COMBAT_FEEDBACK.damageNumbers;

  constructor(container: HTMLElement, events: EventBus<CombatEvents>) {
    const doc = container.ownerDocument;
    this.element = doc.createElement('div');
    this.element.className = 'combat-feedback';
    this.element.hidden = true;
    this.marker = doc.createElement('div');
    this.marker.className = 'hit-marker';
    this.marker.hidden = true;
    for (let i = 0; i < 4; i++) {
      const tick = doc.createElement('span');
      tick.className = 'hit-marker__tick';
      this.marker.appendChild(tick);
    }
    this.element.appendChild(this.marker);
    for (let i = 0; i < COMBAT_FEEDBACK.maxDamageNumbers; i++) {
      const el = doc.createElement('span');
      el.className = 'damage-number';
      el.hidden = true;
      this.element.appendChild(el);
      this.numbers.push({ element: el, position: new Vector3(), age: 0, active: false });
    }
    this.writeTotals();
    container.appendChild(this.element);

    this.unsubscribe.push(
      events.on('damaged', (e) => {
        this.hits++;
        if (e.critical) {
          this.headshots++;
        }
        if (e.killed) {
          this.kills++;
        }
        this.showMarker(e.killed ? 'kill' : e.critical ? 'head' : 'hit');
        if (this.showNumbers && e.amount > 0) {
          this.spawnNumber(e.point, e.amount, e.critical, e.killed);
        }
        this.writeTotals();
      }),
    );
  }

  get damageNumbersEnabled(): boolean {
    return this.showNumbers;
  }

  /** The optional damage numbers (a settings toggle later). */
  setDamageNumbers(enabled: boolean): void {
    this.showNumbers = enabled;
    if (!enabled) {
      for (const n of this.numbers) {
        n.active = false;
        n.element.hidden = true;
      }
    }
  }

  /** Damage numbers on screen (tests, debug). */
  get activeNumbers(): number {
    return this.numbers.filter((n) => n.active).length;
  }

  /** Clears the totals and anything on screen (new run). */
  reset(): void {
    this.hits = 0;
    this.headshots = 0;
    this.kills = 0;
    this.markerTimer = 0;
    this.marker.hidden = true;
    for (const n of this.numbers) {
      n.active = false;
      n.element.hidden = true;
    }
    this.writeTotals();
  }

  /**
   * Once per frame. `dt`: simulated seconds (feedback freezes while paused); `camera` projects the
   * numbers onto the screen.
   */
  update(dt: number, camera: Camera, visible: boolean): void {
    if (this.element.hidden === visible) {
      this.element.hidden = !visible;
    }
    if (this.markerTimer > 0) {
      this.markerTimer = Math.max(0, this.markerTimer - dt);
      if (this.markerTimer === 0) {
        this.marker.hidden = true;
      }
    }
    const width = this.element.clientWidth;
    const height = this.element.clientHeight;
    for (const n of this.numbers) {
      if (!n.active) {
        continue;
      }
      n.age += dt;
      const t = n.age / COMBAT_FEEDBACK.damageNumberTime;
      if (t >= 1) {
        n.active = false;
        n.element.hidden = true;
        continue;
      }
      const p = this.scratch.copy(n.position);
      p.y += RISE * t;
      p.project(camera);
      const onScreen = p.z < 1 && Math.abs(p.x) <= 1.2 && Math.abs(p.y) <= 1.2;
      n.element.hidden = !onScreen;
      if (onScreen) {
        const x = ((p.x + 1) / 2) * width;
        const y = ((1 - p.y) / 2) * height;
        n.element.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -50%)`;
        n.element.style.opacity = (1 - t * t).toFixed(3);
      }
    }
  }

  dispose(): void {
    for (const off of this.unsubscribe) {
      off();
    }
    this.element.remove();
  }

  private showMarker(kind: HitMarkerKind): void {
    // A kill marker is not overwritten by a hit landing in the same instant.
    if (this.markerTimer > 0 && this.marker.dataset.kind === 'kill' && kind !== 'kill') {
      return;
    }
    this.marker.dataset.kind = kind;
    this.marker.hidden = false;
    this.markerTimer = MARKER_TIME[kind];
    // Restart the CSS pop animation.
    this.marker.classList.remove('hit-marker--pop');
    this.marker.getBoundingClientRect(); // reflow, so the animation starts again
    this.marker.classList.add('hit-marker--pop');
  }

  private spawnNumber(
    point: readonly number[],
    amount: number,
    critical: boolean,
    killed: boolean,
  ): void {
    const n = this.numbers[this.nextNumber];
    this.nextNumber = (this.nextNumber + 1) % this.numbers.length;
    if (!n) {
      return;
    }
    n.position.set(point[0] ?? 0, point[1] ?? 0, point[2] ?? 0);
    n.age = 0;
    n.active = true;
    n.element.textContent = String(Math.round(amount));
    n.element.dataset.kind = killed ? 'kill' : critical ? 'head' : 'hit';
    n.element.hidden = true; // shown once positioned by update()
  }

  private writeTotals(): void {
    this.element.dataset.hits = String(this.hits);
    this.element.dataset.headshots = String(this.headshots);
    this.element.dataset.kills = String(this.kills);
  }
}
