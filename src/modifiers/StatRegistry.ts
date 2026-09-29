/**
 * Sourced stat modifiers (D-009, ARCHITECTURE §7.2). A stat's value is its base, changed by every
 * modifier currently applied to it:
 *
 *   override (the latest applied wins) — otherwise (base + Σ add) × Π mul
 *
 * Each modifier carries the id of its source (e.g. `mutation:HUNGER`), so removing a source takes
 * away exactly what it added, whatever else is applied. Only registered stats can be modified:
 * content naming anything else (a deferred mutation's `world.gravity`) is refused, loudly in strict
 * mode, so it can never half-apply.
 */

import type { StatOp, StatTarget } from '../config/effects';

interface StatModifier {
  readonly sourceId: string;
  readonly op: StatOp;
  readonly value: number;
  /** Application order (for overrides). */
  readonly order: number;
}

interface Folded {
  override: number | null;
  add: number;
  mul: number;
}

export class UnregisteredStatError extends Error {
  constructor(stat: string) {
    super(`Stat "${stat}" is not registered; no effect can change it yet`);
    this.name = 'UnregisteredStatError';
  }
}

export class StatRegistry {
  private readonly registered: ReadonlySet<StatTarget>;
  private readonly strict: boolean;
  private readonly modifiers = new Map<StatTarget, StatModifier[]>();
  private readonly folded = new Map<StatTarget, Folded>();
  private order = 0;
  private revision = 0;

  constructor(registered: readonly StatTarget[], options: { readonly strict?: boolean } = {}) {
    this.registered = new Set(registered);
    this.strict = options.strict ?? true;
  }

  /** Increases on every change (consumers can cache against it). */
  get version(): number {
    return this.revision;
  }

  isRegistered(stat: StatTarget): boolean {
    return this.registered.has(stat);
  }

  /** Adds a modifier. Returns false (or throws, strict) for an unregistered stat. */
  add(sourceId: string, stat: StatTarget, op: StatOp, value: number): boolean {
    if (!this.registered.has(stat)) {
      if (this.strict) {
        throw new UnregisteredStatError(stat);
      }
      return false;
    }
    if (!Number.isFinite(value)) {
      throw new RangeError(`Stat modifier for "${stat}" must be finite (got ${value})`);
    }
    const list = this.modifiers.get(stat) ?? [];
    list.push({ sourceId, op, value, order: this.order++ });
    this.modifiers.set(stat, list);
    this.folded.delete(stat);
    this.revision++;
    return true;
  }

  /** Removes everything `sourceId` added. Returns how many modifiers went. */
  removeSource(sourceId: string): number {
    let removed = 0;
    for (const [stat, list] of this.modifiers) {
      const kept = list.filter((m) => m.sourceId !== sourceId);
      if (kept.length !== list.length) {
        removed += list.length - kept.length;
        if (kept.length > 0) {
          this.modifiers.set(stat, kept);
        } else {
          this.modifiers.delete(stat);
        }
        this.folded.delete(stat);
      }
    }
    if (removed > 0) {
      this.revision++;
    }
    return removed;
  }

  /** Removes every source whose id starts with `prefix` (e.g. `mutation:`). */
  removeSourcesWithPrefix(prefix: string): number {
    let removed = 0;
    for (const id of this.sources()) {
      if (id.startsWith(prefix)) {
        removed += this.removeSource(id);
      }
    }
    return removed;
  }

  /** The source ids currently applied (debug, tests). */
  sources(): string[] {
    const ids = new Set<string>();
    for (const list of this.modifiers.values()) {
      for (const m of list) {
        ids.add(m.sourceId);
      }
    }
    return [...ids];
  }

  /** The stat's value for `base`. */
  value(stat: StatTarget, base: number): number {
    const f = this.fold(stat);
    return f.override ?? (base + f.add) * f.mul;
  }

  /** The multiplier on `base` alone (no adds or overrides applied to the stat), for scaling. */
  multiplier(stat: StatTarget): number {
    return this.fold(stat).mul;
  }

  clear(): void {
    if (this.modifiers.size > 0) {
      this.modifiers.clear();
      this.folded.clear();
      this.revision++;
    }
  }

  private fold(stat: StatTarget): Folded {
    let f = this.folded.get(stat);
    if (!f) {
      f = { override: null, add: 0, mul: 1 };
      let latest = -1;
      for (const m of this.modifiers.get(stat) ?? []) {
        if (m.op === 'add') {
          f.add += m.value;
        } else if (m.op === 'mul') {
          f.mul *= m.value;
        } else if (m.order > latest) {
          latest = m.order;
          f.override = m.value;
        }
      }
      this.folded.set(stat, f);
    }
    return f;
  }
}
