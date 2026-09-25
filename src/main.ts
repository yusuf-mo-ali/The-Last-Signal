/**
 * Composition root: the only place that wires browser APIs to the game.
 * Simulation (`core/`, `world/TestScene`) stays browser-independent; everything that needs the
 * DOM, WebGL or requestAnimationFrame is created here and injected (ARCHITECTURE.md §2, D-003).
 */

import './style.css';
import { boundKeyCodes, DEFAULT_BINDINGS } from './config/input';
import { Game, type FrameScheduler } from './core/Game';
import { ActionMap } from './input/ActionMap';
import { installAutoPause } from './input/autoPause';
import { BrowserInput } from './input/BrowserInput';
import { InputState } from './input/InputState';
import { PointerLock } from './input/PointerLock';
import { attachStepInput } from './input/stepInput';
import { isWebGL2Available, Renderer } from './render/Renderer';
import { LockPrompt } from './ui/LockPrompt';
import { TestScene } from './world/TestScene';
import { TestSceneView } from './world/TestSceneView';

const browserFrames: FrameScheduler = {
  request: (callback) => requestAnimationFrame(callback),
  cancel: (handle) => {
    cancelAnimationFrame(handle);
  },
};

function showUnsupported(app: HTMLElement): void {
  // Minimal fallback until the error screen arrives in Phase 0.5 (ARCHITECTURE.md §7.17).
  app.innerHTML = `
    <main class="notice" role="alert">
      <h1 class="notice__title">THE LAST SIGNAL</h1>
      <p class="notice__text">
        This game needs WebGL 2, which this browser or device does not provide.
        Try an up-to-date Chrome, Edge or Firefox with hardware acceleration enabled.
      </p>
    </main>
  `;
}

function boot(app: HTMLElement): void {
  if (!isWebGL2Available()) {
    showUnsupported(app);
    return;
  }

  const game = new Game({ strict: import.meta.env.DEV });
  const testScene = new TestScene();
  game.addSystem(testScene);

  const renderer = new Renderer(app);
  const view = new TestSceneView(renderer, testScene);

  // ---- Input (D-017, D-034) ----------------------------------------------------------------
  const input = new InputState();
  const pointerLock = new PointerLock(renderer.canvas, document);
  const browserInput = new BrowserInput({ window, document, element: renderer.canvas }, input, {
    isPointerLocked: () => pointerLock.isLocked,
    preventDefaultCodes: boundKeyCodes(DEFAULT_BINDINGS),
  });

  // The simulation reads input per fixed step; presentation and UI read it per render frame.
  const stepReader = input.createReader();
  const frameReader = input.createReader();
  const detachStepInput = attachStepInput(game, stepReader);
  const stepActions = new ActionMap(stepReader, DEFAULT_BINDINGS);
  const frameActions = new ActionMap(frameReader, DEFAULT_BINDINGS);

  const removeAutoPause = installAutoPause(game.state, {
    onPointerLockLost: (listener) =>
      pointerLock.onLockChange((locked) => {
        if (!locked) {
          listener();
        }
      }),
    onFocusLost: (listener) => browserInput.onFocusLost(listener),
    onHidden: (listener) => browserInput.onHidden(listener),
  });

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
  const removePromptListener = pointerLock.onLockChange((locked) => {
    prompt.show(locked ? 'hidden' : game.state.isRunActive ? 'paused' : 'start');
  });

  game.setPresentation({
    render: (alpha) => {
      frameReader.sample(); // this frame's input window: edges and mouse delta since last frame
      view.render(alpha);
    },
  });
  game.start(browserFrames);

  if (import.meta.env.DEV) {
    // Dev-only inspection handle for manual and automated browser checks. Stripped from
    // production builds; superseded by the debug tools in Phase 0.5 (D-020).
    (window as unknown as Record<string, unknown>).__TLS_DEV__ = {
      game,
      renderer,
      testScene,
      input,
      pointerLock,
      stepActions,
      frameActions,
      prompt,
    };
  }

  // Vite hot reload: tear down this instance so reloads never stack loops, listeners or contexts.
  import.meta.hot?.dispose(() => {
    game.dispose();
    detachStepInput();
    removeAutoPause();
    removePromptListener();
    prompt.dispose();
    browserInput.dispose();
    pointerLock.exit();
    pointerLock.dispose();
    view.dispose();
    renderer.dispose();
  });
}

const app = document.querySelector<HTMLElement>('#app');
if (app) {
  boot(app);
}
