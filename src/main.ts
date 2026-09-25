/**
 * Composition root: the only place that wires browser APIs to the game.
 * Simulation (`core/`, `world/TestScene`) and platform code (`input/`) stay browser-independent;
 * everything that needs the DOM, WebGL or requestAnimationFrame is created here and injected
 * (ARCHITECTURE.md §2, D-003, D-034, D-035).
 */

import './style.css';
import { boundKeyCodes, DEFAULT_BINDINGS } from './config/input';
import { ErrorHandler } from './core/ErrorHandler';
import { Game, type FrameScheduler } from './core/Game';
import { ActionMap } from './input/ActionMap';
import { installAutoPause } from './input/autoPause';
import { BrowserInput } from './input/BrowserInput';
import { InputState } from './input/InputState';
import { PointerLock } from './input/PointerLock';
import { attachStepInput } from './input/stepInput';
import { Renderer } from './render/Renderer';
import { detectWebGL2 } from './render/webglSupport';
import { LockPrompt } from './ui/LockPrompt';
import { StatusScreen } from './ui/StatusScreen';
import { TestScene } from './world/TestScene';
import { TestSceneView } from './world/TestSceneView';

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
  const testScene = new TestScene();
  game.addSystem(testScene);

  let renderer: Renderer;
  try {
    renderer = new Renderer(app);
  } catch (error) {
    // The probe passed but the real context could not be created (e.g. GPU blocklisted).
    console.error('Could not create the WebGL 2 renderer', error);
    status.show('webgl-unsupported');
    return runAll(cleanups);
  }
  const view = new TestSceneView(renderer, testScene);

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

  // Clicking the prompt is the user gesture that (re)acquires the lock, and resumes if paused.
  const prompt = new LockPrompt(app, () => {
    void pointerLock.request().then((result) => {
      if (result.locked) {
        game.state.resume();
      } else {
        prompt.show('refused');
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
          view.prewarm();
          status.hide();
          break;
        case 'restore-timeout':
          status.show('context-lost-timeout');
          break;
      }
    }),
  );

  game.setPresentation({
    render: (alpha) => {
      frameReader.sample(); // this frame's input window: edges and mouse delta since last frame
      view.render(alpha);
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
        extras: { testScene, stepActions, frameActions, prompt, status, view },
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
