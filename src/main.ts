/**
 * Composition root: the only place that wires browser APIs to the game.
 * Simulation (`core/`, `world/`, `player/`) and platform code (`input/`) stay browser-independent;
 * everything that needs the DOM, WebGL or requestAnimationFrame is created here and injected
 * (ARCHITECTURE.md §2, D-003, D-034, D-035).
 */

import './style.css';
import { Vector3 } from 'three';
import { CombatSystem } from './combat/CombatSystem';
import { TrainingDummyView } from './combat/training/TrainingDummyView';
import { TrainingRange } from './combat/training/TrainingRange';
import { EnemyManager } from './enemies/EnemyManager';
import { EnemyProjectiles } from './enemies/EnemyProjectiles';
import { ProjectileView } from './enemies/ProjectileView';
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
import { glitchFrame } from './render/glitch';
import { Renderer } from './render/Renderer';
import { detectWebGL2 } from './render/webglSupport';
import { CombatFeedback } from './ui/CombatFeedback';
import { AlarmPulse } from './ui/AlarmPulse';
import { HealthHud } from './ui/HealthHud';
import { LockPrompt } from './ui/LockPrompt';
import { StatusScreen } from './ui/StatusScreen';
import { WaveHud } from './ui/WaveHud';
import { WeaponHud } from './ui/WeaponHud';
import { Rng } from './utils/Rng';
import { SpawnDirector, type SpawnViewer } from './waves/SpawnDirector';
import { WaveManager } from './waves/WaveManager';
import { EffectRouter } from './modifiers/EffectRouter';
import { ScreenEffects } from './modifiers/ScreenEffects';
import { StatRegistry } from './modifiers/StatRegistry';
import { TriggerRegistry } from './modifiers/TriggerRegistry';
import { SignalMutationSystem } from './signal/SignalMutationSystem';
import { MutationHud } from './ui/MutationHud';
import { StaticOverlay } from './ui/StaticOverlay';
import { MUTATIONS } from './config/mutations';
import { Environment } from './world/Environment';
import { LightingController } from './world/LightingController';
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
  const params = new URLSearchParams(location.search);
  const presetId =
    parseGraphicsPreset(params.get('quality')) ?? ENGINE_CONFIG.graphics.defaultPreset;
  // `?sandbox=1`: the Phase 3–5 sandbox (training range, test encounter, one open-ended wave)
  // instead of the wave system; `?endless=1`: waves go on past the final wave (D-044, O-5).
  const sandbox = params.get('sandbox') === '1';
  const endless = params.get('endless') === '1';
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
  // The modifier runtime (D-009, D-045): sourced stats, triggers, the environment state and
  // screen effects, all applied and removed by source through one router.
  const stats = new StatRegistry(['enemy.moveSpeed', 'enemy.acceleration'], {
    strict: import.meta.env.DEV,
  });
  const triggers = new TriggerRegistry({ strict: import.meta.env.DEV });
  const environment = new Environment();
  const screenEffects = new ScreenEffects();
  const effects = new EffectRouter({
    stats,
    triggers,
    environment,
    screen: screenEffects,
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
    modifiers: stats, // HUNGER (D-045)
  });
  // The Spitter's acid (D-046): flown in fixed steps right after the enemies; every hit goes
  // through the player's health rules (D-029).
  const projectiles = new EnemyProjectiles({
    world: world.collision,
    targets: () => [playerTarget],
    active: playing,
    killPlaneY: FACILITY.killPlaneY,
    enemyEvents: enemies.events,
  });
  cleanups.push(() => {
    projectiles.dispose();
  });
  // Waves (D-044): the run's waves, entering at fair spawn points. The wave runtime steps before
  // the enemies, so a group spawned this step moves with everyone else.
  const spawns = new SpawnDirector({
    points: FACILITY.spawnPoints ?? [],
    canStand: (archetype, at) => enemies.canStand(archetype, at),
    lineOfSight: (from, to) => enemies.lines.lineOfSight(from, to),
    walkable: (from, to, radius) => enemies.lines.walkable(from, to, radius),
    rng: new Rng(`${seed}:spawn-points`),
  });
  const waves = new WaveManager({
    state: game.state,
    enemies,
    spawns,
    target: () => playerTarget,
    viewer: () => spawnViewer(),
    seed,
    combat: combat.events,
    player: playerHealth.events,
    endless,
    onPrepare: (definition) => {
      enemyView.prewarm(definition.spawns);
    },
  });
  // Signal Mutations (D-045): the wave's mutation is announced, applied and removed with the wave.
  const mutations = new SignalMutationSystem({
    state: game.state,
    waves,
    enemies,
    router: effects,
    triggers,
    screen: screenEffects,
  });
  if (!sandbox) {
    cleanups.push(waves.attach(), mutations.attach());
  }
  game.addSystem(waves);
  game.addSystem(environment); // overlay fades, in simulated time
  game.addSystem(screenEffects); // STATIC's burst schedule
  game.addSystem(enemies);
  game.addSystem(projectiles);
  // The Phase 4–5 test encounter: only in the sandbox (`?sandbox=1`) now that waves exist.
  const encounter = new TrainingEncounter({ enemies, active: playing });
  if (sandbox) {
    encounter.reset();
  }
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
  // Training dummies: temporary validation targets (D-041), in the sandbox only.
  const training = new TrainingRange({ combat, rng: new Rng(`${seed}:drops`), pickups });
  if (sandbox) {
    training.reset();
  }
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
  const projectileView = new ProjectileView(view.scene, projectiles);
  const hud = new WeaponHud(app);
  const healthHud = new HealthHud(app, playerHealth);
  const waveHud = new WaveHud(app, waves);
  // Mutations on screen (D-045): the lighting follows the environment state; STATIC's layer sits
  // right above the canvas, under every HUD element; the badge, card and surge cue explain it all.
  const lighting = new LightingController(view.lights);
  const staticOverlay = new StaticOverlay(renderer.canvas);
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const mutationHud = new MutationHud(app, mutations, waves);
  // Where the player looks from, for fair spawns: the eye, the look yaw and the camera's horizontal
  // field of view.
  const eye = new Vector3();
  const spawnViewer = (): SpawnViewer => {
    const p = player.motor.position;
    const vertical = (camera.fov * Math.PI) / 180;
    const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * camera.aspect);
    return {
      eye: eye.set(p.x, p.y + player.motor.eyeHeight, p.z),
      yaw: player.look.yaw,
      fovDeg: (horizontal * 180) / Math.PI,
    };
  };
  const alarmPulse = new AlarmPulse(app, enemies.events, () => player.motor.position);
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
      // loadout and no enemies (the wave runtime starts wave 1; the sandbox restores the
      // training range and the test encounter instead).
      player.respawn();
      playerHealth.reset();
      weapons.reset();
      enemies.clear();
      projectiles.clear();
      if (sandbox) {
        encounter.reset();
        training.reset();
      } else {
        encounter.clear();
        training.clear();
      }
      pickups.clear();
      feedback.reset();
      alarmPulse.reset();
      cameraController.bob.reset();
    }),
  );
  // The run flow: the wave runtime drives WAVE_START → WAVE_ACTIVE → WAVE_COMPLETE → … (D-044).
  // The sandbox keeps the Phase 4 placeholder: one open-ended wave. Dying ends the run
  // (GAME_OVER); clearing the final wave wins it (VICTORY). Either way the cursor comes back and
  // the prompt offers a new run.
  if (sandbox) {
    cleanups.push(
      game.state.onEnter('WAVE_START', () => {
        game.state.transition('WAVE_ACTIVE');
      }),
    );
  }
  cleanups.push(
    playerHealth.events.on('died', () => {
      game.state.transition('GAME_OVER');
      pointerLock.exit(); // the cursor back, and the "You died" prompt
    }),
    game.state.onEnter('VICTORY', () => {
      pointerLock.exit(); // the cursor back, and the "Signal transmitted" prompt
    }),
    // No acid outlives its wave, or the run.
    game.state.onEnter('WAVE_COMPLETE', () => {
      projectiles.clear();
    }),
    game.state.onEnter('GAME_OVER', () => {
      projectiles.clear();
    }),
    game.state.onEnter('VICTORY', () => {
      projectiles.clear();
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
      } else if (
        game.state.current === 'MAIN_MENU' ||
        game.state.current === 'GAME_OVER' ||
        game.state.current === 'VICTORY'
      ) {
        // A new run (from the menu, after dying or after winning).
        if (game.state.current === 'VICTORY') {
          game.state.transition('MAIN_MENU');
        }
        game.state.transition('LOADING');
        game.state.transition('PLAYING');
      } else {
        game.state.resume();
      }
    });
  });
  cleanups.push(
    pointerLock.onLockChange((locked) => {
      const mutation = waves.status.mutation;
      const reached =
        waves.isAttached && waves.wave > 0
          ? `Wave ${waves.wave}${mutation ? ` · ${MUTATIONS[mutation].name}` : ''}`
          : undefined;
      if (locked) {
        prompt.show('hidden');
      } else if (game.state.current === 'GAME_OVER') {
        prompt.show('game-over', reached);
      } else if (game.state.current === 'VICTORY') {
        prompt.show('victory', reached ? `${reached} cleared` : undefined);
      } else {
        prompt.show(game.state.isRunActive ? 'paused' : 'start');
      }
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
      const channels = environment.resolve();
      lighting.update(channels, weaponView.muzzleFlashVisible ? 1 : 0);
      // The dark (D-046): glowing eyes on silhouettes, close enemies lifted out of it.
      enemyView.eyeGlow = channels.eyeGlow;
      enemyView.silhouette = channels.silhouette;
      enemyView.proximity = channels.proximity;
      // Signal Glitch (D-046): the image tears and enemies are drawn a moment behind, during a
      // STATIC burst only (measured in simulated time: it holds still while paused).
      const glitch = glitchFrame(screenEffects.burst, screenEffects.time, reducedMotion);
      enemyView.desync = glitch.active ? glitch.params.desync * glitch.envelope : 0;
      enemyView.update(alpha, simDt);
      pickupView.update(simDt);
      projectileView.update(alpha, simDt);
      const held = weapons.activeWeapon;
      const hudVisible = pointerLock.isLocked && game.state.isIn('PLAYING');
      hud.update({
        visible: hudVisible,
        name: held.definition.name,
        status: held.getState(),
      });
      feedback.update(simDt, camera, hudVisible);
      healthHud.update(simDt, hudVisible);
      waveHud.update(hudVisible);
      staticOverlay.update(screenEffects.burst, screenEffects.time, hudVisible);
      mutationHud.update(hudVisible, simDt, {
        x: player.motor.position.x,
        z: player.motor.position.z,
        yaw: player.look.yaw,
      });
      alarmPulse.update(simDt);
      view.render(alpha, camera, glitch);
      const glitchState = glitch.active ? 'active' : 'idle';
      if (renderer.canvas.dataset.glitch !== glitchState) {
        renderer.canvas.dataset.glitch = glitchState;
      }
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
        waves,
        mutations,
        effects,
        environment,
        screenEffects,
        projectiles,
        glitch: () => view.glitch.state,
        spawnViewer,
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
          projectileView,
          healthHud,
          waveHud,
          alarmPulse,
          lighting,
          staticOverlay,
          mutationHud,
          stats,
          triggers,
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
    waveHud.dispose();
    mutationHud.dispose();
    staticOverlay.dispose();
    mutations.detach();
    waves.detach();
    alarmPulse.dispose();
    pickupView.dispose();
    projectileView.dispose();
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
