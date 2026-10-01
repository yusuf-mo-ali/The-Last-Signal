/**
 * The combat pipeline (plan §10, ARCHITECTURE §7.3, D-007, D-041):
 *
 *   weapon hit (ShotResult / MeleeResult from WeaponManager events)
 *     → hitbox resolution (Hitscan: level + every registered rig, nearest wins; this system is the
 *       rigs' HitscanTarget)
 *     → damage calculation (computeDamage: pure)
 *     → Health (damage, death once)
 *     → events: damaged, staggered, killed (+ the owner's onKilled hook) for feedback, drops,
 *       and later XP/Scrap, the adaptive profile and analytics
 *
 * It knows nothing about zombies, dummies or bosses: anything with a hitbox rig and a Health can
 * be registered as a target. Owners keep their own behaviour (a dummy stands up again, an enemy
 * will return to its pool) and hear about deaths through `onKilled` or the `killed` event.
 *
 * Browser-independent and deterministic (no randomness here at all).
 */

import type { Vector3 } from 'three';
import { COMBAT_RULES, type CombatRules } from '../config/combat';
import type { DamageZone } from '../config/enemies';
import type { WeaponId } from '../config/weapons';
import { EventBus } from '../core/EventBus';
import type { FixedUpdateSystem } from '../core/Game';
import { countDown } from '../weapons/timing';
import type { Hitscan, HitscanTarget, TargetHit } from '../weapons/hitscan';
import type { MeleeResult, ShotResult, Vec3Tuple, WeaponEvents } from '../weapons/types';
import type { ArmorPlate } from './armor';
import { computeDamage, type ZoneMultipliers } from './damage';
import type { Health } from './Health';
import type { HitboxRig } from './hitbox';

/** Where damage came from: a bullet, a melee swing, or applied directly (no weapon). */
export type HitSource = 'shot' | 'melee' | 'direct';

/**
 * Damage applied straight to a target, not worked out from a weapon hit: the debug tools now;
 * hazards and area damage later. `amount` is final (no zone multiplier, armor or resistance).
 */
export interface DirectDamage {
  readonly amount: number;
  /** Reported zone (feedback only). Default TORSO. */
  readonly zone?: DamageZone;
  /** Default: the target's chest. */
  readonly point?: Vec3Tuple;
  /** Default: straight down (no push). */
  readonly direction?: Vec3Tuple;
}

/** One hit that reached a target, before damage is worked out. */
export interface HitInput {
  readonly targetId: string;
  readonly zone: DamageZone;
  readonly weaponId: WeaponId;
  readonly source: HitSource;
  /** A quick melee (V) made while holding another weapon. */
  readonly quick: boolean;
  readonly baseDamage: number;
  readonly falloff: number;
  readonly headshotMultiplier: number;
  readonly point: Vec3Tuple;
  /** Unit direction the hit travelled in (hit reactions push along it). */
  readonly direction: Vec3Tuple;
  readonly distance: number;
}

export interface DamagedEvent {
  readonly targetId: string;
  /** Null for direct damage. */
  readonly weaponId: WeaponId | null;
  readonly source: HitSource;
  readonly quick: boolean;
  readonly zone: DamageZone;
  /** A headshot (GAME_DESIGN §6: no random crits). */
  readonly critical: boolean;
  /** Health actually removed. */
  readonly amount: number;
  /** What the hit was worth before it was capped by the health left. */
  readonly dealt: number;
  /** Damage flat armor took off this hit (the target's and its zone's). */
  readonly armorReduction: number;
  /** Damage a breakable plate (a helmet) absorbed. */
  readonly absorbed: number;
  /** Health left after the hit. */
  readonly health: number;
  readonly maxHealth: number;
  readonly killed: boolean;
  readonly point: Vec3Tuple;
  readonly direction: Vec3Tuple;
  readonly distance: number;
}

export interface KilledEvent {
  readonly targetId: string;
  readonly weaponId: WeaponId | null;
  readonly source: HitSource;
  /** The zone of the killing hit. */
  readonly zone: DamageZone;
  readonly critical: boolean;
  readonly overkill: number;
  readonly point: Vec3Tuple;
  readonly direction: Vec3Tuple;
}

/** A breakable plate (a helmet) was used up by a hit. */
export interface ArmorBrokenEvent {
  readonly targetId: string;
  readonly plateId: string;
  readonly zone: DamageZone;
  readonly point: Vec3Tuple;
  readonly direction: Vec3Tuple;
}

export interface StaggeredEvent {
  readonly targetId: string;
  readonly zone: DamageZone;
  readonly point: Vec3Tuple;
  readonly direction: Vec3Tuple;
}

export interface CombatEvents {
  damaged: DamagedEvent;
  staggered: StaggeredEvent;
  killed: KilledEvent;
  revived: { readonly targetId: string };
  armorBroken: ArmorBrokenEvent;
}

/**
 * How a target takes damage (D-041, D-043): overrides of the plan's zone multipliers, flat armor
 * (on every zone, and per zone), breakable plates, resistance and stagger. Traits change these at
 * run time through `CombatSystem.configure`.
 */
export interface DamageProfile {
  readonly zoneMultipliers?: ZoneMultipliers;
  readonly armor?: number;
  /** Flat armor per hit on particular zones, added to `armor`. */
  readonly zoneArmor?: Readonly<Partial<Record<DamageZone, number>>>;
  /** Breakable armor (state owned by the target's owner). */
  readonly plates?: readonly ArmorPlate[];
  readonly resistance?: number;
  /** Damage within the stagger window that causes a stagger; omitted = never staggers. */
  readonly staggerThreshold?: number;
  /** Only damage to these zones counts towards a stagger; omitted = every zone. */
  readonly staggerZones?: readonly DamageZone[];
}

export interface CombatTargetOptions extends DamageProfile {
  /** Unique among the registered targets. */
  readonly id: string;
  readonly rig: HitboxRig;
  readonly health: Health;
  /** Called once when the target dies, before the `killed` event: the owner's deactivation hook. */
  readonly onKilled?: (event: KilledEvent) => void;
}

/** A registered target (read-only view for owners, views and debug tools). */
export interface CombatTarget {
  readonly id: string;
  readonly rig: HitboxRig;
  readonly health: Health;
  readonly zoneMultipliers: ZoneMultipliers | undefined;
  readonly armor: number;
  readonly zoneArmor: Readonly<Partial<Record<DamageZone, number>>>;
  readonly plates: readonly ArmorPlate[];
  readonly resistance: number;
  readonly staggerThreshold: number;
  readonly staggerZones: readonly DamageZone[] | undefined;
}

interface TargetRecord {
  readonly id: string;
  readonly rig: HitboxRig;
  readonly health: Health;
  zoneMultipliers: ZoneMultipliers | undefined;
  armor: number;
  zoneArmor: Readonly<Partial<Record<DamageZone, number>>>;
  plates: readonly ArmorPlate[];
  resistance: number;
  staggerThreshold: number;
  staggerZones: readonly DamageZone[] | undefined;
  readonly onKilled: ((event: KilledEvent) => void) | undefined;
  staggerDamage: number;
  staggerTimer: number;
}

const NO_ZONE_ARMOR: Readonly<Partial<Record<DamageZone, number>>> = {};

export interface CombatSystemOptions {
  readonly hitscan: Hitscan;
  /** The weapons whose shots and swings deal damage. */
  readonly weaponEvents?: EventBus<WeaponEvents>;
  readonly rules?: CombatRules;
}

export class CombatSystem implements FixedUpdateSystem, HitscanTarget {
  readonly events = new EventBus<CombatEvents>();
  /** Attacker modifiers hook (damage upgrades, later). Applied to every hit. */
  attackerMultiplier = 1;
  private readonly rules: CombatRules;
  private readonly records = new Map<string, TargetRecord>();
  /** Iteration order for raycasts: registration order, so ties resolve the same way every time. */
  private list: TargetRecord[] = [];
  private readonly unsubscribe: (() => void)[] = [];

  constructor(options: CombatSystemOptions) {
    this.rules = options.rules ?? COMBAT_RULES;
    this.unsubscribe.push(options.hitscan.addTarget(this));
    const weaponEvents = options.weaponEvents;
    if (weaponEvents) {
      this.unsubscribe.push(
        weaponEvents.on('shot', (shot) => {
          this.applyShot(shot);
        }),
        weaponEvents.on('melee', (swing) => {
          this.applyMelee(swing);
        }),
      );
    }
  }

  get targets(): readonly CombatTarget[] {
    return this.list;
  }

  get aliveCount(): number {
    let alive = 0;
    for (const record of this.list) {
      if (record.health.isAlive) {
        alive++;
      }
    }
    return alive;
  }

  get(id: string): CombatTarget | undefined {
    return this.records.get(id);
  }

  add(options: CombatTargetOptions): CombatTarget {
    if (this.records.has(options.id)) {
      throw new Error(`A combat target "${options.id}" is already registered`);
    }
    const record: TargetRecord = {
      id: options.id,
      rig: options.rig,
      health: options.health,
      zoneMultipliers: undefined,
      armor: 0,
      zoneArmor: NO_ZONE_ARMOR,
      plates: [],
      resistance: 0,
      staggerThreshold: Number.POSITIVE_INFINITY,
      staggerZones: undefined,
      onKilled: options.onKilled,
      staggerDamage: 0,
      staggerTimer: 0,
    };
    setProfile(record, options);
    this.records.set(record.id, record);
    this.list = [...this.list, record];
    return record;
  }

  /**
   * Replaces how a registered target takes damage (a trait added or removed). Returns whether the
   * target is registered.
   */
  configure(id: string, profile: DamageProfile): boolean {
    const record = this.records.get(id);
    if (!record) {
      return false;
    }
    setProfile(record, profile);
    return true;
  }

  /** Unregisters a target (despawned, returned to a pool). Returns whether it was registered. */
  remove(id: string): boolean {
    if (!this.records.delete(id)) {
      return false;
    }
    this.list = this.list.filter((r) => r.id !== id);
    return true;
  }

  clear(): void {
    this.records.clear();
    this.list = [];
  }

  /** Brings a dead target back (respawning dummies, pooled enemies), at full health by default. */
  revive(id: string, health?: number): boolean {
    const record = this.records.get(id);
    if (!record) {
      return false;
    }
    record.health.revive(health);
    record.staggerDamage = 0;
    record.staggerTimer = 0;
    this.events.emit('revived', { targetId: id });
    return true;
  }

  fixedUpdate(dt: number): void {
    // Only the window runs down here; the next hit starts a fresh count once it has closed.
    for (const record of this.list) {
      if (record.staggerTimer > 0) {
        record.staggerTimer = countDown(record.staggerTimer, dt);
      }
    }
  }

  /**
   * HitscanTarget: the nearest living rig a ray enters within `maxDistance` (the level's hit
   * distance, so walls block targets behind them). Dead targets are not hittable: shots pass
   * through to whatever is behind.
   */
  raycast(origin: Vector3, direction: Vector3, maxDistance: number): TargetHit | null {
    let best: TargetRecord | null = null;
    let bestDistance = maxDistance;
    let bestZone: DamageZone = 'TORSO';
    for (const record of this.list) {
      if (record.health.isDead) {
        continue;
      }
      const hit = record.rig.raycast(origin, direction, bestDistance);
      if (hit && (best === null || hit.distance < bestDistance)) {
        best = record;
        bestDistance = hit.distance;
        bestZone = hit.zone;
      }
    }
    if (!best) {
      return null;
    }
    return {
      kind: 'target',
      distance: bestDistance,
      point: [
        origin.x + direction.x * bestDistance,
        origin.y + direction.y * bestDistance,
        origin.z + direction.z * bestDistance,
      ],
      targetId: best.id,
      zone: bestZone,
    };
  }

  /** Applies every pellet of a shot that hit a target. */
  applyShot(shot: ShotResult): void {
    for (const pellet of shot.pellets) {
      const hit = pellet.hit;
      if (hit?.kind !== 'target') {
        continue;
      }
      this.applyHit({
        targetId: hit.targetId,
        zone: hit.zone,
        weaponId: shot.weaponId,
        source: 'shot',
        quick: false,
        baseDamage: pellet.baseDamage,
        falloff: pellet.falloff,
        headshotMultiplier: shot.headshotMultiplier,
        point: hit.point,
        direction: pellet.direction,
        distance: hit.distance,
      });
    }
  }

  /** Applies a melee swing that hit a target (no falloff). */
  applyMelee(swing: MeleeResult): void {
    const hit = swing.hit;
    if (hit?.kind !== 'target') {
      return;
    }
    this.applyHit({
      targetId: hit.targetId,
      zone: hit.zone,
      weaponId: swing.weaponId,
      source: 'melee',
      quick: swing.quick,
      baseDamage: swing.damage,
      falloff: 1,
      headshotMultiplier: swing.headshotMultiplier,
      point: hit.point,
      direction: swing.direction,
      distance: hit.distance,
    });
  }

  /**
   * Works out and applies one hit. Returns what happened, or null when the target is unknown or
   * already dead (nothing is emitted then).
   */
  applyHit(hit: HitInput): DamagedEvent | null {
    const record = this.records.get(hit.targetId);
    if (!record || record.health.isDead) {
      return null;
    }
    const damage = computeDamage(
      {
        baseDamage: hit.baseDamage,
        falloff: hit.falloff,
        zone: hit.zone,
        headshotMultiplier: hit.headshotMultiplier,
        zoneMultipliers: record.zoneMultipliers,
        attackerMultiplier: this.attackerMultiplier,
        armor: record.armor + (record.zoneArmor[hit.zone] ?? 0),
        resistance: record.resistance,
      },
      this.rules,
    );
    // Breakable plates over the zone take what they can before health does.
    let amount = damage.amount;
    let absorbed = 0;
    const broken: ArmorPlate[] = [];
    for (const plate of record.plates) {
      if (amount > 0 && plate.covers(hit.zone)) {
        const taken = plate.absorb(amount);
        amount -= taken;
        absorbed += taken;
        if (plate.broken) {
          broken.push(plate);
        }
      }
    }
    const event = this.apply(
      record,
      amount,
      damage.critical,
      { armorReduction: damage.armorReduction, absorbed },
      hit,
    );
    for (const plate of broken) {
      this.events.emit('armorBroken', {
        targetId: record.id,
        plateId: plate.id,
        zone: hit.zone,
        point: hit.point,
        direction: hit.direction,
      });
      if (plate.staggerOnBreak && record.health.isAlive) {
        this.stagger(record, hit);
      }
    }
    return event;
  }

  /**
   * Applies damage directly (see `DirectDamage`), through the same health, stagger, death and
   * events as a hit. Returns what happened, or null when the target is unknown or already dead.
   */
  applyDamage(targetId: string, damage: DirectDamage): DamagedEvent | null {
    const record = this.records.get(targetId);
    if (!record || record.health.isDead) {
      return null;
    }
    const p = record.rig.position;
    const amount = Number.isNaN(damage.amount) ? 0 : Math.max(0, damage.amount);
    return this.apply(record, amount, damage.zone === 'HEAD', NO_MITIGATION, {
      zone: damage.zone ?? 'TORSO',
      weaponId: null,
      source: 'direct',
      quick: false,
      point: damage.point ?? [p.x, p.y + 1.2, p.z],
      direction: damage.direction ?? [0, -1, 0],
      distance: 0,
    });
  }

  /** Kills a living target outright (debug tools), through the normal death path. */
  kill(targetId: string): DamagedEvent | null {
    const record = this.records.get(targetId);
    return record ? this.applyDamage(targetId, { amount: record.health.current }) : null;
  }

  private apply(
    record: TargetRecord,
    amount: number,
    critical: boolean,
    mitigation: Mitigation,
    hit: Pick<HitInput, 'zone' | 'source' | 'quick' | 'point' | 'direction' | 'distance'> & {
      readonly weaponId: WeaponId | null;
    },
  ): DamagedEvent {
    const outcome = record.health.damage(amount);
    const event: DamagedEvent = {
      targetId: record.id,
      weaponId: hit.weaponId,
      source: hit.source,
      quick: hit.quick,
      zone: hit.zone,
      critical,
      amount: outcome.applied,
      dealt: amount,
      armorReduction: mitigation.armorReduction,
      absorbed: mitigation.absorbed,
      health: record.health.current,
      maxHealth: record.health.max,
      killed: outcome.killed,
      point: hit.point,
      direction: hit.direction,
      distance: hit.distance,
    };
    this.events.emit('damaged', event);

    if (outcome.killed) {
      record.staggerDamage = 0;
      record.staggerTimer = 0;
      const killed: KilledEvent = {
        targetId: record.id,
        weaponId: hit.weaponId,
        source: hit.source,
        zone: hit.zone,
        critical,
        overkill: outcome.overkill,
        point: hit.point,
        direction: hit.direction,
      };
      record.onKilled?.(killed);
      this.events.emit('killed', killed);
    } else if (
      outcome.applied > 0 &&
      Number.isFinite(record.staggerThreshold) &&
      (record.staggerZones === undefined || record.staggerZones.includes(hit.zone))
    ) {
      // Hit reaction: damage close together adds up; enough of it staggers.
      if (record.staggerTimer <= 0) {
        record.staggerDamage = 0;
      }
      record.staggerDamage += outcome.applied;
      record.staggerTimer = this.rules.staggerWindow;
      if (record.staggerDamage >= record.staggerThreshold) {
        this.stagger(record, hit);
      }
    }
    return event;
  }

  private stagger(record: TargetRecord, hit: Pick<HitInput, 'zone' | 'point' | 'direction'>): void {
    record.staggerDamage = 0;
    this.events.emit('staggered', {
      targetId: record.id,
      zone: hit.zone,
      point: hit.point,
      direction: hit.direction,
    });
  }

  dispose(): void {
    for (const off of this.unsubscribe) {
      off();
    }
    this.unsubscribe.length = 0;
    this.clear();
  }
}

interface Mitigation {
  readonly armorReduction: number;
  readonly absorbed: number;
}

const NO_MITIGATION: Mitigation = { armorReduction: 0, absorbed: 0 };

function setProfile(record: TargetRecord, profile: DamageProfile): void {
  record.zoneMultipliers = profile.zoneMultipliers;
  record.armor = profile.armor ?? 0;
  record.zoneArmor = profile.zoneArmor ?? NO_ZONE_ARMOR;
  record.plates = profile.plates ?? [];
  record.resistance = profile.resistance ?? 0;
  record.staggerThreshold = profile.staggerThreshold ?? Number.POSITIVE_INFINITY;
  record.staggerZones = profile.staggerZones;
}
