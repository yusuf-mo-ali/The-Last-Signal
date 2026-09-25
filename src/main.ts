/**
 * Composition root: the only place that wires browser APIs to the game.
 * Simulation (`core/`, `world/`, `player/`) and platform code (`input/`) stay browser-independent;
 * everything that needs the DOM, WebGL or requestAnimationFrame is created here and injected
 * (ARCHITECTURE.md §2, D-003, D-034, D-035).
 */

import './style.css';
import { boundKeyCodes, DEFAULT_BINDINGS } from './config/input';
import { ENGINE_CONFIG, parseGraphicsPreset, type ViewSettings } from './core/Config';
import { ErrorHandler } from './core/ErrorHandler';
import { Game, type FrameScheduler } from './core/Game';
import { ActionMap } from './input/ActionMap';
import { installAutoPause } from './input/autoPause';
import { BrowserInput } from './input/BrowserInput';
import { InputState } from './input/InputState';
import { PointerLock } from './input/PointerLock';
import { attachStepInput } from './input/stepInput';
import { CameraController } from './player/CameraController';
import { Player } from './player/Player';
import { PlayerController } from './player/PlayerController';
import { createCamera } from './render/camera';
import { Renderer } from './render/Renderer';
import { detectWebGL2 } from './render/webglSupport';
import { LockPrompt } from './ui/LockPrompt';
import { StatusScreen } from './ui/StatusScreen';
import { FACILITY, FACILITY_BEACON_POSITION } from './world/levels/facility';
import { World } from './world/World';
import { WorldView } from './world/WorldView';

const browserFrames: FrameScheduler = {
  request: (callback) => requestAnimationFrame(callback),
  cancel: (handle) => {
    cancelAnimationFrame(handle);
  },
};

/** Things a fatal error needs to stop, filled in as boot progresses. */
interface Running {
  game?: Game;
  pointerLock?: PointerLock;
}

function boot(app: HTMLElement): () => void {
  const running: Running = {};
  const cleanups: (() => void)[] = [];
  const status = new StatusScreen(app, {
    onReload: () => {
      location.reload();
    },
    showDetails: import.meta.env.DEV,
  });
  cleanups.push(() => {
    status.dispose();
  });

  // ---- Global error handling, first, so errors during boot are caught too (D-035) -----------
  const errors = new ErrorHandler({
    onFatal: (report) => {
      running.game?.stop(); // freeze the simulation exactly as it was
      running.pointerLock?.exit(); // give the player their cursor back to click Reload
      status.show('error', report);
    },
  });
  cleanups.push(errors.attach(window));

  // ---- WebGL2 (D-001) ------------------------------------------------------------------------
  const support = detectWebGL2(() => document.createElement('canvas'));
  if (!support.supported) {
    console.warn(`WebGL 2 unavailable (${support.reason})`, support.error ?? '');
    status.show('webgl-unsupported');
    return runAll(cleanups);
  }

  const game = new Game({ strict: import.meta.env.DEV });
  running.game = game;
  const world = new World(FACILITY);
  game.addSystem(world);

  // Graphics quality preset (D-037): the configured default, or `?quality=low|medium|high|ultra`
  // until the settings menu exists.
  const presetId =
    parseGraphicsPreset(new URLSearchParams(location.search).get('quality')) ??
    ENGINE_CONFIG.graphics.defaultPreset;
  let renderer: Renderer;
  try {
    renderer = new Renderer(app, { quality: ENGINE_CONFIG.graphics.presets[presetId] });
  } catch (error) {
    // The probe passed but the real context could not be created (e.g. GPU blocklisted).
    console.error('Could not create the WebGL 2 renderer', error);
    status.show('webgl-unsupported');
    return runAll(cleanups);
  }
  const view = new WorldView(renderer, world, { beaconPosition: FACILITY_BEACON_POSITION });

  // ---- Input (D-017, D-034) ----------------------------------------------------------------
  const input = new InputState();
  const pointerLock = new PointerLock(renderer.canvas, document);
  running.pointerLock = pointerLock;
  const browserInput = new BrowserInput({ window, document, element: renderer.canvas }, input, {
    isPointerLocked: () => pointerLock.isLocked,
    preventDefaultCodes: boundKeyCodes(DEFAULT_BINDINGS),
  });

  // The simulation reads input per fixed step; presentation and UI read it per render frame.
  const stepReader = input.createReader();
  const frameReader = input.createReader();
  cleanups.push(attachStepInput(game, stepReader));
  const stepActions = new ActionMap(stepReader, DEFAULT_BINDINGS);
  const frameActions = new ActionMap(frameReader, DEFAULT_BINDINGS);

  // ---- Player (D-038) ----------------------------------------------------------------------
  // Movement runs in the fixed step, only while a run is being played. Look runs every frame.
  const controller = new PlayerController(stepActions);
  const player = new Player({
    world: world.collision,
    level: FACILITY,
    intent: () => controller.read(),
    active: () => game.state.isIn('PLAYING'),
  });
  game.addSystem(player);
  const camera = createCamera();
  const cameraController = new CameraController(camera, player, ENGINE_CONFIG.view);
  cameraController.update(0, 0);
  view.prewarm(camera);

  /** Applies view settings (FOV, sensitivity, invert-Y, head bob) to the camera and the look. */
  const applyView = (settings: ViewSettings): ViewSettings => {
    cameraController.applySettings(settings);
    player.look.setSettings({
      ...player.look.getSettings(),
      sensitivity: settings.sensitivity,
      invertY: settings.invertY,
    });
    return settings;
  };

  cleanups.push(
    game.state.onEnter('PLAYING', () => {
      // A new run (not a resume): back to the spawn point.
      player.respawn();
      cameraController.bob.reset();
    }),
  );
  cleanups.push(
    game.addFrameSystem({
      frameUpdate: () => {
        frameReader.sample(); // this frame's input window: edges and mouse delta since last frame
        if (pointerLock.isLocked && game.state.isIn('PLAYING') && game.time.scale > 0) {
          player.look.applyMouseDelta(frameReader.mouseDeltaX, frameReader.mouseDeltaY);
        }
      },
    }),
  );

  cleanups.push(
    installAutoPause(game.state, {
      onPointerLockLost: (listener) =>
        pointerLock.onLockChange((locked) => {
          if (!locked) {
            listener();
          }
        }),
      onFocusLost: (listener) => browserInput.onFocusLost(listener),
      onHidden: (listener) => browserInput.onHidden(listener),
    }),
  );

  // Clicking the prompt is the user gesture that (re)acquires the lock. From the main menu it
  // starts a run (LOADING is instant until there is something to load); while paused, it resumes.
  const prompt = new LockPrompt(app, () => {
    void pointerLock.request().then((result) => {
      if (!result.locked) {
        prompt.show('refused');
      } else if (game.state.current === 'MAIN_MENU') {
        game.state.transition('LOADING');
        game.state.transition('PLAYING');
      } else {
        game.state.resume();
      }
    });
  });
  cleanups.push(
    pointerLock.onLockChange((locked) => {
      prompt.show(locked ? 'hidden' : game.state.isRunActive ? 'paused' : 'start');
    }),
  );

  // ---- WebGL context loss (D-035) -----------------------------------------------------------
  // Drawing stops by itself (Renderer.render returns false while lost); the simulation is left
  // untouched. A run is paused and the cursor released, so resuming is the usual click.
  cleanups.push(
    renderer.context.onChange((event) => {
      switch (event.type) {
        case 'lost':
          game.state.pause();
          pointerLock.exit();
          status.show('context-lost');
          break;
        case 'restored':
          view.prewarm(camera);
          status.hide();
          break;
        case 'restore-timeout':
          status.show('context-lost-timeout');
          break;
      }
    }),
  );

  game.setPresentation({
    render: (alpha, frameDt) => {
      // Simulated time only: the head bob holds still while paused.
      cameraController.update(alpha, frameDt * game.time.scale);
      view.render(alpha, camera);
    },
  });
  game.start(browserFrames);

  // ---- Development tools: dynamic import inside a DEV-only branch, absent from production -----
  if (import.meta.env.DEV) {
    let disposed = false;
    let disposeDebug: (() => void) | undefined;
    void import('./debug/installDebug').then(({ installDebug }) => {
      if (disposed) {
        return;
      }
      disposeDebug = installDebug({
        game,
        renderer,
        input,
        pointerLock,
        errors,
        container: app,
        player,
        applyView,
        getView: () => cameraController.getSettings(),
        extras: {
          world,
          cameraController,
          camera,
          stepActions,
          frameActions,
          prompt,
          status,
          view,
        },
      }).dispose;
    });
    cleanups.push(() => {
      disposed = true;
      disposeDebug?.();
    });
  }

  cleanups.push(() => {
    game.dispose();
    prompt.dispose();
    browserInput.dispose();
    pointerLock.exit();
    pointerLock.dispose();
    view.dispose();
    renderer.dispose();
  });
  return runAll(cleanups);
}

/** Returns a function that runs the cleanups in reverse order of registration. */
function runAll(cleanups: (() => void)[]): () => void {
  return () => {
    for (const cleanup of cleanups.reverse()) {
      cleanup();
    }
  };
}

const app = document.querySelector<HTMLElement>('#app');
if (app) {
  const teardown = boot(app);
  // Vite hot reload: tear down this instance so reloads never stack loops, listeners or contexts.
  import.meta.hot?.dispose(teardown);
}
