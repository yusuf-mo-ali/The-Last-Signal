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
import { Vector3 } from 'three';
import { ENGINE_CONFIG, type ViewSettings } from '../core/Config';
import type { ErrorHandler } from '../core/ErrorHandler';
import type { Game } from '../core/Game';
import { GameStateId } from '../core/GameState';
import type { InputState } from '../input/InputState';
import type { PointerLock } from '../input/PointerLock';
import type { Player } from '../player/Player';
import type { Renderer } from '../render/Renderer';
import { DebugCommands, type DebugApi } from './DebugCommands';
import { DebugOverlay } from './DebugOverlay';
import { FrameStats, type FrameStatsSnapshot } from './FrameStats';

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
  ['giveAmmo', 'Refill all ammunition', 'Phase 2 (weapon framework)'],
  ['setInfiniteAmmo', 'Toggle infinite ammunition', 'Phase 2 (weapon framework)'],
  ['healPlayer', 'Restore full health', 'Phase 3 (combat: health and damage)'],
  ['setGodMode', 'Toggle invulnerability', 'Phase 3 (combat: health and damage)'],
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
    ...context.extras,
  });

  commands.register(
    'inspect',
    'Live objects: game, renderer, input, pointerLock, errors, player, world, camera, …',
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

function throwingPresentation(error: Error) {
  return {
    render: (): void => {
      throw error;
    },
  };
}

function formatOverlay(s: FrameStatsSnapshot, context: DebugContext): string {
  const { game, renderer, input, pointerLock, player } = context;
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
    `lock ${pointerLock.isLocked ? 'on' : 'off'}${pointerLock.isLocked ? (pointerLock.rawInput ? ' raw' : ' accel') : ''}  glitches ${input.discardedMotionEvents}`,
  ].join('\n');
}

function formatPlayer(player: Player): string {
  const m = player.motor;
  const [x, y, z] = m.position.toArray().map((v) => v.toFixed(2));
  const mode = m.crouched ? 'crouch' : m.sprinting ? 'sprint' : 'walk';
  return `player ${x} ${y} ${z}  ${m.horizontalSpeed.toFixed(1)} m/s  ${m.grounded ? 'ground' : 'air'} ${mode}`;
}
