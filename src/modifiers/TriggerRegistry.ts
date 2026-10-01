/**
 * Data-declared reactions to events (D-009, ARCHITECTURE §7.2). Content says "on `enemy:died`, run
 * `deathCry` with these params"; the handlers are registered by name by the composition root, so
 * content never holds code. Triggers are added and removed by source id (e.g. `mutation:SCREAM`).
 * Only registered actions can be added: a deferred mutation's action (OVERLOAD's
 * `environmentPulse`) is refused, loudly in strict mode.
 */

import type { TriggerAction, TriggerEvent } from '../config/effects';
import type { Vec3Tuple } from '../weapons/types';

/** What each event carries to its handlers. */
export interface TriggerPayloads {
  readonly 'enemy:died': { readonly id: string; readonly position: Vec3Tuple };
  readonly 'weapon:shot': { readonly weaponId: string };
}

export type TriggerParams = Readonly<Record<string, number>>;

export type TriggerHandler = (
  event: TriggerEvent,
  payload: TriggerPayloads[TriggerEvent],
  params: TriggerParams,
) => void;

interface ActiveTrigger {
  readonly sourceId: string;
  readonly on: TriggerEvent;
  readonly action: TriggerAction;
  readonly params: TriggerParams;
}

export class UnregisteredActionError extends Error {
  constructor(action: string) {
    super(`Trigger action "${action}" is not registered`);
    this.name = 'UnregisteredActionError';
  }
}

export class TriggerRegistry {
  private readonly handlers = new Map<TriggerAction, TriggerHandler>();
  private triggers: ActiveTrigger[] = [];
  private readonly strict: boolean;
  /** How many times each action ran (debug, tests). */
  readonly fired = new Map<TriggerAction, number>();

  constructor(options: { readonly strict?: boolean } = {}) {
    this.strict = options.strict ?? true;
  }

  /** Registers the code behind an action name. Returns the unregister function. */
  registerAction(action: TriggerAction, handler: TriggerHandler): () => void {
    this.handlers.set(action, handler);
    return () => {
      if (this.handlers.get(action) === handler) {
        this.handlers.delete(action);
      }
    };
  }

  isRegistered(action: TriggerAction): boolean {
    return this.handlers.has(action);
  }

  /** Adds a trigger. Returns false (or throws, strict) when its action is not registered. */
  add(
    sourceId: string,
    on: TriggerEvent,
    action: TriggerAction,
    params: TriggerParams = {},
  ): boolean {
    if (!this.handlers.has(action)) {
      if (this.strict) {
        throw new UnregisteredActionError(action);
      }
      return false;
    }
    this.triggers.push({ sourceId, on, action, params });
    return true;
  }

  removeSource(sourceId: string): number {
    const before = this.triggers.length;
    this.triggers = this.triggers.filter((t) => t.sourceId !== sourceId);
    return before - this.triggers.length;
  }

  removeSourcesWithPrefix(prefix: string): number {
    const before = this.triggers.length;
    this.triggers = this.triggers.filter((t) => !t.sourceId.startsWith(prefix));
    return before - this.triggers.length;
  }

  sources(): string[] {
    return [...new Set(this.triggers.map((t) => t.sourceId))];
  }

  /** Runs every trigger listening to `event`, in the order they were added. */
  dispatch<E extends TriggerEvent>(event: E, payload: TriggerPayloads[E]): void {
    for (const trigger of [...this.triggers]) {
      if (trigger.on !== event) {
        continue;
      }
      const handler = this.handlers.get(trigger.action);
      if (handler) {
        this.fired.set(trigger.action, (this.fired.get(trigger.action) ?? 0) + 1);
        handler(event, payload, trigger.params);
      }
    }
  }

  clear(): void {
    this.triggers = [];
  }
}
