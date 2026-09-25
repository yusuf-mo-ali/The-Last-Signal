/**
 * Composition root: the only place that wires browser APIs to the game.
 * Simulation (`core/`, `world/TestScene`) stays browser-independent; everything that needs the
 * DOM, WebGL or requestAnimationFrame is created here and injected (ARCHITECTURE.md §2, D-003).
 */

import './style.css';
import { Game, type FrameScheduler } from './core/Game';
import { isWebGL2Available, Renderer } from './render/Renderer';
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
  game.setPresentation(view);
  game.start(browserFrames);

  if (import.meta.env.DEV) {
    // Dev-only inspection handle for manual and automated browser checks. Stripped from
    // production builds; superseded by the debug tools in Phase 0.5 (D-020).
    (window as unknown as Record<string, unknown>).__TLS_DEV__ = { game, renderer, testScene };
  }

  // Vite hot reload: tear down this instance so reloads never stack loops or WebGL contexts.
  import.meta.hot?.dispose(() => {
    game.dispose();
    view.dispose();
    renderer.dispose();
  });
}

const app = document.querySelector<HTMLElement>('#app');
if (app) {
  boot(app);
}
