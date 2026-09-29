# Progress — THE LAST SIGNAL

> The working state of the project. Every session reads this file first and updates it last, so
> work can be resumed safely (plan §36).
>
> **Last updated:** 2026-09-29 · **Base branch:** `main` · **Working branch:** `claude/bold-mayer-n66vhb`
> (open PR into `main`: yusuf-mo-ali/The-Last-Signal#1)

---

## Current Phase

**Phase 7: Signal Mutations. Complete** (plan §14, D-045). From wave 4 every wave except the finale carries one Signal Mutation, chosen by a seeded, pure selector (never the same twice, never two sight mutations in a row, tier weights, a recent-use penalty) and applied through one data-driven effect runtime (stats, triggers, environment overlays, screen effects, spawn rules). Six ship (O-4): BLACKOUT, HUNGER, STATIC, SCREAM (shown as DEATH CRY), HIVE and BLOOD MOON; LOW GRAVITY and OVERLOAD stay in the data as deferred. Each is announced before its wave (card: name, rule, hint), badged during it and lifted after it; the lighting changes only intensities and colours of lights that exist from load. DEATH CRY is kept apart from the Screamer's scream (a different alarm kind: small, red, never reinforcements). Every value is clamped twice, and a scripted-defender tripwire checks that no mutation makes a wave impossible. See "Phase 7 acceptance review" below. Phase 8 (Adaptive System) has not started and is awaiting approval.

- Phase 6 (Wave System) is complete (D-044): seeded wave generation from a threat budget, fair spawn points, the wave cycle, victory at wave 20 and endless.

- Phases 0 (Project Foundation), 1 (First Person Foundation), 2 (Weapon Framework), 3 (Combat System), 4 (Zombie Foundation), 5 (Zombie Archetypes) and 6 (Wave System) are complete: see their acceptance reviews.

- Decisions marked *Proposed* in `DECISIONS.md` apply by default unless overridden.

## Completed Tasks

- [x] Read and analysed `IMPLEMENTATION_PLAN.md` (v1.0, 42 sections).
- [x] Inspected the repository: empty; no commits on the branch or the remote.
- [x] Checked the environment: Node 22.22.2, npm 10.9.7, git 2.43; Chromium available for Playwright.
- [x] Checked current package versions and peer compatibility on npm (see D-002). Found that TypeScript 7 is incompatible with typescript-eslint, so TypeScript is pinned to 6.0.3.
- [x] Committed `IMPLEMENTATION_PLAN.md` byte-for-byte (D-025).
- [x] Wrote `ARCHITECTURE.md`: layers, loop, state machine, lifetimes, folder tree, subsystems, budgets.
- [x] Wrote `GAME_DESIGN.md`: design baseline, with proposals marked.
- [x] Wrote `DECISIONS.md`: 30 decisions, 12 open questions.
- [x] Wrote `README.md`.
- [x] Wrote `PROGRESS.md` (this file).
- [x] Repository setup. The feature branch was the only branch, so it had become GitHub's default and a pull request had nothing to target.
  - Created `main` from an empty root commit (`bccdaf6`).
  - Merged `main` into the feature branch with a normal merge commit: no rebase, no force-push, no file changes.
  - Opened a PR from the feature branch into `main`. The GitHub default branch was then switched to `main` (by the repo owner).
- [x] **Phase 0.1: Toolchain scaffold** (D-031).
  - Added `package.json` + `package-lock.json`, `tsconfig.json` (strict), `vite.config.ts` (with Vitest config), `eslint.config.js` (type-aware + layer rules), Prettier config, `.gitignore`, `.nvmrc`, `.editorconfig`, `index.html`, `src/main.ts` + `src/style.css` (placeholder screen), and `tests/toolchain.test.ts`.
  - Verified: `npm run typecheck`, `lint`, `format:check`, `test` (2 tests) and `build` all pass. The layer rule fires on a probe file that breaks it, and is removed after. `npm run dev` loads in headless Chromium with no console errors or failed requests.
- [x] **Phase 0.2: Core primitives** (D-032). All are simulation-layer code with no browser dependencies, and each has its own test file:
  - `src/core/EventBus.ts`: typed pub/sub, FIFO queue for re-entrant emits, error isolation, and scopes for run-lifetime subscriptions.
  - `src/core/Time.ts`: fixed-step clock with time scale, frame clamp, step cap with backlog drop, and interpolation `alpha`.
  - `src/core/GameState.ts`: all 12 plan states, with `PLAYING` as the parent of the five run phases, a push-down `PAUSED`, one transition table, strict mode, and queued re-entrant transitions.
  - `src/utils/Rng.ts`: seeded sfc32 with `int`, `range`, `chance`, `pick`, `weighted`, `shuffle`, `fork` and save/restore of state.
  - `src/utils/Pool.ts`: acquire/release with reset on release, misuse detection, prewarm, `maxFree`, `releaseAll` and `clear`.
  - Verified: 247 new unit tests pass (249 in the suite), including all 132 source/target transition combinations checked against an independently written expected table. Eight deliberately planted bugs were each caught by the tests. `npm run check` and `npm run build` pass.
- [x] **Phase 0.3: Render foundation** (D-033).
  - `src/core/Game.ts`: the game root. It owns `Time` and `GameStateMachine` and runs the fixed-step loop through an injected `FrameScheduler`. The optional `Presentation` makes a game without one headless. It freezes time in `PAUSED`/`UPGRADE_SELECTION`, fails fast on errors, and moves `BOOT → MAIN_MENU` on start.
  - `src/render/Renderer.ts`: WebGL2 check and `WebGLRenderer` (ACES tone mapping, shadow map), plus resize via `ResizeObserver` and a device-pixel-ratio media query, applied at most once per frame. A 0 × 0 container skips drawing.
  - `src/render/viewport.ts`: pure size / pixel-ratio math (capped at 2, with render scale). `src/render/camera.ts`: camera defaults.
  - `src/world/TestScene.ts` + `TestSceneView.ts`: a fixed-step beacon drawn with interpolation, crates, floor, grid, a fixed light rig with one shadow caster, and a shader pre-warm.
  - `src/main.ts`: composition root, a plain "WebGL 2 unavailable" message, a Vite hot-reload teardown, and the dev-only `__TLS_DEV__` handle.
  - `vite.config.ts`: three.js split into its own cached chunk; chunk warning limit 600 kB, with the reason recorded.
  - Verified:
    - 46 new tests (295 in the suite): the headless loop with a manual frame queue, and the viewport math at every target resolution and in edge cases.
    - `npm run check` and `npm run build` pass, with no build warnings.
    - A browser script in headless Chromium checked both `npm run dev` and the production preview: canvas and WebGL2, rendered and animating pixels, and resizing to 1920×1080, 1600×900, 1366×768, 800×600 and 320×180.
    - It also checked live pixel-ratio changes (2, 1.25, 3 → capped at 2), recovery from a 0-height container, fixed steps accounting for real time, pause freezing steps while rendering continues, and resume without a burst.
    - No console errors, warnings, page errors or failed requests.
- [x] **Phase 0.4: Input** (D-034).
  - `src/config/input.ts`: default bindings by physical `KeyboardEvent.code` (WASD, Shift, C, Space, R, 1–3, wheel, E, V, Esc; mouse left and right), plus a conflict checker. Crouch is on C, with `ControlLeft` as the documented opt-in.
  - `src/input/InputState.ts`: held state plus running totals, and `InputReader` windows (press/release edges, per-window mouse delta, wheel notches). Glitch-sized motion is dropped; trackpad wheel deltas accumulate into notches.
  - `src/input/ActionMap.ts`: action queries over bindings.
  - `src/input/BrowserInput.ts`: DOM adapter, injected with `window`/`document`/canvas.
  - `src/input/PointerLock.ts`: raw-input request with fallback, refusals returned rather than thrown, and older event-only browsers supported.
  - `src/input/autoPause.ts`: pause on lock loss, window blur or hidden tab. `src/input/stepInput.ts`: step reader sampled first in each fixed step, and discarded on leaving frozen states.
  - `Game.prependSystem` added. `src/ui/LockPrompt.ts` is a minimal click-to-play / paused / refused prompt. `main.ts` does the wiring.
  - ESLint now bans browser globals and presentation imports in `src/input/`.
  - Verified:
    - 73 new tests (368 in the suite). Eight planted input bugs were each caught.
    - `npm run check` and `npm run build` pass with no warnings. The dev handle is absent from production.
    - A headless-Chromium script checked both dev and production:
      - start prompt, Space suppressed but KeyQ not, context menu suppressed;
      - keys by physical code (including an AZERTY "z" key sending `KeyW`), press/held/release edges;
      - click-to-lock, and the locking click not registering as fire;
      - per-frame mouse delta that resets, button press while locked, one wheel notch = one step;
      - lock loss pausing with time frozen, a refused re-lock showing "click again" while staying paused, and a later click resuming the same phase;
      - blur and hidden-tab pause releasing held keys;
      - no console errors or failed requests.
    - The Phase 0.3 render checks were rerun and still pass.
  - Headless limits, each covered another way:
    - Esc doesn't release the lock in headless; `exitPointerLock()` triggers the same event path.
    - Chromium's re-lock cooldown doesn't occur in headless; the canvas's real `requestPointerLock` was made to reject with Chromium's `SecurityError`.
    - Headless emits no real blur/visibility events when switching pages; the same handlers were driven by dispatched events, and are unit-tested.
    - Raw input is unsupported in headless, so the fallback path ran for real.
- [x] **Phase 0.5: Config, debug, errors** (D-035).
  - `src/core/Config.ts`: `ENGINE_CONFIG` (loop, render, camera, input, debug, errors), deep-frozen. `Time`, `Renderer`, `createCamera`, `InputState` and `PointerLock` now read their defaults from it, and the old duplicated constants are deleted.
  - Gameplay config skeletons in `src/config/`: `effects`, `weapons`, `enemies`, `waves`, `mutations`, `upgrades`, `bosses`, `adaptation`, `economy`, `signal`. They hold schemas plus only the values the plan or design already fix. No balance numbers.
  - `src/core/ErrorHandler.ts`: uncaught errors and rejections are fatal; the browser's own logging is kept; `report()` logs itself.
  - `src/render/webglSupport.ts` (WebGL2 probe) and `src/render/ContextLossMonitor.ts` (loss / restore / 10 s timeout). `Renderer` skips drawing while the context is lost and re-applies its size on restore.
  - `src/ui/StatusScreen.ts`: WebGL2-missing recovery steps, a fatal error screen (stack in dev only), and "Graphics paused" / "did not recover" notices.
  - `src/debug/` (development only, dynamic import):
    - `installDebug` puts `window.tls` in place of `__TLS_DEV__`, with working commands plus the plan §29 stubs.
    - `DebugCommands` registry, `FrameStats` probe, `DebugOverlay`, `debug.css`.
  - `Game.setFrameProbe`; `TestSceneView.prewarm`. `main.ts` rewired: error handling first, then the WebGL2/renderer fallbacks, context-loss handling, and the dev-only debug import.
  - Verified:
    - 52 new tests (420 in the suite). `npm run check` passes; `npm run build` has no warnings (game 29.2 kB).
    - The production `dist/` contains no debug code, chunk or CSS.
    - Browser, development build, 33/33 checks:
      - `tls` interface and plan stubs; overlay content and Backquote toggle;
      - context loss in a run (paused, cursor released, nothing drawn) and restore (redrawn at the right size, shaders recompiled, click to resume, simulation invariant intact);
      - context loss outside a run (the simulation keeps stepping); the 10 s restore timeout and a late restore;
      - forced frame, async and rejection errors (error screen, game stopped, error still in the console);
      - missing WebGL2, and a renderer-creation failure.
    - Browser, production build, 16/16 checks: no `tls`, overlay or debug chunk; the same fallbacks, with no stack shown.
    - Phase 0.3 and 0.4 browser checks were rerun and still pass (dev 22 + 19, prod 17 + 8).
    - Frame-probe overhead: 15.3 ns per frame when detached vs 15.4 ns with none; about 130 ns when the overlay is on.
- [x] **Phase 0.6: Verify and document** (D-036).
  - `TESTING.md`: test levels, commands, coverage map, conventions, the headless-browser limits, the manual QA checklist, performance notes and known gaps.
  - Committed end-to-end suite in `tests/e2e/` (`npm run test:e2e`, Playwright 1.63.0 pinned): `smoke`, `resize`, `input`, `resilience` and `debug` specs, each run against the dev server and a production build. It replaces the ad-hoc browser scripts from 0.3–0.5.
    - `E2E_BASE_URL` and `VERCEL_AUTOMATION_BYPASS_SECRET` let it test a deployed preview.
    - `PLAYWRIGHT_CHROMIUM_EXECUTABLE` lets it use a pre-installed browser.
  - `tests/e2e/tsconfig.json` (Node types via `@types/node`, e2e only). `npm run typecheck` now covers app + e2e. Lint allows non-null assertions in `tests/e2e/` only.
  - Verified:
    - Clean `npm ci` (0 vulnerabilities); `npm run check` passes (420 unit tests); `npm run build` has no warnings.
    - `npm run test:e2e`: 33 passed, 7 skipped by design (dev-only checks in `prod`), identical on two consecutive runs (about 1.7 min each).
    - A planted bug (refusal feedback removed) failed the input spec in both projects, and was reverted.
  - Live Vercel preview: **not reachable from the container.** The environment's network policy returns 403 for `*.vercel.app`. The suite is ready to run against it once the host is allowed (see Blocked Tasks).
- [x] **O-9 resolved** (D-037, 2026-09-25).
  - Weak reference machine: Intel Core i5-4440, 16 GB DDR3-1333, NVIDIA GTX 750.
  - Targets: ~30 FPS average at 1080p Low on it; ~60 FPS at High on capable hardware.
  - The reference is a performance floor, not a visual ceiling: quality presets (Low → Ultra) scale shadows, lighting, effects, post-processing, textures and resolution, with identical gameplay.
  - Documented in DECISIONS (D-037), ARCHITECTURE (§7.18, §8), TESTING (§6, §7 protocol and results log) and GAME_DESIGN (§17). No code changes.

- [x] **Phase 1: First Person Foundation** (plan §8, D-038).
  - **Blockout map** (`src/world/levels/`): level-as-data types; `geometry.ts` turns box / ramp / stairs brushes into outward-facing triangles (stairs render as steps, collide as a ramp); `facility.ts` is a compact 48 × 48 m facility: yard with the signal tower and obstacles of several heights, roofed control room with three entrances, a crouch-only crawl duct, service corridor, generator hall, west catwalk reached by stairs and a ramp (with a railing gap to drop through), loading dock with a ramp, parked trucks. `FACILITY_ROUTE` walks every area.
  - **Collision** (`src/physics/CollisionWorld.ts`): one `Octree` of the level; per-triangle capsule contacts (floor, wall and ceiling told apart) and raycasts.
  - **Player** (`src/player/`): `PlayerMotor` (acceleration/braking, limited air control, sprint, crouch with headroom check, jump with coyote time and buffer, exact gravity, sub-stepped collision, ground probe and snap, kill-plane respawn), `PlayerLook` (sensitivity, invert-Y, ±89° clamp), `PlayerController` (actions → intent), `Player` (fixed-step system, active only while playing), `HeadBob` and `CameraController` (presentation). Tuning in `src/config/player.ts`.
  - **Engine:** `Game.addFrameSystem` (per-frame work before the fixed steps: mouse look). `ENGINE_CONFIG` restructured: `graphics` presets (D-037), `camera` look/bob tuning, `view` settings (FOV, sensitivity, invert-Y, head bob). `?quality=low|medium|high|ultra` at load.
  - **World:** `World` (level + collision + `SignalBeacon`) and `WorldView` (6 merged meshes, fixed light rig, shadow size from the preset) replace `TestScene`/`TestSceneView`.
  - **Flow:** "Click to play" captures the mouse and starts a run (`LOADING → PLAYING`); a new run respawns the player; lock loss pauses as before.
  - **Debug (dev only):** `tls.player()`, `tls.teleportPlayer(x, y, z, yaw?)` (no longer a stub), `tls.look(yaw, pitch?)`, `tls.view({...})`; overlay shows position, speed, ground/air and walk/sprint/crouch.
  - Verified:
    - 105 new unit and integration tests (525 in the suite), including a headless walk of the whole map through the real loop and input stack, and identical movement at 30/60/75/144/240 Hz rendering.
    - 9 of 9 planted movement bugs caught (TESTING.md §4).
    - `npm run check` passes; `npm run build` has no warnings (game 44.4 kB, 15.1 kB gzipped); no debug code in `dist/`.
    - `npm run test:e2e`: 49 passed, 15 skipped by design (dev-only checks in `prod`). New `player.spec` drives real keys and mouse: WASD, sprint, crouch, jump, mouse look and clamp, sensitivity, invert-Y, FOV, head bob, walls/desk/duct collision, and a walk of the whole map with real keys (dev); strafing and turning visibly move the view (dev and prod). No console errors, warnings or failed requests anywhere.
    - Browser screenshots of spawn, control room, duct, catwalk, loading dock and generator hall inspected; blockout colours brightened after the first look (interiors were too dark to read).
    - Performance baseline recorded (TESTING.md §7.4): player step 5–10 µs; 11 draw calls, ~1,100 triangles; our frame cost ~1 ms. Reference-machine FPS still needs the physical machine.
  - Live Vercel preview: still not reachable from the container (proxy 403 for `*.vercel.app`).

- [x] **O-2 resolved** (D-039, 2026-09-26, docs only).
  - Loadout modelled as three **named** categories: **Melee** (always available; Bare Hands at start, e.g. a Knife later), **Primary** (the Pistol at start; AR, Shotgun, SMG later) and **Secondary** (in the data from the start, locked until progression / a milestone unlocks it).
  - Initial run: Bare Hands · Pistol · Secondary locked.
  - Acquisition: the **Supply Terminal** between waves, with **Scrap** as the primary purchase currency.
  - Also answers the melee part of O-6 (always-available quick melee, default key V) and part of O-1 (what Scrap buys). New open question O-13 (terminal presentation, Secondary unlock condition).
  - Documented in GAME_DESIGN (§4.1, §5, §11, §14), ARCHITECTURE (§5, §6, §7.3), DECISIONS (D-039, D-011, open questions) and README (controls). No code changes.

- [x] **Phase 2: Weapon Framework** (plan §9, D-040, loadout per D-039).
  - **Data** (`src/config/weapons.ts`): loadout categories, weapon definitions (firearm / melee, the categories each fits), Pistol and Bare Hands values, `STARTING_LOADOUT`, `WEAPON_RULES`, damage falloff. Values and reasoning in the new **BALANCING.md**.
  - **Framework** (`src/weapons/`): the plan's `Weapon` interface; `Firearm` (fire timing with exact remainders, fire modes, magazine, reserve, reload, spread, recoil, pellets, falloff) and `MeleeWeapon` (Bare Hands placeholder), both driven by data; `timing.ts` for step-exact timers.
  - **Loadout** (`WeaponManager`): named Melee / Primary / Secondary; `equip`, `cycle` (firearms only), `quickMelee`, `reload`, `acquire` (empty fitting category first, replacement without refund), `unlockSecondary`, `refillAmmo`, `setInfiniteAmmo`; trigger buffer, dry fire and auto reload, no firing while switching / reloading / quick-meleeing; sprint cancelled by attacks; typed events.
  - **Hitscan** (`hitscan.ts`): level hits as plain data (distance, point, normal), pluggable `HitscanTarget`s for enemies (walls block them), seeded uniform spread, aim direction.
  - **Recoil** through `PlayerLook` (`addRecoil`, `recoverRecoil`, `resetRecoil`): only the kick settles back; pulling down counts as recovery.
  - **Input**: `weapon1/2/3` renamed to `equipPrimary` / `equipSecondary` / `equipMelee`; `WeaponController` maps actions to a `WeaponInput`; `WeaponSystem` runs after the player on the fixed step.
  - **Presentation**: `WeaponView` (blockout pistol and fists, reload dip, kick, punch, muzzle flash, 32 reused impact markers) and a placeholder `WeaponHud` (crosshair, weapon name, `12 / ∞` / RELOADING).
  - **Debug (dev only)**: `tls.weapons()`, `giveAmmo()` and `setInfiniteAmmo()` (no longer stubs), `giveWeapon(id, category?)`, `unlockSecondary()`; overlay weapon line.
  - Verified:
    - 98 new unit and integration tests (623 in the suite), including a headless run through the real loop and input stack, and reproducible shots from the seed.
    - 17 of 17 planted weapon bugs caught (TESTING.md §4).
    - Two real defects found and fixed while testing: an idle weapon's cooldown banked one step of readiness (7 shots/s instead of 6), and step-aligned timers kept a floating-point residue (one extra step). The E2E suite also caught the muzzle flash never being drawn at low frame rates (the flash was shorter than one slow frame).
    - `npm run check` passes; `npm run build` has no warnings (game 66.6 kB, 22.0 kB gzipped); no debug code in `dist/`.
    - `npm run test:e2e`: 59 passed, 23 skipped by design. New `weapons.spec`: start loadout, firing with the mouse (magazine, hits on the desk, muzzle flash, impact markers, recoil settles), R reload and no firing mid-reload, dry fire + auto reload, 1 / 3 / 2 (refused), wheel cycling, V quick melee, pointer lock and the resume click; the HUD test also runs in production. Phase 0 and Phase 1 specs all still pass.
    - Browser screenshots of the Pistol, reload, fists and quick melee inspected; the view model was scaled down after the first look.
    - Performance baseline (TESTING.md §7.4): weapon step ≤ 2.7 µs even firing every step; a hitscan ray ≈ 1 µs; frame cost +0.1 ms while firing; ≤ 46 draw calls with all impact markers.
  - Live Vercel preview: still not reachable from the container (proxy 403 for `*.vercel.app`).

- [x] **Phase 3: Combat System** (plan §10, D-041).
  - **Pipeline** (`src/combat/`, new simulation folder): weapon hit → hitbox resolution → `computeDamage` → `Health` → death → events. Nothing zombie-specific: anything with a hitbox rig and a `Health` can be registered with the `CombatSystem`.
  - **Hitbox rigs** (`combat/hitbox.ts`, `config/combat.ts`): analytic spheres and capsules per zone (HEAD, TORSO, ARM_LEFT/RIGHT, LEG_LEFT/RIGHT) as config data, placed by position and yaw, independent of meshes (D-007); `HUMANOID_RIG`; bounding-sphere broad phase; nearest zone wins; pose swapping for later AI poses. `CombatSystem` is the rigs' `HitscanTarget`, so walls block targets and the nearest target wins through the Phase 2 hitscan.
  - **Damage** (`combat/damage.ts`): pure and deterministic: base × falloff (from the pellet's hit result) × zone multiplier (plan table; HEAD = the weapon's headshot multiplier, scaled by the target's HEAD entry) × attacker multiplier, then armor with a floor, then resistance. Crit = headshot. Hooks for upgrades, armor and archetype overrides, all neutral now.
  - **Health and death** (`combat/Health.ts`): current / max, configurable start, damage, heal, revive, `setMax`; death once; damage and healing ignored after death. `CombatSystem` emits `damaged`, `staggered`, `killed` (after the owner's `onKilled` deactivation hook) and `revived`; dead targets are no longer hittable.
  - **Hit reactions:** a stagger threshold per target over a 1 s window (`staggered` event).
  - **Feedback (placeholder):** `ui/CombatFeedback` (hit marker: hit / headshot / kill; pooled damage numbers, optional), body-hit sparks in `WeaponView`, dummy flash / rock / fall / stand-up.
  - **Ammo drops (foundation):** `config/drops.ts`, `world/drops.ts` (`rollDrops`, seeded), `world/PickupManager.ts` + `PickupView`; ammo goes to `WeaponManager.addAmmo` (limited reserves only, so the unlimited Pistol takes nothing).
  - **Training dummies (temporary):** `config/training.ts`, `combat/training/TrainingRange.ts` + `TrainingDummyView.ts`: a standard dummy (100 health, drops ammo) straight ahead of the spawn, another standard dummy and a zone-painted dummy (400 health); respawn after 3 s; reset every run.
  - **Debug (dev only):** `tls.combat()`, `dummies()`, `spawnDummy()`, `resetDummies()`, `clearDummies()`, `reviveDummies()`, `aimAt()`, `aimAtTarget()`, `showHitboxes()` (hitbox visualiser), `damageNumbers()`, `pickups()`, `spawnPickup()`; overlay combat line. `healPlayer` / `setGodMode` stubs now point to Phase 4.
  - Verified:
    - 126 new unit and integration tests (749 in the suite), including a headless run of the whole pipeline through the real loop, input stack and level, and identical combat events for the same seed.
    - 21 of 21 planted combat bugs caught (TESTING.md §4); the first pass caught 17 and the survivors led to new tests.
    - `npm run check` passes; `npm run build` has no warnings (game 86.6 kB, 28.7 kB gzipped); no debug code in `dist/`.
    - `npm run test:e2e`: 70 passed, 32 skipped by design. New `combat.spec` (10 tests): the range, headshot / body / arm / leg damage with hit markers and damage numbers, kill → fall → shots ignored → stand-up, reload in combat, V quick melee, ammo pickup, hitbox visualiser and numbers off; the DOM-only test also runs on the production build. All Phase 0–2 specs still pass.
    - Browser screenshots inspected (headshot, zoned torso hit, kill, hitbox wireframes).
    - Performance (TESTING.md §7.4): microseconds per shot; two findings fixed with measurements: 24 dummies drew ~285 draw calls (over the Low budget of 250), now ~59 with one merged mesh per dummy; and the first shot of a session hitched ~210 ms (present since Phase 2), now ~4 ms because hidden pooled objects are prewarmed.
  - Live Vercel preview: still not reachable from the container (proxy 403 for `*.vercel.app`).

- [x] **Phase 4: Zombie Foundation** (plan §11, D-042).
  - **Enemy framework** (`src/enemies/`): archetype data (`EnemyArchetypeConfig`: the plan's base fields plus body, rig, perception, attack shape, patrol, combat overrides, drops, behaviour), `Enemy` (pooled; the player's capsule motor as its body, a hitbox rig, a `Health`, an AI state machine), `EnemyManager` (spawn with a living cap and unique ids, combat registration exactly like a dummy, think scheduling, separation, movement, death, removal exactly once, `canStand` spawn validation). Nothing generic names an archetype; the Walker is data plus the melee brain.
  - **AI** (`enemies/ai/`): `EnemyStateMachine` (IDLE, PATROL, DETECT, CHASE, ATTACK, STAGGER, DEAD; one legal-transition table, strict mode throws); `meleeBrain`: perception (sight, memory, lose range, alerts from hits), chase, the attack (wind-up with a locked facing, one committed strike that can be dodged, blocked by walls, recovery, cooldown), stagger, target loss, idle and patrol. `think` runs at 10 Hz spread evenly over the steps; timing runs every step.
  - **Navigation** (`src/navigation/`): straight pursuit when a body can walk the line (`LineTester`), otherwise A* over the facility's authored route graph (37 nodes, 48 links, every link walked by a Walker body in tests); stuck detection falls back to the route; `clearance` validates spawn spots.
  - **Player health** (`player/PlayerHealth.ts`): 100, damage only in `WAVE_ACTIVE` / `BOSS` (D-029), death once → `GAME_OVER` → "You died" → click → a new run that resets player, enemies, dummies, pickups and weapons. Until waves exist, a run goes straight into one open-ended wave.
  - **Combat integration:** no redesign; `CombatSystem` gains `applyDamage` and `kill` (direct damage for debug and later hazards).
  - **Presentation (placeholder):** `EnemyView` (one skinned mesh per enemy built from its rig: zone colours, eyes, shamble, wind-up arms and orange glow, hit flash, stagger, fall and sink); `HealthHud` (health and a damage flash); the "You died" prompt.
  - **Test encounter (temporary):** three Walkers placed each run (two sentries beyond detection range of the spawn, one patroller), back 10 s after their body goes.
  - **Debug (dev only):** `tls.playerHealth()`, `healPlayer()`, `setGodMode()`, `damagePlayer()`, `killPlayer()`, `enemies()`, `enemy(id)`, `spawnEnemy()`, `spawnWalkers(n)`, `killEnemy()`, `killAll()`, `damageEnemy()`, `setEnemyState()`, `alertEnemies()`, `clearEnemies()`, `freezeEnemies()`, `showAI()` (AI visualiser); overlay enemy line.
  - Verified:
    - 185 new unit and integration tests (934 in the suite), including Walker chases into every area of the facility, the whole fight both ways through the real loop, identical results at 30, 60 and 144 Hz rendering, and the enemy cost at 1–64 Walkers.
    - Planted bugs: 46 of 46 unit-level and 4 of 4 end-to-end wiring bugs caught. The first unit run caught 34 of 44; the survivors exposed missing tests (a wall stepped behind during the wind-up, the attack pose never reset, turning per step instead of per second, a greedy A*, falling out of the level, the encounter's respawn delay, direct damage to the dead, a dead player still "vulnerable"), one equivalent mutant (replaced), and a real weakness in the stuck fallback (an obstacle the straight-line rays cannot see, such as a low kerb, sent it straight back into the obstacle), which was fixed and tested (TESTING.md §4).
    - `npm run check` passes; `npm run build` has no warnings (game 122.1 kB, 40.0 kB gzipped; three.js +5 kB for skinning); no debug code in `dist/`.
    - `npm run test:e2e`: 114 tests, 37 skipped by design. On the earlier host every Phase 0–3 spec passed with the Phase 4 changes (76 passed; the one failure was a page reload caused by editing a source file mid-run, and it passed on its own). The final run landed on a host about half as fast: `enemies.spec` passes in dev and production (7 of 7), and 4 wall-clock-sensitive Phase 1–3 dev tests fail there, identically on the unchanged Phase 3 commit (control run), so they are environmental (TESTING.md §8). New `enemies.spec` (6 tests): spawn → detect → chase → wind-up → the player hit through their Health; body shot, headshot + stagger, recovery, kill, corpse, clean removal; a Walker's last hit kills the player → GAME_OVER once → a new run resets everything; hitbox and AI debug views; a crowd of 16; and a production test with real keys only (walk into the yard, get killed, click for a new run). All Phase 0–3 specs still pass (updated for the run flow and the three extra combat targets).
    - Browser screenshots inspected (idle, chase, wind-up from the front and in profile, stagger, dead, game over).
    - Performance (TESTING.md §7.4): simulation cost measured at 1–64 Walkers (well inside the 4 ms step budget). One finding fixed with measurements: a body mesh plus an arms mesh per enemy drew 272 draw calls at 64 Walkers (over the Low budget of 250); one skinned mesh per enemy draws 144.
  - Live Vercel preview: the PR's Vercel deployment succeeds, but the preview is still not reachable from the container (proxy 403 for `*.vercel.app`).

- [x] **Phase 5: Zombie Archetypes** (plan §12, D-043).
  - **O-3 resolved:** the default roster is Walker, Runner, Tank and Screamer (`DEFAULT_ROSTER`). The Climber is deferred: not implemented, not in normal waves, kept in the data as possible adaptive content (a response to high-ground play, Phase 8).
  - **Archetypes as data plus two behaviours:**
    - New archetype options: `staggerZones`, `attack.lunge`, `weave`, `preferredRange`, `ability`.
    - `ai/common.ts` holds what every behaviour shares (extracted from the Phase 4 melee brain).
    - `meleeBrain` (Walker, Runner, Tank) gains the weave and leap options; `screamerBrain` (Screamer) is new.
    - The state machine, decision schedule, navigation and combat are unchanged.
  - **Runner:** 5.2 m/s, 60 health. It weaves in the open, then does a telegraphed, committed leap (2.2 m at 9 m/s) and brakes hard on landing. Any body shot staggers it.
  - **Tank:** 360 health, 1.1 m/s. Body shots do ½, limbs 0.35; only headshots stagger it. It hits for 35 after a 1.1 s wind-up, has no ranged attack, and its big body fits every route.
  - **Screamer:** keeps 6–11 m, backs away from a close player, and screams with a 1.2 s raised-arms violet telegraph. The cooldown is spent when the scream starts, and any solid hit interrupts it.
  - **Alarm event (generic):** payload `{sourceId, kind, position, radius, targetId, targetPosition, alertDuration, haste, time}`.
    - Prototype response in `EnemyManager`: enemies within 18 m are alerted (8 s) and hastened (×1.35 for 6 s; refreshed, not stacked).
    - Presentation: a violet shockwave ring (`EnemyView`) and a screen-edge pulse (`ui/AlarmPulse`).
  - **Traits** (`config/traits.ts`): Armored, Helmeted and Elite as composable data overlays on any archetype.
    - `applyTraits` is pure and uses a canonical order.
    - Traits can be set at run time with the health fraction kept; they reset in the pool.
    - Elite rolls a bonus drop.
  - **Combat:** a generic `DamageProfile` (per-zone armor, breakable `ArmorPlate`s, stagger zones), `configure()` at run time, the `armorBroken` event, and `armorReduction` / `absorbed` in `damaged`. A steel "armored" hit marker.
  - **Movement:** separation fits big bodies and anticipates closing ones, so a sprinting Runner steers round others instead of running through them. Postures (the Runner's lean, the Tank's hunch) are part of the hitbox rigs (`leanRig`), so what is drawn is what is hit.
  - **Presentation (placeholder):**
    - Per-archetype builds from their rigs, with palettes, eyes, the Screamer's mouth and raised arms, and telegraph colours.
    - Trait attachments (plates, a helmet that disappears when broken, spikes) in the same skinned mesh; geometry is cached per archetype and set of attachments.
  - **Test encounter:** one of each archetype, and each trait once (5 enemies).
  - **Debug (dev only):**
    - `tls.spawnEnemy(type, distance, traits)`, `spawnMixed()`, `traits()`, `setTraits()`, `applyTrait()`, `removeTrait()`, `forceAbility()`.
    - `enemy(id)` stats, plates and haste.
    - `showAI()` labels with traits and haste, and the ability-radius ring.
  - Verified:
    - 113 new unit and integration tests (1047 in the suite): traits, mitigation, Runner and Tank, the Screamer and the alarm, traits on enemies, mixed groups (including head-on Runner passes), every archetype through the real game, and the cost at 1–64 mixed.
    - Planted bugs: 49 of 49 unit-level and 4 of 4 end-to-end bugs caught. The first unit run caught 40 of 48; the survivors led to stronger tests and to one real fix (TESTING.md §4). Separation did not stop a Runner running through an oncoming enemy, and now anticipates closing bodies.
    - Two defects found while testing and fixed:
      - Runners ran through other enemies (the separation above).
      - The Runner's and Tank's resting lean was only drawn, so the Runner's visible head sat about 0.2 m ahead of its hit sphere. The lean is now in the rig.
    - `npm run check` passes; `npm run build` has no warnings (game 140.8 kB, 45.8 kB gzipped); no debug code in `dist/`; the plan's hash is unchanged.
    - `npm run test:e2e` (final run): 124 tests; 76 passed and 42 skipped by design. All production tests passed, including the real-keys run against the new encounter, as did every enemy and archetype spec.
      - New `archetypes.spec` (5 tests): Runner, Tank, Screamer (alarm, shockwave, pulse, haste, interruption), traits (attachments, helmet break, live changes), a mixed group of 8. It also passed twice in a row on its own.
      - `enemies.spec` and the other specs are updated for the five-enemy encounter.
      - 6 dev tests failed: the 4 known wall-clock-sensitive Phase 1–3 tests, plus Phase 1 sprint/crouch and Phase 0's fixed-step loop check, all timed in real time on a 2–6 FPS host. All 6 fail identically on the unchanged Phase 4 commit (control run; TESTING.md §8).
    - Browser screenshots inspected (each archetype, the traits, the scream's wind-up and shockwave with the AI view).
    - Performance (TESTING.md §7.4): 64 mixed cost 1.27 ms per step headless against 1.15 ms for 64 Walkers on the same host, the same 144 draw calls in the browser and the same frame cost. Traits add triangles, not draw calls. One cost regression was found and fixed with measurements: the first anticipation bound doubled separation to 325 µs at 64; an exact rejection brought it to 158 µs.
  - Live Vercel preview: still not reachable from the container (proxy 403 for `*.vercel.app`).

- [x] **Phase 6: Wave System** (plan §13, D-044).
  - **Data:** `WAVE_RULES` in `config/waves.ts` (budget curve, concurrency, spawn rate, group size, unlocks, caps, tier weights, themes, guarantees, trait schedule and Elite limit, modifier clamps, timings, spawn and straggler rules); the plan's `WaveDefinition` extended with `tier`, `theme`, `finale`, `boss`, the ordered `spawns`, `budgetSpent`, `groupSize`, `spawnBias` and `modifiers`; 13 facility spawn points with compass regions (the catwalk one reserved).
  - **`waves/`:**
    - `WaveDifficulty` (pure curves, any wave number) and `WaveGenerator` (seeded per run and wave; spend within 1 of the budget; roster only, never the Climber; first appearance = 1; Walkers ≥ 30 %; finale heavies; heavies out of the opening).
    - `WaveMutation` (the Phase 7 selection slot, returns `null`).
    - `SpawnDirector` (distance, view cone + line of sight, body fit, walkable group slots; weighted by distance band, recent use and bias; relaxed view rule only after 3 s of retries).
    - `WaveManager` (the wave cycle on fixed-step timers, pacing under `maxAlive`, completion by wave ids, breather, victory / endless, alarm pull-forward, stragglers, debug jumps), `WaveEvents`, `RunStats`.
  - **Plug-in channel:** `CompositionModifier {source, archetypeWeights, traitChance, extraArchetypes, budgetMultiplier, spawnBias}`: adaptive (Phase 8) and mutations (Phase 7) shape waves through it; every value is clamped and adaptation never changes the budget (D-026).
  - **Enemies:** `EnemyManager.reserve` (pools readied during the intro), `died` carries the traits, `EnemyView.prewarm` builds a wave's looks before it starts.
  - **Run flow and presentation:** `main.ts` wires the wave runtime (stepped before the enemies); the Phase 3–5 sandbox (dummies, encounter, open-ended wave) moves behind `?sandbox=1`; `?endless=1`; `WaveHud` (`WAVE 7 · 12 LEFT`, announcement and breather banners); `LockPrompt` victory mode and the wave reached on both end prompts.
  - **Debug (dev only):** `startWave`, `completeWave`, `skipWaveTimer`, `wave`, `previewWave`, `waveTable`, `setEndless`, `pauseSpawning`, `runStats`, `spawnPoints`, `showSpawns` (`SpawnDebugView` rings), an overlay line.
  - Verified:
    - 69 new unit, property and integration tests (1116 in the suite): the curves (the exact budget table), the generator over waves 1–200 × 30 seeds, spawn points, the runtime (timings to the step, pacing, completion, victory / endless, death, pause, alarm, stragglers, fallback, stats, determinism), and waves in the full loop (waves 1–3, D-029, death, the same spawns at 30 / 60 / 144 Hz).
    - Planted bugs: 45 of 45 unit-level (37 on the first run; the survivors led to 7 new tests and one equivalent mutant was replaced) and 8 of 8 end-to-end bugs caught (TESTING.md §4).
    - `npm run check` passes; `npm run build` has no warnings (game 161.4 kB, 52.5 kB gzipped); no debug code in `dist/`; the plan's hash is unchanged.
    - `npm run test:e2e`: 136 tests; 83 passed, 47 skipped by design. The new `waves.spec` (6 tests: the wave cycle with fair spawns and D-029, victory and a new run, endless, death on the wave reached, the debug tools, the DOM-only HUD in every build) passes in dev and prod, as do all production tests and every enemy, archetype and debug spec. 6 dev tests failed, all wall-clock-sensitive (TESTING.md §8): 4 `player.spec` tests and 2 `combat.spec` marker tests; the two combat ones fail identically on the unchanged Phase 5 commit on this host (control run).
    - Performance (TESTING.md §7.4): wave 20 at its full 24 costs 0.39 ms per step headless; steps that spawn a group 0.8–1.4 ms; in the browser 6.6 ms per frame with 68 draw calls. Two costs were found and fixed with measurements: a spawn pick 1.39 → 0.35 ms, wave generation 3.1 → 0.86 ms. The intro's prewarm removes a ~15 ms first-spawn hitch (21 ms → 6 ms).
  - Live Vercel preview: builds pass for every push; still not reachable from the container (proxy 403 for `*.vercel.app`).

- [x] **Phase 7: Signal Mutations** (plan §14, D-045).
  - **Data:** `config/effects.ts` (the typed `Effect` union of the five D-009 kinds, the registered vocabulary, `EFFECT_CLAMPS`); `config/mutations.ts` (all eight mutations with name, rule, hint, status, first wave, tier weights, group, accent and effects; six enabled, LOW GRAVITY and OVERLOAD deferred; selection rules); `config/environment.ts` (environment channels, the `blackout` and `bloodMoon` overlays, visibility floors, light settings); three emergency lamps in the facility data; mutation-only `CompositionModifier` fields (`eliteMaxBonus`, `eliteMinimum`, `surges`) and `WaveDefinition.surges`.
  - **Effect runtime (`modifiers/`, `world/Environment`):** `StatRegistry`, `TriggerRegistry`, `ScreenEffects` (the STATIC schedule), `EffectRouter` (atomic apply, clamps, remove by source and kind), `Environment` (base + prioritised overlays fading in simulated time, visibility floors).
  - **Selection and waves:** `selectMutation(n, history, rng)` and `mutationSchedule`; `generateWave` builds the mutation's composition itself (HIVE's budget and surges, BLOOD MOON's Elites); `WaveManager` keeps the run's mutation history, runs surges generically (announced, then spawned within the cap), pulls groups forward only for reinforcing alarms, reports `status.mutation` and `status.surges`; `RunStats` records each wave's mutation.
  - **Enemies:** per-step speed and acceleration multipliers with the HUNGER cap (0.9 × sprint, never slowing a faster enemy; the leap and landing brake untouched); `EnemyManager.raiseAlarm`; `AlarmEvent.kind` (`scream` | `deathCry`) and `reinforcements`.
  - **Lifecycle (`signal/`):** `SignalMutationSystem` (announce with lighting in `WAVE_START`, apply play-changing effects in `WAVE_ACTIVE`, lift in `WAVE_COMPLETE`, end on death / victory / menu, reset on a new run), `MutationEvents`, the `deathCry` trigger action.
  - **Presentation:** `LightingController` over a light rig built at load (hemisphere, sun, fog, three emergency lamps with unlit pools of light on the floor, which replaced three point lights after measuring them); a muzzle `PointLight` in `WeaponView`; enemy eyeshine; red DEATH CRY rings; `MutationHud` (card, badge with Elite count and STATIC flicker, `LIFTED`, the surge cue and arrow); `StaticOverlay` (under the HUD, clear centre, ≤ 3 Hz, reduced motion); `AlarmPulse` only for screams; the game-over prompt names the mutation.
  - **Debug (dev only):** `mutation`, `mutations`, `triggerMutation` (replaces the stub), `startWave(n, id?)`, `clearMutation`, `setMutations`, `mutationSchedule`, `staticBurst`, an overlay line.
  - Verified:
    - ⟨UNIT⟩ new unit, property and integration tests (⟨TOTAL⟩ in the suite): the catalogue and clamps, the effect runtime, the environment, selection properties over 50 runs × 60 waves, the generator per mutation, the enemy hooks, the lifecycle (every way a wave ends leaves nothing behind), the full loop (waves 4–8, D-029, pause, death, 30 / 60 / 144 Hz), and the scripted-defender tripwire (BALANCING §2.15).
    - Planted bugs: ⟨PLANTED⟩ (TESTING.md §4).
    - `npm run check` passes; `npm run build` ⟨BUILD⟩; no debug code in `dist/`; the plan's hash is unchanged.
    - `npm run test:e2e`: ⟨E2E⟩
    - Browser screenshots of all six mutations inspected; STATIC was toned down after the first look (BALANCING change log).
    - Performance (TESTING.md §7.4): ⟨PERF⟩
  - Live Vercel preview: still not reachable from the container (proxy 403 for `*.vercel.app`).

## Active Task

None. Phase 7 is complete; waiting for approval to start **Phase 8**.

## Known Bugs

- **Test infrastructure, not the game:** 4 Phase 1–3 end-to-end tests (6 on the slowest hosts, adding a Phase 1 real-time check and either `combat.spec`'s headshot marker or Phase 0's fixed-step check) are wall-clock-sensitive and fail when software rendering drops below ~7 FPS (TESTING.md §8). The player can walk through enemies (a known Phase 4 limitation, not a bug: D-042). Enemies can overlap briefly in a crowd (at most ~0.2 s, tested): separation is a push that anticipates closing bodies, not a hard constraint (D-043).

## Next Task

**Phase 8: Adaptive Zombie System (plan §15).** The signature mechanic: a lightweight player behaviour profile (weapon usage, headshot rate, average distance, time in one area, high-ground use, sprinting, melee, accuracy, damage taken, kiting) that changes later waves through thresholds and cooldowns, never instantly, so it feels like natural adaptation rather than punishment. The slots are ready:
1. **Composition only (D-026):** responses arrive through `WaveManager`'s `modifiers()` as `CompositionModifier`s with `source: 'adaptive'` (archetype weights, trait chances, spawn bias, `extraArchetypes`), all clamped; adaptation never changes the budget, never picks or suppresses mutations, never raises alarms.
2. **Evaluation at `WAVE_COMPLETE`** (GAME_DESIGN §10, ARCHITECTURE §7.9), with hysteresis, minimum samples and cooldowns; explained to the player after the wave ("SIGNAL ANALYSIS").
3. **Mutation-aware metrics:** `RunStats` records each wave's mutation, and DEATH CRY alarms carry `kind: 'deathCry'`, so mutation-caused events can be discounted.
4. **The Climber** (D-043) as possible adaptive content against high-ground play, if Phase 8 brings it in.
5. **Verify:** thresholds and cooldowns, clamps, the budget untouched, determinism, explanations, E2E, performance.

**Needed from you:**
- Approval to start Phase 8.
- A manual QA pass of TESTING.md §6 in real browsers, including the new "Signal Mutations" section: how each mutation feels (and whether BLACKOUT needs a flashlight, O-10) can only be judged by hand.
- Run the performance measurement on the reference machine (TESTING.md §7.2, with `tls.startWave(19, 'BLACKOUT')`), and confirm the GTX 750's VRAM (1 GB or 2 GB).

**Deferred on purpose:**
- **From 0.2:** state-scoped timers and the `GameEvents` payload map arrive with the first system that needs them. The `EventBus` is implemented and tested but has no consumers yet.
- **From 0.4:**
  - A `beforeunload` confirmation during a run (with the run lifecycle).
  - Settings persistence for sensitivity, invert-Y, FOV and head bob (settings phase; the runtime `applyView` path already exists).
  - Replacing `LockPrompt` with the pause menu (UI phase).
- **From 0.5:**
  - Balance numbers in `src/config/` (each system's phase, logged in BALANCING.md).
  - The analytics interface (plan §30).
- **From 0.6:** CI (a GitHub Actions workflow running check, build and e2e on each PR) is recommended but not yet added.
- **From 1:**
  - Gravity as a `Stat` (D-006): the stat registry exists (Phase 7); `world.gravity` is registered when LOW GRAVITY is enabled.
  - Level tags, spawn points, objective nodes, nav grid and light fixtures (D-013) arrive with the phases that use them.
  - A graphics settings menu, persistence and auto-detection (D-037 §8).
  - Small per-step allocations in the octree query and intent object (ARCHITECTURE §8): revisit only with profiling evidence.
- **From 2:**
  - The Assault Rifle and Shotgun (Primary purchases, data only), the Knife and Secondary weapons (D-039, D-040).
  - The Supply Terminal, prices and Scrap (progression / economy phases, O-13).
  - The loadout strip in the HUD, aim down sights (right mouse), weapon lowering while sprinting, weapon audio.
  - Bare Hands hit arcs and animation-timed impacts (combat).
  - Impact markers as one `InstancedMesh` if draw calls ever matter (they do not now).
- **From 3:**
  - Pose presets per AI state beyond the attack's reach pose (with real animation).
  - Helmets (per-zone armor that breaks), boss weak points (a crit flag on shapes), armored modifiers (D-012).
  - A settings toggle for damage numbers (settings phase); blood, gore, hit and kill sounds (VFX and audio phases); a kill feed.
  - Other pickup kinds (health, components) and the ammo economy (progression / economy phases).
  - Training dummies removed from normal play (done in Phase 6: they appear only with `?sandbox=1`); they do not collide with the player.
- **From 4:**
  - ~~The wave spawner, spawn points and the wave flow~~ done in Phase 6 (the placeholder run flow and the test encounter moved to `?sandbox=1`).
  - Body blocking: the player can walk through enemies (they stop short and push away from the player, but the player's motor does not collide with them).
  - A flow field (D-008) or a spatial hash for separation, only if a measurement with bigger hordes asks for it (at 64 Walkers the AI costs well under a millisecond per step).
  - Distance-based think rates ("distant enemies think less often"), not needed at the measured cost.
  - The full HUD (low-health vignette and heartbeat, damage direction), healing, and a real game-over screen (wave reached, cause of death: GAME_DESIGN §16).
  - Final zombie models and animation (D-030).
- **From 5:**
  - The Climber (deferred, D-043): its data, a climbing behaviour and climb links in the level's navigation, if the adaptive system (Phase 8) brings it in against high-ground play.
  - Alarm consumers: wave reinforcements (done in Phase 6: the next group is pulled forward), SCREAM (done in Phase 7 as DEATH CRY, its own alarm kind), adaptive metrics (Phase 8), scream audio (Phase 11).
  - Hard enemy–enemy collision (separation is a push; brief brush-throughs are accepted and bounded by a test).
  - Short animation leans (a wind-up, a leap) are drawn without the hit volumes following; resting postures are in the rigs.
  - Trait visuals beyond placeholders; audio for the helmet breaking.

- **From 6:**
  - ~~Mutations (Phase 7)~~ done (D-045); the adaptive modifiers (Phase 8), the upgrade screen and Supply Terminal in `UPGRADE_SELECTION` (Phase 9) and the boss on wave 20 (Phase 13) plug into the slots D-044 left.
  - Endless health scaling (if ever, capped) and a wave-clear heal (if runs prove too short): balancing Pass 2.
  - An endless-mode option in the menu (UI phase); for now `?endless=1` or `tls.setEndless(true)`.
  - The real end screens with run stats (UI phase); `RunStats` already collects them.
  - More spawn points with the Phase 10 facility; climb links and the Climber via the adaptive channel.

- **From 7:**
  - LOW GRAVITY and OVERLOAD (deferred, D-045): register `world.gravity` (player and enemy motors) or `weapon.recoil` and the `environmentPulse` action, then flip `status` to `enabled`.
  - A flashlight for BLACKOUT (O-10), only if playtests ask for it.
  - The mutated-wave reward bonus (GAME_DESIGN §9, Phase 9).
  - Mutation audio (a sting per mutation, static crackle, the death-cry cue, the surge roar; Phase 11): `MutationEvents` and `surgeWarning` / `surgeSpawned` are the hooks.
  - Mutation icons (UI phase); the badge is text for now.
  - The wave-20 rules with the boss (Phase 13): wave 20 has no mutation until then.

## Blocked Tasks

Nothing is blocked now. These later tasks need decisions (full list in `DECISIONS.md` → Open questions):

| Task | Blocked on | Needed by |
|---|---|---|
| Supply Terminal presentation; Secondary unlock condition | O-13 | Phase 9 / Phase 14 |
| Technician upgrade | O-6 (no utility/trap system defined) | Phase 9 |
| Performance measurements on the weak reference (TESTING.md §7) | Access to the reference machine (i5-4440 / GTX 750); the container has no GPU. The map, weapons and `?quality=low` are ready | Now, then each phase |
| XP/Scrap sinks (meta-progression screen) | O-1 | Phase 9 |
| Signal objective rules; interact binding | O-12, O-6 | Phase 12 |
| Real art and audio | O-8 | Milestone 2+ |
| Public release | O-11 (licence) | Before first public deployment |
| E2E against the live Vercel preview from the cloud container | The environment's network policy denies `*.vercel.app` (403). Allow the host in the environment's network settings, and provide `VERCEL_AUTOMATION_BYPASS_SECRET` if the preview is protected | Any time |
| Manual QA in real Chrome / Edge / Firefox (TESTING.md §6) | A person with real browsers and hardware | Before Milestone 1 sign-off |

---

## Phase 0 plan: Project Foundation

Each step is one small commit (plan §37). Every step must end with typecheck, lint and tests passing.

| Step | Scope | Acceptance |
|---|---|---|
| **0.1 Toolchain scaffold** ✅ | `package.json` (npm; Node ≥22.12 engines). Dependencies: `three@0.186.1`; dev dependencies from D-002. `tsconfig.json` (strict, `noUncheckedIndexedAccess`, `noImplicitOverride`, `verbatimModuleSyntax`, `erasableSyntaxOnly`). ESLint flat config (typescript-eslint type-checked plus the layer import rules from ARCHITECTURE §2). Prettier, Vitest, `.gitignore`, `.nvmrc`, `.editorconfig`. `index.html` and a minimal `src/main.ts`. Scripts: `dev`, `build`, `preview`, `typecheck`, `lint`, `format`, `test`. | `npm ci`, `typecheck`, `lint`, `test` and `build` all pass. `npm run dev` serves a page with no console errors |
| **0.2 Core primitives** ✅ | `EventBus` (typed), `Time` (fixed-step clock, time scale), `GameState` (12 states, hierarchy, pause stack, transition table), `utils/Rng` (seeded), `utils/Pool` | Unit tests cover every legal and illegal transition, pause/resume restoring the child state, and event ordering and re-entrancy |
| **0.3 Render foundation** ✅ | `render/Renderer` (WebGL2 check, DPR cap, resize), `core/Game` bootstrap and fixed-step loop (ARCHITECTURE §3), test scene (floor, boxes, light), camera | Stable loop; resize correct at 1366×768–1920×1080 and smaller; no console errors |
| **0.4 Input** ✅ | `input/InputManager` (key `code`s, mouse buttons, wheel), pointer lock wrapper (D-017), `config/input.ts` default bindings, blur/visibility → pause hook | Input verified with the debug overlay; pointer lock acquire, lose and re-acquire works |
| **0.5 Config, debug, errors** ✅ | `core/Config.ts`, `src/config/` type skeletons, `debug/` (dev-only dynamic import, `window.tls` stub, FPS counter overlay), `core/ErrorHandler` (global errors, WebGL missing, context lost) | Production build contains no debug code (bundle checked); a forced error shows the error screen |
| **0.6 Verify and document** ✅ | `TESTING.md` (strategy plus manual QA checklist). Optional Playwright smoke test (loads, renders, no console errors). Update `PROGRESS.md` and `ARCHITECTURE.md` | Every Phase 0 acceptance criterion in plan §7 is met and recorded |

Plan §7 acceptance criteria: launches; no TypeScript errors; no console errors; stable rendering loop; resize works; input works; state transitions are testable.

---

## Phase 0 acceptance review (plan §7)

Reviewed 2026-09-25 against the code on this branch.

| Plan §7 task | Status | Evidence |
|---|---|---|
| Initialize Vite + TypeScript | Done | 0.1; a clean `npm ci` + `npm run build` |
| Configure strict TypeScript | Done | `tsconfig.json`: `strict`, `noUncheckedIndexedAccess`, `erasableSyntaxOnly`, … |
| Configure ESLint | Done | Type-aware strict rules plus layer-boundary rules for simulation and `input/` |
| Configure formatting | Done | Prettier; `format:check` in `npm run check` |
| Create folder architecture | Done, by design incrementally | Tree defined in ARCHITECTURE §6; 8 folders exist, the rest are created with their first file (D-036) |
| Create Game bootstrap | Done | `core/Game.ts`, `main.ts` composition root |
| Create rendering loop | Done | Fixed-step loop, `Game.test.ts`, `smoke.spec` |
| Create scene / camera | Done | `world/TestSceneView.ts` (replaced by `WorldView` in Phase 1), `render/camera.ts` |
| Create resize handling | Done | `render/Renderer.ts` + `viewport.ts`; `resize.spec` |
| Create input manager | Done | `input/` (0.4); `input.spec` |
| Create EventBus | Done (no consumers yet) | `core/EventBus.ts`, 25 tests; first consumers come with gameplay events |
| Create configuration system | Done | `core/Config.ts` + `src/config/` skeletons |
| Create game state machine | Done | `core/GameState.ts`, all 12 plan states, 132-pair transition test |
| Add debug mode / FPS counter | Done | `debug/` (dev only), `tls`, overlay; `debug.spec` |
| Add basic error handling | Done | `core/ErrorHandler.ts`, `ui/StatusScreen.ts`; `resilience.spec` |

| Acceptance criterion | Met | How it is verified |
|---|---|---|
| Project launches successfully | Yes | `smoke.spec` in dev and prod; clean `npm ci` |
| No TypeScript errors | Yes | `npm run typecheck` (app + e2e) |
| No console errors | Yes | Every e2e test asserts a clean console, in dev and prod |
| Rendering loop stable | Yes | `smoke.spec` (steps + dropped time = real time), `Game.test.ts`; our frame cost about 1 ms |
| Resize works correctly | Yes | `resize.spec`: 5 resolutions, live DPR changes, cap, collapsed container |
| Input system works | Yes, automated. Real-browser items pending manual QA | `input.spec`, `input/*.test.ts`; TESTING.md §5–6 |
| Game state transitions are testable | Yes | `GameState.test.ts`, `Game.test.ts`, `stepInput.test.ts`, e2e via `tls` |

**Open items that did not block Phase 1:**
- Manual QA in real browsers.
- The live Vercel preview is blocked by the container's network policy.
- No CI yet.
- O-9 is resolved (D-037). The first reference-machine measurement is due now that the Phase 1 map exists.

---

## Phase 7 acceptance review (plan §14)

Reviewed 2026-09-29 against the code on this branch, with the scope the project owner set for Phase 7 (six mutations, LOW GRAVITY and OVERLOAD deferred but representable, waves 1–3 free, the Screamer / SCREAM / Adaptive overlap resolved, no adaptive system, archetypes, bosses or upgrades).

| Plan §14 / Phase 7 requirement | Status | Evidence |
|---|---|---|
| Every normal wave receives one mutation | Done | One on every wave from 4 except 20 (O-7), endless included; `WaveMutation.test.ts` properties; `mutationSchedule` = the played run |
| Mutations modify gameplay rules | Done | Stats (HUNGER), triggers (DEATH CRY), environment (BLACKOUT, BLOOD MOON), screen (STATIC), spawn rules (HIVE, BLOOD MOON); lifecycle and full-loop tests |
| Data-driven; not hard-coded into `WaveManager` | Done | `config/mutations.ts` + the effect runtime; `WaveManager` runs surges and alarms generically, with no per-mutation code |
| The v1 set (O-4): BLACKOUT, HUNGER, STATIC, SCREAM, HIVE, BLOOD MOON; LOW GRAVITY and OVERLOAD deferred but representable | Done | `status: 'deferred'` with full effect data; refused atomically by the router, never selected (tested) |
| Screamer / SCREAM / Adaptive overlap resolved; the player always knows why | Done | `AlarmEvent.kind` + `reinforcements`; red DEATH CRY ring vs violet scream; card, badge, per-occurrence cues, `LIFTED`, game-over naming (unit + E2E) |
| Adaptive changes composition only; mutation budget changes clamped and mutation-owned (D-026) | Done | Mutation-only fields ignored from other sources; clamps tested in data and at runtime |
| Guardrails: never silently impossible, spawn safety, concurrency cap, visibility, budget, determinism | Done | Tripwire; surges within `maxAlive` and spawn rules; visibility floors; clamps; 30 / 60 / 144 Hz timelines; seeded streams |
| No shader recompiles (D-022) | Done | Lights exist from load; program count unchanged across all six mutations (E2E) |
| Debug commands | Done | `triggerMutation` (was a stub) and the mutation tools; absent from `dist/` |
| Tests, planted bugs, E2E, performance | Done | See "Completed Tasks → Phase 7" and TESTING.md §3, §4, §7.4 |

**Open items that do not block Phase 8:** a hands-on feel check of each mutation (and O-10's flashlight question); reference-machine measurement with the new lights; Vercel preview not reachable from the container; no CI yet; the known wall-clock-sensitive E2E tests.

---

## Phase 6 acceptance review (plan §13)

Reviewed 2026-09-28 against the code on this branch, with the scope the project owner set for Phase 6 (the wave system with slots for mutations, bosses, adaptation and upgrades; the Climber excluded; none of those systems implemented).

| Plan §13 / Phase 6 requirement | Status | Evidence |
|---|---|---|
| Each wave has `waveNumber, enemyBudget, spawnRate, enemyComposition, mutation, specialEvent, bossFlag` | Done | `WaveDefinition` (plus `maxAlive`, `tier`, `theme`, `finale`, `boss`, `spawns`, …); `WaveGenerator.test.ts` |
| Controlled difficulty curve: 1–3 introduction, 4–7 variety, 8–12 pressure, 13–19 combinations, 20 boss / major event; not ever-growing HP | Done | Budget, concurrency, unlocks, caps, tier weights, themes, trait schedule (BALANCING §2.14); no HP scaling; wave 20 is a `finale` until the boss (Phase 13); `WaveDifficulty.test.ts` (exact table) |
| Unlimited waves | Done | Every curve has an endless tail; property tests to wave 200, finite to 10 000; `?endless=1` in the browser |
| Enemy budget and composition; Walker / Runner / Tank / Screamer; Climber excluded from normal waves | Done | Seeded generator, roster only, extras only from adaptive modifiers for implemented archetypes; "never the Climber" tested from every modifier source |
| Spawn pacing and fair spawn points | Done | `SpawnDirector` (≥ 12 m, out of view with line of sight, bodies fit, walkable slots, spread, bias, relaxed fallback); `WaveManager` pacing under `maxAlive`; unit, integration and E2E checks |
| Wave start / active / complete transitions; interaction with player health and game over | Done | The FSM cycle with an intro and a breather; D-029 (no damage between waves, unit + E2E); death → `GAME_OVER` with the wave reached; victory after wave 20 |
| Screamer alarms interact with waves | Done | The next queued group is pulled forward toward the alarm, no extra budget (tested) |
| XP / Scrap interaction (without implementing them) | Slot | `waveCompleted`, `died` with traits, `RunStats` (kills per archetype, Elite kills, headshots, damage, wave times) |
| Mutation and boss slots; adaptive plug-in | Slot | `selectMutation` (returns `null`), `definition.mutation`, `bossFlag` / `boss`, `WAVE_START → BOSS`; `CompositionModifier` channel with clamps and the D-026 budget rule (tested) |
| Debug commands | Done | `startWave`, `completeWave`, `skipWaveTimer`, `wave`, `previewWave`, `waveTable`, `setEndless`, `pauseSpawning`, `runStats`, `spawnPoints`, `showSpawns`, overlay line; absent from `dist/` |
| Tests, planted bugs, E2E, performance | Done | See "Completed Tasks → Phase 6" and TESTING.md §3, §4, §7.4 |

**Open items that do not block Phase 7:** manual feel check of the pacing in real browsers; reference-machine measurement; Vercel preview not reachable from the container; no CI yet; the known wall-clock-sensitive E2E tests.

---

## Phase 5 acceptance review (plan §12)

Reviewed 2026-09-27 against the code on this branch, with the scope the project owner set for Phase 5 (the O-3 roster, the Runner, the Tank, the Screamer, traits and the alarm event; no waves, mutations, adaptive system, Climber, bosses or final art).

| Plan §12 / Phase 5 requirement | Status | Evidence |
|---|---|---|
| O-3: default roster Walker, Runner, Tank, Screamer; Climber deferred and extensible; possible adaptive content; not in normal waves | Done | `DEFAULT_ROSTER`, `IMPLEMENTED_ENEMY_IDS` (no Climber), `ENEMY_ARCHETYPES.climber.inV1 = false`; D-043 §1; config tests |
| Runner: fast, fragile, same movement / collision / hitbox / health / combat / targeting, feels different through movement and pressure | Done | Data + melee options (weave, committed leap, landing brake); `archetypes.test.ts` (speed, closing time, detection, weave, leap, dodge, stagger, death); E2E |
| Tank: high health, slow, strong melee, head-only stagger, no ranged attack, resistance as data | Done | Zone multipliers + `staggerZones`; `archetypes.test.ts`; integration (Pistol vs Tank); E2E |
| Screamer: detection, configurable range and cooldown, readable wind-up, generic event, prototype effect, no WaveManager or mutation dependency | Done | `screamerBrain.ts`, `alarm` event, `EnemyManager.respondToAlarm` (alert + haste), shockwave ring, alarm pulse; `screamerBrain.test.ts` (19); E2E |
| Traits: generic, composable, on any archetype, damage and hitboxes consult them, deterministic, data-driven (Armored, Helmeted, Elite) | Done | `config/traits.ts` (`applyTraits`), `DamageProfile` (zone armor, plates, stagger zones, `configure`), run-time `setTraits`; `traits.test.ts`, `armor.test.ts`, `enemyTraits.test.ts` |
| Presentation: readable per archetype and trait, not by colour alone; procedural | Done | Rig-built bodies (size, lean, head), mouths, raised arms, plates / helmet / spikes as geometry; screenshots inspected |
| AI: reuse the Phase 4 foundation, common state machine, limited-rate decisions; per-archetype speed, attack, distance, ability, stagger, perception | Done | `ai/common.ts` shared by two behaviours; think at 10 Hz spread; mixed-population cost measured |
| Combat: every archetype through the existing CombatSystem (heads, torso, limbs, stagger, death, drops); no per-archetype damage code | Done | `enemies.integration.test.ts` (Pistol vs every archetype), `mixed.test.ts`; drops per archetype + Elite bonus |
| Debug tools (dev only): spawn each / mixed, apply / remove traits, inspect, AI state, force ability, ranges | Done | `tls.spawnEnemy(type, d, traits)`, `spawnMixed`, `traits`, `setTraits`, `applyTrait`, `removeTrait`, `forceAbility`, `enemy(id)` stats, `showAI()` labels and ability ring; absent from `dist/` |
| Tests, planted bugs, E2E, performance at 1–64 mixed | Done | See "Completed Tasks → Phase 5" and TESTING.md §3, §4, §7.4 |

**Open items that do not block Phase 6:** manual feel check in real browsers (the leap, the Tank's weight, the scream); reference-machine measurement; Vercel preview not reachable from the container; no CI yet; body blocking of the player (deferred); brief enemy–enemy brush-throughs (bounded, accepted).

---

## Phase 4 acceptance review (plan §11)

Reviewed 2026-09-26 against the code on this branch, with the scope the project owner set for Phase 4 (the Walker and a reusable enemy foundation; no waves, no other archetypes, no final art).

| Plan §11 / Phase 4 requirement | Status | Evidence |
|---|---|---|
| Reusable enemy framework: health, movement speed, attack damage, attack range, detection range, attack cooldown, target, state | Done | `EnemyArchetypeConfig` (the plan's fields first), `Enemy`, `EnemyManager`; nothing generic names an archetype; config intent tests |
| AI states IDLE, PATROL, DETECT, CHASE, ATTACK, STAGGER, DEAD | Done | `EnemyStateMachine`: one table, all 49 pairs tested against an independent table, strict mode in dev and tests |
| No expensive logic every render frame; controlled update intervals | Done | Decisions at 10 Hz (`thinkInterval`, configurable), spread over the steps; exact timing every fixed step; measured 1–64 Walkers (decisions never pile up; ≤ 11 in any step at 64) |
| Walker: slow, durable, melee, detection and chase, no ranged attack | Done | `ENEMY_STATS.walker` + the melee brain; BALANCING §2.6 |
| Targeting: acquire, lose, distance, line of sight, attack range | Done | Perception tests (range, walls, memory, lose range, alerts, dead targets) |
| Movement: no walls or floors crossed, stable around obstacles, no teleport or jitter, frame-rate independent | Done | Capsule motor; 10 facility chases with penetration, step and floor checks; determinism and 30/60/144 Hz; turn rate; crowd; a hidden obstacle bypassed |
| Navigation fitted to the blockout | Done | Straight pursuit + authored route graph (every link walked by a body in tests); D-042 refines D-008 |
| Melee attack: range, damage, cooldown, wind-up, once per attack, not while dead or staggered, through the player's Health | Done | Melee brain tests (timing to the step, dodging, arc, walls, stagger/death cancel), integration (85/70/55 a cooldown apart) |
| Player health: max, damage, death once, game-over hook, no damage after death, reset each run | Done | `PlayerHealth` tests; integration; e2e (HUD, "You died", new run at 100) |
| Stagger from the Phase 3 event | Done | STAGGER cancels a wind-up, stops, recovers to attack / chase / idle |
| Combat registration like the dummies | Done | Same pipeline: headshot 65 + stagger, zones, 2 headshots / 5 body shots, dead bodies not hit, walls block |
| Placeholder presentation with readable hit zones and feedback | Done | `EnemyView` (skinned, zone colours, wind-up glow, hit flash, stagger, fall and sink), `HealthHud`; screenshots |
| Debug tools (dev only) | Done | `tls` enemy and player commands, `showAI()`, `showHitboxes()`, freeze, forced states; absent from `dist/` |
| Performance at 1, 4, 8, 16, 32, 64 Walkers | Done | Headless test + browser measurements (TESTING.md §7.4); draw calls fixed with evidence (272 → 144 at 64) |

**Open items that do not block Phase 5:** manual feel check in real browsers; reference-machine measurement; Vercel preview not reachable from the container; no CI yet; the player can walk through enemies (body blocking deferred).

---

## Phase 3 acceptance review (plan §10)

Reviewed 2026-09-26 against the code on this branch, with the scope the project owner set for Phase 3 (combat foundation; training dummies as temporary targets; no zombies).

| Plan §10 / Phase 3 requirement | Status | Evidence |
|---|---|---|
| Hitscan shooting, raycasting, hit detection | Done | Phase 2 `Hitscan` + Phase 3 rigs as a `HitscanTarget`; walls block, nearest wins, dead targets not hittable; unit, integration and e2e tests |
| Body-part system: HEAD, TORSO, ARM_LEFT, ARM_RIGHT, LEG_LEFT, LEG_RIGHT | Done | `HitboxShape` zones; `HUMANOID_RIG`; zone resolution tested for every zone, both sides, any facing |
| Configurable multipliers (head 2.5, torso 1.0, arms 0.65, legs 0.5) | Done | `DEFAULT_ZONE_MULTIPLIERS` + target overrides; HEAD via the weapon's headshot multiplier (D-041) |
| Damage system | Done | `computeDamage` (pure): falloff, zone, attacker, armor floor, resistance; 18 unit tests |
| Headshots, critical damage | Done | Crit = headshot, no random crits; distinct feedback |
| Hit reactions | Done (event); behaviour with the AI | `staggered` event over a 1 s window; dummies rock on hits, more on a stagger |
| Death | Done | `Health` (death once, ignored after death, revive); `killed` once + `onKilled` deactivation hook |
| Damage numbers / visual feedback | Done (placeholder) | `CombatFeedback` hit markers and pooled damage numbers; body sparks; dummy flash and fall |
| Weapon recoil, reloading | Done in Phase 2; still working | Regression: all Phase 2 tests; reload in combat (integration, e2e) |
| Ammo drops | Done (foundation) | Data-driven drop tables and pickups, seeded rolls, collection through `WeaponManager.addAmmo`; triggered by dummy deaths, ready for enemy deaths |
| Training dummies (owner's scope) | Done | Standard and zoned dummies; configurable health; same rig format as zombies; respawn; E2E in dev and prod |
| Performance measured | Done | TESTING.md §7.4: damage 0.05 µs, rig ray 0.22 µs, cast vs 24 dummies 3.5 µs; frame cost ~2–2.6 ms firing at 24 dummies; draw calls ~59 for 24 dummies after a measured fix |

**Open items that do not block Phase 4:** manual feel check in real browsers; reference-machine measurement; Vercel preview blocked by the container's network policy; no CI yet.

---

## Phase 2 acceptance review (plan §9)

Reviewed 2026-09-26 against the code on this branch, with the scope the project owner set for Phase 2 (Pistol only; loadout per D-039).

| Plan §9 / Phase 2 requirement | Status | Evidence |
|---|---|---|
| Reusable weapon architecture, no duplicated weapon logic | Done | One `Firearm` and one `MeleeWeapon` class driven by definitions; automatic fire, pellets and a Knife-like melee work as data (tests with test definitions) |
| Base properties: damage, fireRate, magazineSize, ammo, reloadTime, range, recoil, spread, headshotMultiplier | Done | `FirearmDefinition`; each tested (`Firearm.test.ts`, `gameplayConfig.test.ts`) |
| Interface: fire, reload, canFire, getAmmo, getState | Done | `Weapon` in `weapons/types.ts`, implemented by both classes |
| Pistol | Done | Semi-auto, 12 rounds, unlimited reserve, 1.3 s reload, spread, recoil, falloff; unit, integration and e2e tests |
| Assault Rifle, Shotgun | Deferred by scope (D-040) | Future Primary purchases (D-039); the framework supports them as data |
| Loadout: Melee / Primary / Secondary, equip, cycle, quickMelee, acquire, unlockSecondary | Done | `WeaponManager`; 42 unit tests; e2e with real keys, wheel and mouse |
| Hitscan against the level, clean hit data | Done | `Hitscan`; plain-data results; pluggable targets for enemies |
| Recoil through `PlayerLook`, data-driven, deterministic | Done | `PlayerLook` recoil methods; seeded `Rng`; tests |
| Input renamed; 1 / 2 / 3 / wheel / V | Done | `config/input.ts`, `WeaponController`; tests |
| Bare Hands placeholder | Done | `MeleeWeapon`; quick melee and held melee |
| Ammo / reload rules | Done | Reload timing, magazine, reserve, dry fire, auto reload, no firing mid-reload |

**Open items that do not block Phase 3:** manual feel check in real browsers; reference-machine measurement; Vercel preview blocked by the container's network policy; no CI yet.

---

## Phase 1 acceptance review (plan §8)

Reviewed 2026-09-25 against the code on this branch.

| Plan §8 feature | Status | Evidence |
|---|---|---|
| Forward / backward / strafe | Done | `PlayerMotor.test.ts` (direction per key and yaw, acceleration, braking, diagonal); `player.spec` WASD with real keys |
| Sprint | Done | 1.5×, forward only, not crouched; unit tests + `player.spec` |
| Crouch | Done | 0.5× speed, lower capsule and eyes (eased), headroom check; duct is crouch-only; unit tests + `player.spec` |
| Jump | Done | 1.15 m apex at any step size, coyote time, jump buffer, no repeat while held; unit tests + `player.spec` |
| Mouse look | Done | Per render frame via `Game.addFrameSystem`; `PlayerLook.test.ts`; real mouse in `player.spec` |
| Sensitivity | Done | `ENGINE_CONFIG.view.sensitivity`, runtime `tls.view`; tested 1× vs 2× |
| Vertical clamp | Done | ±89°; unit + e2e |
| FOV setting | Done | `ENGINE_CONFIG.view.fov` (60° vertical), runtime change tested |
| Head movement / subtle bob | Done | `HeadBob`: 3 cm at walking speed, only while moving on the ground; unit + e2e |
| Ground detection | Done | Downward probe with snap; ledges, ramps, stairs; unit tests |
| Basic environment collision | Done | Per-contact capsule resolution; walls, obstacles, ceilings, slopes; unit + e2e |
| No falling through the map | Done | Sub-steps (no tunnelling at 60 m/s or terminal fall), never below the floor in a 20 s random run, kill-plane respawn as a safety net; `respawns` stays 0 over the whole-map walks |

| Acceptance criterion | Met | How it is verified |
|---|---|---|
| The player can walk around the complete prototype map comfortably | Yes, automated. Comfort needs a human | Headless walk of `FACILITY_ROUTE` through the real loop; the same route with real keys in the browser (`player.spec`); manual checklist TESTING.md §6 |
| Movement is responsive and predictable | Yes, by measurement | Full speed in 0.1–0.15 s, stop in ~0.13 s, no drift, identical results at 30–240 Hz rendering |

**Open items that do not block Phase 2:**
- Manual feel check in real browsers and on real monitors (TESTING.md §6).
- Reference-machine performance measurement (needs the physical machine).
- The live Vercel preview is blocked by the container's network policy.
- No CI yet.

---

## Milestone roadmap

| Milestone (plan §34) | Phases | Definition of done | Status |
|---|---|---|---|
| **M1 Playable Prototype** | 0 Foundation · 1 FPS controller · 2 weapon framework (Pistol) · 3 basic combat · 4 zombie foundation (Walker) · basic 6 waves · minimal HUD, game over, restart | Player can enter a map, shoot zombies, survive waves, and die | Done in code with Phase 6 (a player can enter the map, shoot zombies, survive waves, die and restart); sign-off waits on the manual QA pass (TESTING.md §6) |
| **M2 Core Game** | 2 (3 weapons) · 3 (full combat) · 5 archetypes · 6 wave scaling · health, ammo, reload · basic UI, main/pause menus · settings persistence (part of 19) | Genuinely playable for 15–20 minutes | In progress: Phase 5 (archetypes and traits) and Phase 6 (waves: scaling, fair spawns, victory at 20, endless) done; 3 weapons, menus and settings persistence to come |
| **M3 Signature Mechanics** | 7 mutations · 8 adaptive system · 9 progression · 10 builds · 11 dynamic environment | Two runs can feel meaningfully different | In progress: Phase 7 (Signal Mutations) done |
| **M4 Content** | 12 signal progression · 13 boss (Siren) · more variants, mutations and upgrades · map pass | Complete loop and meaningful progression | Not started |
| **M5 Polish** | 16 audio · 17 VFX · lighting · UI polish · 18 performance · 21 stability · deployment | Feels like a finished indie browser game | Not started |

Testing (Phase 20) and save/settings (Phase 19) run throughout rather than as final steps.

## Documentation status (plan §36)

| Document | Status |
|---|---|
| `README.md` | Created |
| `IMPLEMENTATION_PLAN.md` | Committed verbatim |
| `ARCHITECTURE.md` | Created (proposed) |
| `GAME_DESIGN.md` | Created (baseline) |
| `PROGRESS.md` | Created |
| `DECISIONS.md` | Created |
| `TESTING.md` | Created (Phase 0.6), updated for each phase (Phase 5: archetype, trait, alarm and mixed-group coverage, mutations, manual QA, performance at 1–64 mixed; Phase 6: wave curves, generator properties, spawn fairness, runtime and full-loop wave coverage, planted bugs, manual QA, wave performance; Phase 7: mutation data, effect runtime, selection, lifecycle, full loop and tripwire, presentation E2E, planted bugs, manual QA, light and mutation performance) |
| `BALANCING.md` | Created (Phase 2): Pass-1 values for movement and weapons, change log; Phase 3 combat, drops and training dummies; Phase 4 Walker, player health, enemy rules; Phase 5 Runner, Tank, Screamer, traits, separation; Phase 6 waves (budget curve, concurrency, pacing, unlocks, caps, themes, traits, spawn rules); Phase 7 Signal Mutations (selection, the six mutations, overlays, floors, clamps, tripwire) |
