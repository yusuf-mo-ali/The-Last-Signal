/**
 * Composition root: the only place that wires browser APIs to the game.
 * Simulation (`core/`, `world/`, `player/`) and platform code (`input/`) stay browser-independent;
 * everything that needs the DOM, WebGL or requestAnimationFrame is created here and injected
 * (ARCHITECTURE.md §2, D-003, D-034, D-035).
 */

import './style.css';
import { CombatSystem } from './combat/CombatSystem';
import { TrainingDummyView } from './combat/training/TrainingDummyView';
import { TrainingRange } from './combat/training/TrainingRange';
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
import { CombatFeedback } from './ui/CombatFeedback';
import { LockPrompt } from './ui/LockPrompt';
import { StatusScreen } from './ui/StatusScreen';
import { WeaponHud } from './ui/WeaponHud';
import { Rng } from './utils/Rng';
import { Hitscan } from './weapons/hitscan';
import { WeaponController } from './weapons/WeaponController';
import { WeaponManager } from './weapons/WeaponManager';
import { WeaponSystem } from './weapons/WeaponSystem';
import { WeaponView } from './weapons/WeaponView';
import { FACILITY, FACILITY_BEACON_POSITION } from './world/levels/facility';
import { PickupManager } from './world/PickupManager';
import { PickupView } from './world/PickupView';
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

  // ---- Player (D-038) and weapons (D-039, D-040) -------------------------------------------
  // Movement runs in the fixed step, only while a run is being played. Look runs every frame.
  // Weapons step after the player, so shots leave from this step's position.
  const weapons = new WeaponManager();
  const controller = new PlayerController(stepActions);
  const player = new Player({
    world: world.collision,
    level: FACILITY,
    intent: () => {
      const intent = controller.read();
      // Firing cancels sprint (GAME_DESIGN §4.2).
      return weapons.blocksSprint && intent.sprint ? { ...intent, sprint: false } : intent;
    },
    active: () => game.state.isIn('PLAYING'),
  });
  game.addSystem(player);
  const weaponController = new WeaponController(stepActions);
  const seed = Date.now(); // D-014: one seed per session, one stream per system
  const hitscan = new Hitscan(world.collision);
  const weaponSystem = new WeaponSystem({
    manager: weapons,
    player,
    hitscan,
    rng: new Rng(seed), // spread and recoil
    input: () => weaponController.read(),
    active: () => game.state.isIn('PLAYING'),
  });
  game.addSystem(weaponSystem);

  // ---- Combat (D-041): hits → hitbox rigs → damage → health → death → events ----------------
  // Shots and swings reach combat through the weapon events, within the same fixed step.
  const combat = new CombatSystem({ hitscan, weaponEvents: weapons.events });
  game.addSystem(combat);
  const pickups = new PickupManager({
    collector: () => (game.state.isIn('PLAYING') ? player.motor.position : null),
    collect: (pickup) => weapons.addAmmo(pickup.definition.magazines) > 0,
  });
  // Training dummies: temporary validation targets until zombies exist (Phase 4).
  const training = new TrainingRange({ combat, rng: new Rng(`${seed}:drops`), pickups });
  training.reset();
  game.addSystem(training);
  game.addSystem(pickups);
  const camera = createCamera();
  const cameraController = new CameraController(camera, player, ENGINE_CONFIG.view);
  cameraController.update(0, 0);
  view.scene.add(camera); // the weapon view model is a child of the camera
  const weaponView = new WeaponView(view.scene, camera, weapons);
  const dummyView = new TrainingDummyView(view.scene, training, combat);
  const pickupView = new PickupView(view.scene, pickups);
  const hud = new WeaponHud(app);
  const feedback = new CombatFeedback(app, combat.events);
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
      // A new run (not a resume): back to the spawn point, with the starting loadout, and a
      // fresh training range.
      player.respawn();
      weapons.reset();
      training.reset();
      pickups.clear();
      feedback.reset();
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
      // Simulated time only: the head bob and weapon animations hold still while paused.
      const simDt = frameDt * game.time.scale;
      cameraController.update(alpha, simDt);
      weaponView.update(simDt);
      dummyView.update(simDt);
      pickupView.update(simDt);
      const held = weapons.activeWeapon;
      const hudVisible = pointerLock.isLocked && game.state.isIn('PLAYING');
      hud.update({
        visible: hudVisible,
        name: held.definition.name,
        status: held.getState(),
      });
      feedback.update(simDt, camera, hudVisible);
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
        weapons,
        combat,
        training,
        pickups,
        feedback,
        scene: view.scene,
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
          weaponSystem,
          weaponView,
          hud,
          dummyView,
          pickupView,
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
    weaponSystem.dispose();
    weaponView.dispose();
    combat.dispose();
    dummyView.dispose();
    pickupView.dispose();
    hud.dispose();
    feedback.dispose();
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
