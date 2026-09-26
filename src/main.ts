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
import { EnemyManager } from './enemies/EnemyManager';
import { EnemyView } from './enemies/EnemyView';
import { TrainingEncounter } from './enemies/TrainingEncounter';
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
import { PlayerHealth } from './player/PlayerHealth';
import { createPlayerTarget } from './player/PlayerTarget';
import { createCamera } from './render/camera';
import { Renderer } from './render/Renderer';
import { detectWebGL2 } from './render/webglSupport';
import { CombatFeedback } from './ui/CombatFeedback';
import { HealthHud } from './ui/HealthHud';
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

  // ---- Player (D-038), weapons (D-039, D-040), combat (D-041) and enemies (D-042) ----------
  // Fixed-step order: world → player → enemies → test encounter → weapons → combat → dummies →
  // pickups. Enemies move before the weapons fire, so shots meet this step's hit volumes; shots
  // and swings reach combat through the weapon events, within the same step.
  const playing = () => game.state.isIn('PLAYING');
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
    active: playing,
  });
  game.addSystem(player);
  // D-029: the player can only be hurt during WAVE_ACTIVE and BOSS.
  const playerHealth = new PlayerHealth({
    canBeDamaged: () => game.state.isIn('WAVE_ACTIVE') || game.state.isIn('BOSS'),
  });
  const playerTarget = createPlayerTarget(player, playerHealth);
  const seed = Date.now(); // D-014: one seed per session, one stream per system
  const hitscan = new Hitscan(world.collision);
  const combat = new CombatSystem({ hitscan, weaponEvents: weapons.events });
  const pickups = new PickupManager({
    collector: () => (playing() ? player.motor.position : null),
    collect: (pickup) => weapons.addAmmo(pickup.definition.magazines) > 0,
  });
  const enemies = new EnemyManager({
    world: world.collision,
    level: FACILITY,
    combat,
    targets: () => [playerTarget],
    rng: new Rng(`${seed}:enemies`), // patrols and enemy drops
    active: playing,
    pickups,
    strict: import.meta.env.DEV,
  });
  game.addSystem(enemies);
  // Phase 4 test encounter: Walkers placed in the yard until waves exist (Phase 6).
  const encounter = new TrainingEncounter({ enemies, active: playing });
  encounter.reset();
  game.addSystem(encounter);
  const weaponController = new WeaponController(stepActions);
  const weaponSystem = new WeaponSystem({
    manager: weapons,
    player,
    hitscan,
    rng: new Rng(seed), // spread and recoil
    input: () => weaponController.read(),
    active: playing,
  });
  game.addSystem(weaponSystem);
  game.addSystem(combat);
  // Training dummies: temporary validation targets (D-041).
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
  const enemyView = new EnemyView(view.scene, enemies, combat);
  const pickupView = new PickupView(view.scene, pickups);
  const hud = new WeaponHud(app);
  const healthHud = new HealthHud(app, playerHealth);
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
      // A new run (not a resume): back to the spawn point at full health, with the starting
      // loadout, a fresh training range and the test encounter's enemies.
      player.respawn();
      playerHealth.reset();
      weapons.reset();
      enemies.clear();
      encounter.reset();
      training.reset();
      pickups.clear();
      feedback.reset();
      cameraController.bob.reset();
    }),
  );
  // Placeholder run flow until the wave system (Phase 6): a run opens straight into one
  // open-ended wave, so D-029's damage window already applies. Dying ends the run (GAME_OVER).
  cleanups.push(
    game.state.onEnter('WAVE_START', () => {
      game.state.transition('WAVE_ACTIVE');
    }),
    playerHealth.events.on('died', () => {
      game.state.transition('GAME_OVER');
      pointerLock.exit(); // the cursor back, and the "You died" prompt
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
      } else if (game.state.current === 'MAIN_MENU' || game.state.current === 'GAME_OVER') {
        // A new run (from the menu, or after dying).
        game.state.transition('LOADING');
        game.state.transition('PLAYING');
      } else {
        game.state.resume();
      }
    });
  });
  cleanups.push(
    pointerLock.onLockChange((locked) => {
      prompt.show(
        locked
          ? 'hidden'
          : game.state.current === 'GAME_OVER'
            ? 'game-over'
            : game.state.isRunActive
              ? 'paused'
              : 'start',
      );
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
      enemyView.update(alpha, simDt);
      pickupView.update(simDt);
      const held = weapons.activeWeapon;
      const hudVisible = pointerLock.isLocked && game.state.isIn('PLAYING');
      hud.update({
        visible: hudVisible,
        name: held.definition.name,
        status: held.getState(),
      });
      feedback.update(simDt, camera, hudVisible);
      healthHud.update(simDt, hudVisible);
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
        enemies,
        encounter,
        playerHealth,
        playerTarget,
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
          enemyView,
          healthHud,
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
    enemies.dispose();
    encounter.dispose();
    combat.dispose();
    dummyView.dispose();
    enemyView.dispose();
    healthHud.dispose();
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
