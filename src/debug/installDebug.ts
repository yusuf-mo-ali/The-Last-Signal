/**
 * Development tools entry point (D-020, D-035). `main.ts` loads this module only inside an
 * `import.meta.env.DEV` branch via dynamic import, so production builds contain none of it.
 *
 * Installs:
 * - `window.tls`: a structured command interface (`tls.help()` lists everything). Replaces the
 *   Phase 0.3–0.4 `__TLS_DEV__` handle; `tls.inspect()` returns the live objects for tooling.
 * - A stats overlay (FPS, frame interval, our frame cost, steps, renderer counters, state, input),
 *   toggled with the `ENGINE_CONFIG.debug.overlayToggleKey` key (Backquote) or `tls.overlay()`.
 *   While hidden, the frame probe is detached, so instrumentation costs nothing.
 */

import './debug.css';
import { Vector3, type Scene } from 'three';
import type { CombatSystem, DamagedEvent } from '../combat/CombatSystem';
import type { TrainingRange } from '../combat/training/TrainingRange';
import { DAMAGE_ZONES, type DamageZone } from '../config/enemies';
import { PICKUP_IDS, type PickupId } from '../config/drops';
import { TRAINING_DUMMY_KINDS, type TrainingDummyKind } from '../config/training';
import { ENGINE_CONFIG, type ViewSettings } from '../core/Config';
import type { ErrorHandler } from '../core/ErrorHandler';
import type { Game } from '../core/Game';
import { GameStateId } from '../core/GameState';
import type { InputState } from '../input/InputState';
import type { PointerLock } from '../input/PointerLock';
import type { Player } from '../player/Player';
import {
  LOADOUT_CATEGORIES,
  WEAPON_IDS,
  type LoadoutCategory,
  type WeaponId,
} from '../config/weapons';
import type { WeaponManager } from '../weapons/WeaponManager';
import type { Renderer } from '../render/Renderer';
import type { CombatFeedback } from '../ui/CombatFeedback';
import type { PickupManager } from '../world/PickupManager';
import { DebugCommands, type DebugApi } from './DebugCommands';
import { DebugOverlay } from './DebugOverlay';
import { FrameStats, type FrameStatsSnapshot } from './FrameStats';
import { HitboxDebugView } from './HitboxDebugView';

/** Everything the debug tools may inspect. Passed in from the composition root. */
export interface DebugContext {
  readonly game: Game;
  readonly renderer: Renderer;
  readonly input: InputState;
  readonly pointerLock: PointerLock;
  readonly errors: ErrorHandler;
  readonly container: HTMLElement;
  /** The player, for `tls.player()`, `tls.teleportPlayer()` and `tls.look()`. */
  readonly player?: Player;
  /** The loadout, for `tls.weapons()`, `tls.giveAmmo()`, `tls.giveWeapon()`, … */
  readonly weapons?: WeaponManager;
  /** Combat, for `tls.combat()`, `tls.dummies()`, `tls.spawnDummy()`, `tls.showHitboxes()`, … */
  readonly combat?: CombatSystem;
  readonly training?: TrainingRange;
  readonly pickups?: PickupManager;
  readonly feedback?: CombatFeedback;
  /** The world scene, for debug drawing (hitboxes). */
  readonly scene?: Scene;
  /** View settings access, for `tls.view()`. */
  readonly getView?: () => ViewSettings;
  readonly applyView?: (settings: ViewSettings) => ViewSettings;
  /** Extra objects exposed through `tls.inspect()` (e.g. the world and the camera). */
  readonly extras?: Readonly<Record<string, unknown>>;
}

export interface DebugTools {
  readonly api: DebugApi;
  readonly commands: DebugCommands;
  readonly dispose: () => void;
}

declare global {
  interface Window {
    tls?: DebugApi;
  }
}

/** Plan §29 commands whose systems arrive in later phases. */
const PLANNED_COMMANDS: readonly (readonly [string, string, string])[] = [
  ['healPlayer', 'Restore full health', 'Phase 4 (enemies attack the player)'],
  ['setGodMode', 'Toggle invulnerability', 'Phase 4 (enemies attack the player)'],
  ['spawnEnemy', 'Spawn an enemy of a given type', 'Phase 4 (zombie foundation)'],
  ['killAll', 'Kill every enemy', 'Phase 4 (zombie foundation)'],
  ['startWave', 'Start a given wave number', 'Phase 6 (wave system)'],
  ['triggerMutation', 'Apply a Signal Mutation', 'Phase 7 (mutations)'],
  ['spawnBoss', 'Spawn a boss', 'Phase 13 (bosses)'],
];

export function installDebug(context: DebugContext): DebugTools {
  const { game, renderer, input, pointerLock, errors, container } = context;
  const config = ENGINE_CONFIG.debug;
  const win = container.ownerDocument.defaultView;
  if (!win) {
    throw new Error('installDebug: container is not attached to a window');
  }

  // ---- overlay + frame probe ---------------------------------------------------------------
  const stats = new FrameStats(config.frameSampleSize, () => performance.now());
  const overlay = new DebugOverlay(container);
  let lastRefresh = 0;
  let lastSnapshot: FrameStatsSnapshot = stats.snapshot();

  const refresh = (): void => {
    lastSnapshot = stats.snapshot();
    overlay.setText(formatOverlay(lastSnapshot, context));
  };
  const probe = {
    frameStart: (): void => {
      stats.frameStart();
    },
    frameEnd: (steps: number): void => {
      stats.frameEnd(steps);
      const now = performance.now();
      if (now - lastRefresh >= config.overlayRefreshMs) {
        lastRefresh = now;
        refresh();
      }
    },
  };
  const setOverlay = (visible: boolean): boolean => {
    overlay.setVisible(visible);
    stats.reset();
    // Hidden overlay = no probe: the game loop pays a single null check (requirement: negligible cost).
    game.setFrameProbe(visible ? probe : null);
    if (visible) {
      overlay.setText('sampling…');
    }
    return visible;
  };
  setOverlay(true);

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.code === config.overlayToggleKey && !event.repeat) {
      setOverlay(!overlay.visible);
    }
  };
  win.addEventListener('keydown', onKeyDown);

  // ---- commands ----------------------------------------------------------------------------
  const commands = new DebugCommands();
  const inspectable = Object.freeze({
    game,
    renderer,
    input,
    pointerLock,
    errors,
    ...(context.player ? { player: context.player } : {}),
    ...(context.weapons ? { weapons: context.weapons } : {}),
    ...(context.combat ? { combat: context.combat } : {}),
    ...(context.training ? { training: context.training } : {}),
    ...(context.pickups ? { pickups: context.pickups } : {}),
    ...(context.feedback ? { feedback: context.feedback } : {}),
    ...context.extras,
  });

  commands.register(
    'inspect',
    'Live objects: game, renderer, input, pointerLock, errors, player, weapons, combat, world, …',
    () => inspectable,
  );
  commands.register('state', 'Current game state (and the suspended phase while paused)', () => ({
    current: game.state.current,
    pausedState: game.state.pausedState,
    runActive: game.state.isRunActive,
    timeScale: game.time.scale,
  }));
  commands.register(
    'transition',
    'Request a game state transition: tls.transition("LOADING")',
    (to: string) => {
      if (!(to in GameStateId)) {
        throw new Error(`Unknown state "${to}". States: ${Object.keys(GameStateId).join(', ')}`);
      }
      return game.state.transition(to as GameStateId);
    },
  );
  commands.register('pause', 'Pause the current run', () => game.state.pause());
  commands.register('resume', 'Resume a paused run', () => game.state.resume());
  commands.register('stats', 'Frame statistics (sampled while the overlay is visible)', () => ({
    overlayVisible: overlay.visible,
    frame: overlay.visible ? stats.snapshot() : lastSnapshot,
    time: {
      simTime: game.time.simTime,
      stepCount: game.time.stepCount,
      droppedTime: game.time.droppedTime,
    },
    renderer: {
      drawCalls: renderer.webgl.info.render.calls,
      triangles: renderer.webgl.info.render.triangles,
      programs: renderer.webgl.info.programs?.length ?? 0,
      contextLost: renderer.context.lost,
      contextLosses: renderer.context.lossCount,
      viewport: renderer.viewport,
    },
  }));
  commands.register(
    'overlay',
    'Show/hide the stats overlay (Backquote key): tls.overlay(false)',
    (visible?: boolean) => setOverlay(visible ?? !overlay.visible),
  );
  commands.register('errors', 'Errors reported this session', () => ({
    count: errors.count,
    fatal: errors.fatal,
    reports: errors.reports,
  }));
  commands.register('loseContext', 'Simulate a WebGL context loss (WEBGL_lose_context)', () => {
    renderer.webgl.forceContextLoss();
    return 'context loss requested';
  });
  commands.register('restoreContext', 'Restore the WebGL context after tls.loseContext()', () => {
    renderer.webgl.forceContextRestore();
    return 'context restore requested';
  });
  commands.register(
    'throwError',
    'Force an error to test the error screen: "frame" (default), "async" or "rejection"',
    (kind: 'frame' | 'async' | 'rejection' = 'frame') => {
      const error = new Error(`Debug: forced ${kind} error`);
      if (kind === 'async') {
        setTimeout(() => {
          throw error;
        });
      } else if (kind === 'rejection') {
        void Promise.reject(error);
      } else {
        // Thrown from inside the next frame, through the real loop and window error path.
        game.setPresentation(throwingPresentation(error));
      }
      return `forced ${kind} error scheduled`;
    },
  );
  registerPlayerCommands(commands, context);
  registerWeaponCommands(commands, context);
  const disposeCombat = registerCombatCommands(commands, context);
  for (const [name, description, plannedFor] of PLANNED_COMMANDS) {
    commands.registerStub(name, description, plannedFor);
  }

  const api = commands.toApi();
  win.tls = api;
  console.info(
    '[debug] Development tools ready: tls.help() lists commands; ` toggles the overlay.',
  );

  return {
    api,
    commands,
    dispose: () => {
      win.removeEventListener('keydown', onKeyDown);
      game.setFrameProbe(null);
      disposeCombat();
      overlay.dispose();
      if (win.tls === api) {
        delete win.tls;
      }
    },
  };
}

function registerPlayerCommands(commands: DebugCommands, context: DebugContext): void {
  const { player, getView, applyView } = context;
  if (player) {
    const { motor, look } = player;
    commands.register(
      'player',
      'Player position, velocity, grounded/crouch state and look',
      () => ({
        position: motor.position.toArray(),
        velocity: motor.velocity.toArray(),
        speed: motor.horizontalSpeed,
        grounded: motor.grounded,
        crouched: motor.crouched,
        sprinting: motor.sprinting,
        eyeHeight: motor.eyeHeight,
        yaw: look.yaw,
        pitch: look.pitch,
        respawns: motor.respawns,
        groundDistance: motor.groundDistance,
      }),
    );
    commands.register(
      'teleportPlayer',
      'Move the player to a position (feet): tls.teleportPlayer(x, y, z, yaw?)',
      (x: number, y: number, z: number, yaw?: number) => {
        if (![x, y, z].every(Number.isFinite)) {
          throw new Error('teleportPlayer(x, y, z, yaw?) needs three finite numbers');
        }
        motor.teleport(new Vector3(x, y, z));
        if (yaw !== undefined) {
          look.setAngles(yaw, 0);
        }
        return motor.position.toArray();
      },
    );
    commands.register(
      'look',
      'Set the view angles in radians: tls.look(yaw, pitch?) (yaw 0 faces north, −z)',
      (yaw: number, pitch?: number) => {
        look.setAngles(yaw, pitch);
        return { yaw: look.yaw, pitch: look.pitch };
      },
    );
  }
  if (getView && applyView) {
    commands.register(
      'view',
      'Get or change view settings: tls.view({ fov: 75, sensitivity: 1.5, invertY: false, headBob: true })',
      (changes?: Partial<ViewSettings>) =>
        changes ? applyView({ ...getView(), ...changes }) : getView(),
    );
  }
}

function registerWeaponCommands(commands: DebugCommands, context: DebugContext): void {
  const { weapons } = context;
  if (!weapons) {
    return;
  }
  const snapshot = () => {
    const held = weapons.activeWeapon.getState();
    // JSON has no Infinity: report the Pistol's unlimited reserve readably.
    const ammo = held.ammo && {
      ...held.ammo,
      reserve: Number.isFinite(held.ammo.reserve) ? held.ammo.reserve : 'unlimited',
    };
    return {
      loadout: weapons.loadout,
      held: { ...held, ammo },
      switching: weapons.isSwitching,
      quickMeleeing: weapons.isQuickMeleeing,
      infiniteAmmo: weapons.infiniteAmmoEnabled,
    };
  };
  commands.register(
    'weapons',
    'Loadout (Melee, Primary, Secondary), held weapon, ammo, state',
    snapshot,
  );
  commands.register('giveAmmo', 'Refill every magazine and reserve', () => {
    weapons.refillAmmo();
    return snapshot();
  });
  commands.register(
    'setInfiniteAmmo',
    'Shots stop consuming ammunition: tls.setInfiniteAmmo(true)',
    (enabled?: boolean) => {
      weapons.setInfiniteAmmo(enabled ?? !weapons.infiniteAmmoEnabled);
      return weapons.infiniteAmmoEnabled;
    },
  );
  commands.register(
    'giveWeapon',
    `Put a weapon in the loadout: tls.giveWeapon(id, category?) (${WEAPON_IDS.join(', ')})`,
    (id: string, category?: string) => {
      if (!(WEAPON_IDS as readonly string[]).includes(id)) {
        throw new Error(`Unknown weapon "${id}". Weapons: ${WEAPON_IDS.join(', ')}`);
      }
      if (category !== undefined && !(LOADOUT_CATEGORIES as readonly string[]).includes(category)) {
        throw new Error(
          `Unknown category "${category}". Categories: ${LOADOUT_CATEGORIES.join(', ')}`,
        );
      }
      return weapons.acquire(id as WeaponId, category as LoadoutCategory | undefined);
    },
  );
  commands.register(
    'unlockSecondary',
    'Unlock the Secondary category (normally after wave 5)',
    () => weapons.unlockSecondary(),
  );
}

/** The most recent hit, for the overlay (kept by the combat commands' listener). */
let lastHit: DamagedEvent | null = null;

function registerCombatCommands(commands: DebugCommands, context: DebugContext): () => void {
  const { combat, training, pickups, feedback, player, scene, game } = context;
  if (!combat) {
    return () => undefined;
  }
  const disposers: (() => void)[] = [];
  const recent: DamagedEvent[] = [];
  let kills = 0;
  disposers.push(
    combat.events.on('damaged', (e) => {
      lastHit = e;
      recent.push(e);
      if (recent.length > 10) {
        recent.shift();
      }
    }),
    combat.events.on('killed', () => {
      kills++;
    }),
  );
  const round = (n: number) => Math.round(n * 100) / 100;
  commands.register('combat', 'Combat targets, kills and the last 10 hits', () => ({
    targets: combat.targets.length,
    alive: combat.aliveCount,
    kills,
    attackerMultiplier: combat.attackerMultiplier,
    recentHits: recent.map((h) => ({
      target: h.targetId,
      weapon: h.weaponId,
      zone: h.zone,
      critical: h.critical,
      amount: round(h.amount),
      health: round(h.health),
      killed: h.killed,
      distance: round(h.distance),
    })),
  }));

  let hitboxes: HitboxDebugView | null = null;
  let removeHitboxFrame: (() => void) | null = null;
  const setHitboxes = (visible: boolean): boolean => {
    if (visible && !hitboxes && scene) {
      const view = new HitboxDebugView(scene, combat);
      hitboxes = view;
      removeHitboxFrame = game.addFrameSystem({
        frameUpdate: () => {
          view.update();
        },
      });
    } else if (!visible && hitboxes) {
      removeHitboxFrame?.();
      hitboxes.dispose();
      hitboxes = null;
    }
    return hitboxes !== null;
  };
  commands.register(
    'showHitboxes',
    'Draw every target’s hit volumes (HEAD gold): tls.showHitboxes(false) hides them',
    (visible?: boolean) => setHitboxes(visible ?? hitboxes === null),
  );
  disposers.push(() => setHitboxes(false));

  if (feedback) {
    commands.register(
      'damageNumbers',
      'Show/hide floating damage numbers: tls.damageNumbers(false)',
      (enabled?: boolean) => {
        feedback.setDamageNumbers(enabled ?? !feedback.damageNumbersEnabled);
        return feedback.damageNumbersEnabled;
      },
    );
  }

  if (training) {
    const list = () =>
      training.dummies.map((d) => ({
        id: d.id,
        kind: d.definition.kind,
        health: round(d.health.current),
        maxHealth: d.health.max,
        alive: d.health.isAlive,
        deaths: d.deaths,
        respawnIn: round(d.respawnTimer),
        position: d.rig.position.toArray(),
      }));
    commands.register('dummies', 'Training dummies: health, alive, deaths, position', list);
    commands.register(
      'spawnDummy',
      `Place a training dummy facing you: tls.spawnDummy(kind?, distance?) (${TRAINING_DUMMY_KINDS.join(', ')})`,
      (kind = 'standard', distance = 4) => {
        if (!(TRAINING_DUMMY_KINDS as readonly string[]).includes(kind)) {
          throw new Error(`Unknown dummy "${kind}". Kinds: ${TRAINING_DUMMY_KINDS.join(', ')}`);
        }
        if (!player) {
          throw new Error('spawnDummy needs the player');
        }
        const yaw = player.look.yaw;
        const p = player.motor.position;
        const dummy = training.spawn(
          kind as TrainingDummyKind,
          [p.x - Math.sin(yaw) * distance, p.y, p.z - Math.cos(yaw) * distance],
          yaw + Math.PI,
        );
        return dummy.id;
      },
    );
    commands.register('resetDummies', 'Put the training range back as configured', () => {
      training.reset();
      return list();
    });
    commands.register('clearDummies', 'Remove every training dummy', () => {
      training.clear();
      return list();
    });
    commands.register('reviveDummies', 'Stand every dummy up at full health now', () => {
      training.reviveAll();
      return list();
    });
  }

  if (player) {
    const eye = () => {
      const p = player.motor.position;
      return new Vector3(p.x, p.y + player.motor.eyeHeight, p.z);
    };
    const aimAt = (x: number, y: number, z: number) => {
      const from = eye();
      const dx = x - from.x;
      const dy = y - from.y;
      const dz = z - from.z;
      player.look.setAngles(Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz)));
      return { yaw: player.look.yaw, pitch: player.look.pitch };
    };
    commands.register(
      'aimAt',
      'Turn the view to look at a world point: tls.aimAt(x, y, z)',
      (x: number, y: number, z: number) => {
        if (![x, y, z].every(Number.isFinite)) {
          throw new Error('aimAt(x, y, z) needs three finite numbers');
        }
        return aimAt(x, y, z);
      },
    );
    commands.register(
      'aimAtTarget',
      `Aim at the middle of a target’s zone: tls.aimAtTarget(id, zone?) (${DAMAGE_ZONES.join(', ')})`,
      (id: string, zone = 'HEAD') => {
        const target = combat.get(id);
        if (!target) {
          throw new Error(`No combat target "${id}"`);
        }
        const shape = target.rig.definition.shapes.find((s) => s.zone === (zone as DamageZone));
        if (!shape) {
          throw new Error(`Unknown zone "${zone}". Zones: ${DAMAGE_ZONES.join(', ')}`);
        }
        const point =
          shape.kind === 'sphere'
            ? target.rig.toWorld(shape.center)
            : target.rig.toWorld(shape.a).add(target.rig.toWorld(shape.b)).multiplyScalar(0.5);
        return aimAt(point.x, point.y, point.z);
      },
    );
  }

  if (pickups) {
    commands.register('pickups', 'Pickups on the ground', () =>
      pickups.active.map((p) => ({
        id: p.id,
        pickup: p.definition.id,
        position: p.position.toArray(),
        age: round(p.age),
      })),
    );
    commands.register(
      'spawnPickup',
      `Drop a pickup (default: at the player's feet): tls.spawnPickup(id?, x?, y?, z?) (${PICKUP_IDS.join(', ')})`,
      (id = 'ammo', x?: number, y?: number, z?: number) => {
        if (!(PICKUP_IDS as readonly string[]).includes(id)) {
          throw new Error(`Unknown pickup "${id}". Pickups: ${PICKUP_IDS.join(', ')}`);
        }
        const at =
          x !== undefined && y !== undefined && z !== undefined
            ? new Vector3(x, y, z)
            : (player?.motor.position ?? new Vector3());
        return pickups.spawn(id as PickupId, at).id;
      },
    );
  }

  return () => {
    for (const dispose of disposers) {
      dispose();
    }
    lastHit = null;
  };
}

function formatCombat(combat: CombatSystem, hit: DamagedEvent | null): string {
  const last = hit
    ? `  last ${hit.targetId} ${hit.zone} ${hit.amount.toFixed(1)}${hit.critical ? ' crit' : ''}${hit.killed ? ' KILL' : ''}`
    : '';
  return `combat targets ${combat.aliveCount}/${combat.targets.length} alive${last}`;
}

function throwingPresentation(error: Error) {
  return {
    render: (): void => {
      throw error;
    },
  };
}

function formatOverlay(s: FrameStatsSnapshot, context: DebugContext): string {
  const { game, renderer, input, pointerLock, player, weapons } = context;
  const info = renderer.webgl.info;
  const v = renderer.viewport;
  const state = game.state.pausedState
    ? `${game.state.current} (${game.state.pausedState})`
    : game.state.current;
  return [
    `FPS ${s.fps.toFixed(0).padStart(4)}   frame ${s.frameIntervalMs.toFixed(1)} ms`,
    `cost avg ${s.costAvgMs.toFixed(2)}  p95 ${s.costP95Ms.toFixed(2)}  max ${s.costMaxMs.toFixed(2)} ms`,
    `steps/frame ${s.stepsPerFrame.toFixed(2)}  dropped ${game.time.droppedTime.toFixed(2)} s`,
    `draws ${info.render.calls}  tris ${info.render.triangles}  programs ${info.programs?.length ?? 0}`,
    `view ${v.width}×${v.height} @${v.pixelRatio}  ctx ${renderer.context.lost ? 'LOST' : 'ok'}`,
    `state ${state}`,
    ...(player ? [formatPlayer(player)] : []),
    ...(weapons ? [formatWeapons(weapons)] : []),
    ...(context.combat ? [formatCombat(context.combat, lastHit)] : []),
    `lock ${pointerLock.isLocked ? 'on' : 'off'}${pointerLock.isLocked ? (pointerLock.rawInput ? ' raw' : ' accel') : ''}  glitches ${input.discardedMotionEvents}`,
  ].join('\n');
}

function formatPlayer(player: Player): string {
  const m = player.motor;
  const [x, y, z] = m.position.toArray().map((v) => v.toFixed(2));
  const mode = m.crouched ? 'crouch' : m.sprinting ? 'sprint' : 'walk';
  return `player ${x} ${y} ${z}  ${m.horizontalSpeed.toFixed(1)} m/s  ${m.grounded ? 'ground' : 'air'} ${mode}`;
}

function formatWeapons(weapons: WeaponManager): string {
  const status = weapons.activeWeapon.getState();
  const ammo = status.ammo
    ? ` ${status.ammo.magazine}/${Number.isFinite(status.ammo.reserve) ? status.ammo.reserve : '∞'}`
    : '';
  const secondary = weapons.isSecondaryLocked ? 'locked' : 'open';
  return `weapon ${weapons.active}:${status.id}${ammo} ${status.state}  secondary ${secondary}`;
}
