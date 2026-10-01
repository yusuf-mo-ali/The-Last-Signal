/**
 * The player's side of an alarm (D-043, plan §12 "trigger temporary screen/audio effects"): when
 * something raises an alarm the player is within earshot of (a Screamer's scream), the screen edges
 * pulse violet and shudder briefly. Placeholder until the effects and audio phases; the audio cue
 * (GAME_DESIGN §15) is not built yet.
 *
 * It only listens to the enemy events and reads the player's position; it never changes the
 * simulation. The root carries `data-pulses` (how many it has shown) so automated checks can read
 * it in any build. Timing runs on simulated time, so the pulse holds while the game is paused.
 */

import type { Vector3 } from 'three';
import type { EventBus } from '../core/EventBus';
import type { EnemyEvents } from '../enemies/events';

/** Seconds a pulse takes to fade. */
const PULSE_TIME = 0.9;

export class AlarmPulse {
  readonly element: HTMLElement;
  private readonly listener: () => Vector3;
  private readonly unsubscribe: () => void;
  private timer = 0;
  private pulses = 0;
  private lastOpacity = -1;

  constructor(container: HTMLElement, events: EventBus<EnemyEvents>, listener: () => Vector3) {
    this.listener = listener;
    this.element = container.ownerDocument.createElement('div');
    this.element.className = 'alarm-pulse';
    this.element.style.opacity = '0';
    this.element.dataset.pulses = '0';
    container.appendChild(this.element);
    this.unsubscribe = events.on('alarm', (alarm) => {
      // The screen pulse is the Screamer's scream only; a DEATH CRY shows at the corpse (D-045).
      if (alarm.kind !== 'scream') {
        return;
      }
      const p = this.listener();
      const [x, y, z] = alarm.position;
      if (Math.hypot(p.x - x, p.z - z) <= alarm.radius && Math.abs(p.y - y) <= alarm.radius / 2) {
        this.timer = PULSE_TIME;
        this.pulses++;
        this.element.dataset.pulses = String(this.pulses);
      }
    });
  }

  /** Once per frame. `dt`: simulated seconds. */
  update(dt: number): void {
    this.timer = Math.max(0, this.timer - dt);
    const t = this.timer / PULSE_TIME;
    const opacity = Math.round(t * t * 100) / 100;
    if (opacity !== this.lastOpacity) {
      this.lastOpacity = opacity;
      this.element.style.opacity = String(opacity);
      this.element.classList.toggle('alarm-pulse--shake', opacity > 0);
    }
  }

  /** A new run: no pulse showing, count kept (it is a running total). */
  reset(): void {
    this.timer = 0;
  }

  dispose(): void {
    this.unsubscribe();
    this.element.remove();
  }
}
