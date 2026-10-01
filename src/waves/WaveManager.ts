/**
 * The wave runtime (plan §13, ARCHITECTURE §7.8, D-044): it drives the run through its waves.
 *
 *   PLAYING (a new run)   wave 0, stats and streams reset
 *   WAVE_START            the next wave is generated (`generateWave`), pools are readied, the wave
 *                         is announced; after the intro → WAVE_ACTIVE (BOSS later, Phase 13)
 *   WAVE_ACTIVE           groups spawn at the wave's rate, never more wave enemies alive than its
 *                         `maxAlive`, at fair spawn points (`SpawnDirector`); every one knows where
 *                         the player is. When the queue is empty and none is alive → WAVE_COMPLETE
 *   WAVE_COMPLETE         the final wave (not endless) → VICTORY; otherwise a breather →
 *   UPGRADE_SELECTION     passed straight through until upgrades exist (Phase 9) → WAVE_START
 *
 * Also: an alarm (a Screamer's scream) pulls the next queued group forward, toward it, without
 * adding to the budget; a wave cannot stall on a few enemies that cannot reach the player
 * (stragglers are moved to fresh spawn points); per-run stats for the end screens.
 *
 * Everything runs on fixed steps (exact and frame-rate independent; nothing moves while paused).
 * Death is handled outside (PlayerHealth `died` → GAME_OVER); here it simply stops the waves.
 */

import { Vector3 } from 'three';
import type { CombatEvents } from '../combat/CombatSystem';
import type { ImplementedEnemyId } from '../config/enemies';
import { MUTATIONS, type MutationId } from '../config/mutations';
import {
  WAVE_RULES,
  type CompositionModifier,
  type SpawnRegionId,
  type WaveDefinition,
  type WaveRules,
} from '../config/waves';
import { EventBus, type Unsubscribe } from '../core/EventBus';
import type { FixedUpdateSystem } from '../core/Game';
import type { GameStateMachine } from '../core/GameState';
import type { EnemyManager } from '../enemies/EnemyManager';
import type { EnemyTarget } from '../enemies/types';
import type { PlayerHealthEvents } from '../player/PlayerHealth';
import { Rng } from '../utils/Rng';
import { countDown } from '../weapons/timing';
import type { WaveEvents } from './events';
import { RunStats } from './RunStats';
import type { SpawnDirector, SpawnViewer } from './SpawnDirector';
import { mutationRng, selectMutation } from './WaveMutation';
import { generateWave } from './WaveGenerator';

export interface WaveManagerOptions {
  readonly state: GameStateMachine;
  readonly enemies: EnemyManager;
  readonly spawns: SpawnDirector;
  /** Who the horde is after (the player). */
  readonly target: () => EnemyTarget | null;
  /** Where the player is looking from (fair spawns). */
  readonly viewer: () => SpawnViewer;
  /** The session seed; each run draws from its own streams derived from it (D-014). */
  readonly seed: number | string;
  /** Headshots and progress on wave enemies (optional: stats and the straggler rule). */
  readonly combat?: EventBus<CombatEvents>;
  /** Damage taken (optional: stats). */
  readonly player?: EventBus<PlayerHealthEvents>;
  /** Adaptive and mutation influences on the next wave (Phases 7–8); none by default. */
  readonly modifiers?: () => readonly CompositionModifier[];
  /** Called when a wave is generated, before it starts (the views prewarm its looks). */
  readonly onPrepare?: (definition: WaveDefinition) => void;
  readonly rules?: WaveRules;
  /** Keep going past the final wave instead of VICTORY (O-5). */
  readonly endless?: boolean;
}

export interface WaveStatus {
  readonly wave: number;
  readonly state: string;
  readonly theme: string | null;
  readonly budget: number;
  readonly queued: number;
  readonly alive: number;
  readonly remaining: number;
  readonly spawned: number;
  readonly killed: number;
  readonly maxAlive: number;
  /** Seconds of the intro or breather left (0 otherwise). */
  readonly timer: number;
  /** Seconds since the wave went active. */
  readonly activeTime: number;
  readonly endless: boolean;
  readonly spawningPaused: boolean;
  /** The wave's Signal Mutation (D-045), if any. */
  readonly mutation: MutationId | null;
  /** Surges (extra spawn events): done of total, and one announced but not arrived yet. */
  readonly surges: {
    readonly done: number;
    readonly total: number;
    readonly pending: { readonly region: SpawnRegionId; readonly arrivesIn: number } | null;
  };
}

const _dir = new Vector3();

export class WaveManager implements FixedUpdateSystem {
  readonly events = new EventBus<WaveEvents>();
  readonly stats = new RunStats();
  /** Keep going past the final wave (O-5). */
  endless: boolean;
  /** Debug: no new spawns (the wave still completes when its enemies are gone). */
  spawningPaused = false;
  /** Debug: when false, waves carry no mutation. */
  mutationsEnabled = true;

  private readonly options: WaveManagerOptions;
  private readonly rules: WaveRules;
  private readonly unsubscribe: Unsubscribe[] = [];
  private attached = false;
  private runSeed = '';
  private runs = 0;
  private rng = new Rng(0);

  private waveNumber = 0;
  private def: WaveDefinition | null = null;
  private head = 0;
  private readonly alive = new Set<string>();
  private spawnedCount = 0;
  private killedCount = 0;
  /** Seconds of the intro (WAVE_START) or breather (WAVE_COMPLETE) left. */
  private timer = 0;
  private activeTime = 0;
  private nextGroupAt = 0;
  private deferredFor = 0;
  private deferredNotified = false;
  private lastProgress = 0;
  private lastKillAt = 0;
  private pulled: { sourceId: string; region: SpawnRegionId } | null = null;
  /** The mutations this run has met, in order (the selector never repeats the last). */
  private mutationLog: { readonly wave: number; readonly id: MutationId }[] = [];
  /** Debug: the next generated wave's mutation ('none': no mutation). */
  private forcedMutation: MutationId | 'none' | null = null;
  /** The next surge of the wave (index into `definition.surges`), and one announced. */
  private surgeIndex = 0;
  private surgePending: {
    readonly region: SpawnRegionId;
    readonly pointId: string;
    readonly readyAt: number;
  } | null = null;
  /** Debug: the wave to start next (a jump), and whether to skip the completion. */
  private jumpTo: number | null = null;
  private skipping = false;

  constructor(options: WaveManagerOptions) {
    this.options = options;
    this.rules = options.rules ?? WAVE_RULES;
    this.endless = options.endless ?? false;
  }

  /** The wave in progress (0 before the first). */
  get wave(): number {
    return this.waveNumber;
  }

  /** The current wave's definition. */
  get definition(): WaveDefinition | null {
    return this.def;
  }

  /** The current run's seed (debug previews regenerate waves from it). */
  get seed(): string {
    return this.runSeed;
  }

  /** The spawn point chooser (debug view). */
  get spawns(): SpawnDirector {
    return this.options.spawns;
  }

  /** Whether the runtime drives the run (false in the sandbox mode). */
  get isAttached(): boolean {
    return this.attached;
  }

  get status(): WaveStatus {
    const queued = this.def ? this.def.spawns.length - this.head : 0;
    return {
      wave: this.waveNumber,
      state: this.options.state.current,
      theme: this.def?.theme ?? null,
      budget: this.def?.enemyBudget ?? 0,
      queued,
      alive: this.alive.size,
      remaining: queued + this.alive.size,
      spawned: this.spawnedCount,
      killed: this.killedCount,
      maxAlive: this.def?.maxAlive ?? 0,
      timer: this.timer,
      activeTime: this.activeTime,
      endless: this.endless,
      spawningPaused: this.spawningPaused,
      mutation: this.def?.mutation ?? null,
      surges: {
        done: this.surgeIndex,
        total: this.def?.surges.length ?? 0,
        pending: this.surgePending
          ? {
              region: this.surgePending.region,
              arrivesIn: Math.max(0, this.surgePending.readyAt - this.activeTime),
            }
          : null,
      },
    };
  }

  /** The mutations this run has met so far, by wave. */
  get mutations(): readonly { readonly wave: number; readonly id: MutationId }[] {
    return this.mutationLog;
  }

  /** Whether `id` is one of the current wave's living enemies. */
  isWaveEnemy(id: string): boolean {
    return this.alive.has(id);
  }

  /** Starts driving the run (state hooks and event listeners). Returns the detach function. */
  attach(): Unsubscribe {
    if (this.attached) {
      return () => {
        this.detach();
      };
    }
    this.attached = true;
    const { state, enemies, combat, player } = this.options;
    this.unsubscribe.push(
      state.onEnter('PLAYING', () => {
        this.startRun();
      }),
      state.onEnter('WAVE_START', () => {
        this.beginWave();
      }),
      state.onEnter('WAVE_ACTIVE', () => {
        this.activate();
      }),
      state.onEnter('WAVE_COMPLETE', () => {
        this.complete();
      }),
      state.onEnter('UPGRADE_SELECTION', () => {
        // Placeholder until upgrades and the Supply Terminal exist (Phase 9).
        state.transition('WAVE_START');
      }),
      enemies.events.on('died', (e) => {
        this.stats.recordKill(e.archetype, e.traits.includes('elite'));
        if (this.alive.delete(e.id)) {
          this.killedCount++;
          this.lastProgress = this.activeTime;
          this.lastKillAt = this.activeTime;
          this.progress();
        }
      }),
      enemies.events.on('despawned', (e) => {
        if (this.alive.delete(e.id)) {
          this.progress();
        }
      }),
      enemies.events.on('alarm', (alarm) => {
        // Only an alarm that calls the horde in (a Screamer's scream) pulls a group forward; a
        // DEATH CRY never does (D-045).
        if (alarm.reinforcements) {
          this.onAlarm(alarm.sourceId, alarm.position);
        }
      }),
    );
    if (combat) {
      this.unsubscribe.push(
        combat.on('damaged', (e) => {
          if (this.alive.has(e.targetId)) {
            this.lastProgress = this.activeTime;
          }
          if (e.critical && e.source !== 'direct' && enemies.get(e.targetId)) {
            this.stats.headshots++;
          }
        }),
      );
    }
    if (player) {
      this.unsubscribe.push(
        player.on('damaged', (e) => {
          this.stats.damageTaken += e.amount;
        }),
      );
    }
    return () => {
      this.detach();
    };
  }

  detach(): void {
    for (const off of this.unsubscribe) {
      off();
    }
    this.unsubscribe.length = 0;
    this.attached = false;
  }

  /** A new run: wave 0, fresh stats and streams. Called on entering PLAYING. */
  startRun(): void {
    this.runs++;
    this.runSeed = `${this.options.seed}:run:${this.runs}`;
    this.rng = new Rng(`${this.runSeed}:spawns`);
    this.options.spawns.reset(new Rng(`${this.runSeed}:spawn-points`));
    this.stats.reset();
    this.mutationLog = [];
    this.forcedMutation = null;
    this.waveNumber = 0;
    this.def = null;
    this.head = 0;
    this.alive.clear();
    this.spawnedCount = 0;
    this.killedCount = 0;
    this.timer = 0;
    this.activeTime = 0;
    this.pulled = null;
    this.jumpTo = null;
    this.skipping = false;
    this.spawningPaused = false;
  }

  fixedUpdate(dt: number): void {
    if (!this.attached) {
      return;
    }
    switch (this.options.state.current) {
      case 'WAVE_START':
        this.timer = countDown(this.timer, dt);
        if (this.timer <= 0) {
          this.options.state.transition(this.def?.bossFlag ? 'BOSS' : 'WAVE_ACTIVE');
        }
        break;
      case 'WAVE_ACTIVE':
        this.activeTime += dt;
        this.surgeDue();
        this.spawnDue();
        this.checkStragglers();
        if (this.def && this.head >= this.def.spawns.length && this.alive.size === 0) {
          this.options.state.transition('WAVE_COMPLETE');
        }
        break;
      case 'WAVE_COMPLETE':
        this.timer = countDown(this.timer, dt);
        if (this.timer <= 0) {
          this.options.state.transition('UPGRADE_SELECTION');
        }
        break;
      default:
        break;
    }
  }

  // ---- debug controls --------------------------------------------------------------------------

  /** Jumps to wave `n` (its intro starts now); the current wave's enemies are removed. */
  startWave(n: number, mutation?: MutationId | 'none'): boolean {
    const { state } = this.options;
    const wave = Math.max(1, Math.floor(n));
    if (!this.attached || !Number.isFinite(n)) {
      return false;
    }
    if (mutation !== undefined) {
      if (mutation !== 'none' && MUTATIONS[mutation].status !== 'enabled') {
        return false;
      }
      this.forcedMutation = mutation;
    }
    switch (state.current) {
      case 'WAVE_START':
        this.jumpTo = wave;
        this.clearWave();
        this.beginWave();
        return true;
      case 'WAVE_ACTIVE':
        this.jumpTo = wave;
        this.clearWave();
        this.skipping = true;
        return state.transition('WAVE_COMPLETE');
      case 'WAVE_COMPLETE':
        this.jumpTo = wave;
        this.skipping = false;
        return state.transition('UPGRADE_SELECTION');
      case 'UPGRADE_SELECTION':
        this.jumpTo = wave;
        return state.transition('WAVE_START');
      default:
        return false;
    }
  }

  /**
   * Debug: gives a wave `mutation` ('none': no mutation). During the intro the current wave is
   * generated again with it; otherwise the next wave gets it. Deferred mutations are refused.
   */
  forceMutation(mutation: MutationId | 'none'): boolean {
    if (!this.attached || (mutation !== 'none' && MUTATIONS[mutation].status !== 'enabled')) {
      return false;
    }
    this.forcedMutation = mutation;
    if (this.options.state.current === 'WAVE_START') {
      this.jumpTo = this.waveNumber;
      this.clearWave();
      this.beginWave();
    }
    return true;
  }

  /** Clears the current wave now: nothing more spawns, its enemies die. Returns how many. */
  completeWave(): number {
    if (this.options.state.current !== 'WAVE_ACTIVE' || !this.def) {
      return 0;
    }
    this.head = this.def.spawns.length;
    let killed = 0;
    for (const id of [...this.alive]) {
      if (this.options.enemies.kill(id)) {
        killed++;
      }
    }
    return killed;
  }

  /** Ends the intro or breather now. */
  skipTimer(): boolean {
    const current = this.options.state.current;
    if (current !== 'WAVE_START' && current !== 'WAVE_COMPLETE') {
      return false;
    }
    this.timer = 0;
    return true;
  }

  // ---- phases ------------------------------------------------------------------------------------

  private beginWave(): void {
    this.waveNumber = this.jumpTo ?? this.waveNumber + 1;
    this.jumpTo = null;
    this.skipping = false;
    // A wave generated again (a debug jump within the intro) forgets its earlier mutation.
    this.mutationLog = this.mutationLog.filter((m) => m.wave !== this.waveNumber);
    const forced = this.forcedMutation;
    this.forcedMutation = null;
    const mutation =
      forced === 'none' || !this.mutationsEnabled
        ? null
        : (forced ??
          selectMutation(
            this.waveNumber,
            this.mutationLog.map((m) => m.id),
            mutationRng(this.runSeed, this.waveNumber),
          ));
    if (mutation) {
      this.mutationLog.push({ wave: this.waveNumber, id: mutation });
    }
    this.stats.recordMutation(this.waveNumber, mutation);
    const def = generateWave(
      this.waveNumber,
      { seed: this.runSeed, modifiers: this.options.modifiers?.() ?? [], mutation },
      this.rules,
    );
    this.def = def;
    this.head = 0;
    this.surgeIndex = 0;
    this.surgePending = null;
    this.alive.clear();
    this.spawnedCount = 0;
    this.killedCount = 0;
    this.activeTime = 0;
    this.pulled = null;
    this.timer = this.rules.introTime;
    this.stats.waveReached = this.waveNumber;
    // Ready the pools for the wave's peak concurrency per archetype (no mid-fight allocation).
    for (const [archetype, count] of Object.entries(def.enemyComposition) as [
      ImplementedEnemyId,
      number,
    ][]) {
      this.options.enemies.reserve(archetype, Math.min(count, def.maxAlive));
    }
    this.options.onPrepare?.(def);
    this.events.emit('waveStarting', { wave: this.waveNumber, definition: def });
    this.progress();
  }

  private activate(): void {
    this.activeTime = 0;
    this.nextGroupAt = this.rules.firstGroupDelay;
    this.deferredFor = 0;
    this.deferredNotified = false;
    this.lastProgress = 0;
    this.lastKillAt = 0;
    this.events.emit('waveStarted', { wave: this.waveNumber });
  }

  private complete(): void {
    const { state } = this.options;
    if (this.skipping) {
      // A debug jump: no stats, no breather.
      this.skipping = false;
      state.transition('UPGRADE_SELECTION');
      return;
    }
    const def = this.def;
    this.stats.wavesCleared++;
    const duration = this.lastKillAt;
    this.stats.waveTimes.push(duration);
    this.events.emit('waveCompleted', {
      wave: this.waveNumber,
      duration,
      kills: this.killedCount,
      finale: def?.finale ?? false,
      stats: this.stats.snapshot(),
    });
    if (def?.finale && !this.endless) {
      this.events.emit('runVictory', { wave: this.waveNumber, stats: this.stats.snapshot() });
      state.transition('VICTORY');
      return;
    }
    this.timer = this.rules.breather;
  }

  // ---- spawning ----------------------------------------------------------------------------------

  private spawnDue(): void {
    const def = this.def;
    if (!def || this.spawningPaused || this.head >= def.spawns.length) {
      return;
    }
    if (this.activeTime + 1e-9 < this.nextGroupAt) {
      return;
    }
    const room = def.maxAlive - this.alive.size;
    if (room <= 0) {
      return; // wait for a kill; no backlog builds up
    }
    const size = Math.min(
      this.rng.int(def.groupSize.min, def.groupSize.max),
      def.spawns.length - this.head,
      room,
    );
    const relaxed = this.deferredFor >= this.rules.spawn.relaxAfter - 1e-9;
    const bias = this.pulled ? [...def.spawnBias, this.pulled.region] : def.spawnBias;
    const result = this.spawnGroup(size, bias, relaxed);
    if (!result) {
      this.deferredFor += this.rules.spawn.retryInterval;
      this.nextGroupAt = this.activeTime + this.rules.spawn.retryInterval;
      if (!this.deferredNotified) {
        this.deferredNotified = true;
        this.events.emit('spawnDeferred', { wave: this.waveNumber, reason: 'noPoint' });
      }
      return;
    }
    const { spawned } = result;
    this.deferredFor = 0;
    this.deferredNotified = false;
    this.nextGroupAt = this.activeTime + Math.max(1, spawned) / def.spawnRate;
    if (this.pulled && spawned > 0) {
      this.events.emit('reinforcementsPulled', {
        wave: this.waveNumber,
        alarmSourceId: this.pulled.sourceId,
        count: spawned,
      });
      this.pulled = null;
    }
  }

  /**
   * Spawns the next `size` queued enemies around one fair spawn point (never more than the room
   * under `maxAlive`, which the caller checked; the living cap is checked again per enemy).
   * Returns null when no point is eligible.
   */
  private spawnGroup(
    size: number,
    bias: readonly SpawnRegionId[],
    relaxed: boolean,
    prefer?: SpawnRegionId,
  ): { spawned: number; pointId: string; region: SpawnRegionId } | null {
    const def = this.def;
    if (!def || size <= 0) {
      return null;
    }
    const group = def.spawns.slice(this.head, this.head + size);
    const pick = this.options.spawns.pick(
      group.map((s) => s.archetype),
      this.options.viewer(),
      bias,
      relaxed,
      prefer,
    );
    if (!pick) {
      return null;
    }
    const target = this.options.target();
    let spawned = 0;
    group.forEach((entry, i) => {
      const at = pick.positions[i];
      if (!at || spawned < i) {
        return;
      }
      const yaw = target ? Math.atan2(-(target.position.x - at.x), -(target.position.z - at.z)) : 0;
      const enemy = this.options.enemies.spawn(entry.archetype, at, {
        yaw,
        patrol: false,
        traits: entry.traits,
        ...(target?.isAlive() ? { alertTo: target } : {}),
      });
      if (!enemy) {
        return; // the living cap: the rest stays queued
      }
      spawned++;
      this.alive.add(enemy.id);
      this.events.emit('enemySpawned', {
        wave: this.waveNumber,
        id: enemy.id,
        archetype: entry.archetype,
        traits: entry.traits,
        spawnPointId: pick.point.id,
        relaxed: pick.relaxed,
      });
    });
    this.head += spawned;
    this.spawnedCount += spawned;
    this.lastProgress = this.activeTime;
    if (pick.relaxed) {
      this.stats.relaxedSpawns++;
    }
    this.progress();
    return { spawned, pointId: pick.point.id, region: pick.point.region };
  }

  /**
   * Surges (D-045; e.g. HIVE): when the queue reaches a surge's point, it is announced (with the
   * region it will come from), and after its warning a bigger group arrives there. Same spawn
   * rules as any group; never above `maxAlive` (it waits for room and brings only what fits).
   */
  private surgeDue(): void {
    const def = this.def;
    const surge = def?.surges[this.surgeIndex];
    if (!def || !surge || this.spawningPaused) {
      return;
    }
    const queued = def.spawns.length - this.head;
    if (!this.surgePending) {
      if (queued <= 0 || this.head / def.spawns.length < surge.at - 1e-9) {
        return;
      }
      // Announce it: where it will come from is decided now, from what is eligible now.
      const lead = def.spawns[this.head]?.archetype ?? 'walker';
      const viewer = this.options.viewer();
      const points = this.options.spawns.all.filter(
        (p) => this.options.spawns.status(p, viewer, lead) === 'eligible',
      );
      const point = points.length > 0 ? points[this.rng.int(0, points.length - 1)] : undefined;
      if (!point) {
        return; // nothing eligible: try again next step
      }
      this.surgePending = {
        region: point.region,
        pointId: point.id,
        readyAt: this.activeTime + surge.warning,
      };
      this.events.emit('surgeWarning', {
        wave: this.waveNumber,
        index: this.surgeIndex,
        region: point.region,
        pointId: point.id,
        size: Math.min(surge.size, queued),
        arrivesIn: surge.warning,
      });
      return;
    }
    if (this.activeTime + 1e-9 < this.surgePending.readyAt) {
      return;
    }
    if (queued <= 0) {
      // The queue ran out before it arrived: nothing left to surge.
      this.surgeIndex++;
      this.surgePending = null;
      return;
    }
    const room = def.maxAlive - this.alive.size;
    if (room <= 0) {
      return; // waits for room; never over the cap
    }
    const pending = this.surgePending;
    const result = this.spawnGroup(Math.min(surge.size, queued, room), [], false, pending.region);
    if (!result) {
      return; // no eligible point this step: try again
    }
    this.events.emit('surgeSpawned', {
      wave: this.waveNumber,
      index: this.surgeIndex,
      region: result.region,
      pointId: result.pointId,
      count: result.spawned,
    });
    this.surgeIndex++;
    this.surgePending = null;
    this.nextGroupAt = Math.max(
      this.nextGroupAt,
      this.activeTime + Math.max(1, result.spawned) / def.spawnRate,
    );
  }

  /** An alarm pulls the next queued group forward, toward the alarm (no extra budget). */
  private onAlarm(sourceId: string, position: readonly number[]): void {
    const def = this.def;
    if (
      this.options.state.current !== 'WAVE_ACTIVE' ||
      !def ||
      this.head >= def.spawns.length ||
      this.pulled
    ) {
      return;
    }
    // The region of the spawn point nearest the alarm.
    let best: SpawnRegionId | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const point of this.options.spawns.all) {
      if (point.tags?.includes('elevated')) {
        continue;
      }
      const d = Math.hypot(
        point.position[0] - (position[0] ?? 0),
        point.position[2] - (position[2] ?? 0),
      );
      if (d < bestDistance) {
        bestDistance = d;
        best = point.region;
      }
    }
    if (best) {
      this.pulled = { sourceId, region: best };
      this.nextGroupAt = Math.min(this.nextGroupAt, this.activeTime);
    }
  }

  /** A wave cannot stall on a few enemies that cannot reach the player: move them. */
  private checkStragglers(): void {
    const def = this.def;
    const s = this.rules.stragglers;
    if (
      !def ||
      this.head < def.spawns.length ||
      this.alive.size === 0 ||
      this.alive.size > s.maxRemaining ||
      this.activeTime - this.lastProgress < s.timeout - 1e-9
    ) {
      return;
    }
    this.lastProgress = this.activeTime;
    const target = this.options.target();
    if (!target) {
      return;
    }
    const moved: string[] = [];
    for (const id of [...this.alive]) {
      const enemy = this.options.enemies.get(id);
      if (!enemy?.alive) {
        continue;
      }
      const p = enemy.motor.position;
      if (_dir.copy(p).sub(target.position).setY(0).length() <= s.farDistance) {
        continue;
      }
      const archetype = enemy.archetype.id;
      const traits = [...enemy.config.traits];
      const pick = this.options.spawns.pick([archetype], this.options.viewer());
      const at = pick?.positions[0];
      if (!pick || !at) {
        continue;
      }
      this.alive.delete(id);
      this.options.enemies.despawn(id);
      const again = this.options.enemies.spawn(archetype, at, {
        patrol: false,
        traits,
        ...(target.isAlive() ? { alertTo: target } : {}),
      });
      if (again) {
        this.alive.add(again.id);
        moved.push(again.id);
      }
    }
    if (moved.length > 0) {
      this.stats.stragglersMoved += moved.length;
      this.events.emit('stragglers', { wave: this.waveNumber, ids: moved });
    }
  }

  /** Removes the current wave's enemies without a fight (debug jumps). */
  private clearWave(): void {
    for (const id of [...this.alive]) {
      this.options.enemies.despawn(id);
    }
    this.alive.clear();
    if (this.def) {
      this.head = this.def.spawns.length;
    }
  }

  private progress(): void {
    const queued = this.def ? this.def.spawns.length - this.head : 0;
    this.events.emit('waveProgress', {
      wave: this.waveNumber,
      remaining: queued + this.alive.size,
      alive: this.alive.size,
      queued,
    });
  }
}
