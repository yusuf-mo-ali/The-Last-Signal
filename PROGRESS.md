# Progress — THE LAST SIGNAL

> The working state of the project. Every session reads this file first and updates it last, so
> work can be resumed safely (plan §36).
>
> **Last updated:** 2026-09-26 · **Base branch:** `main` · **Working branch:** `claude/bold-mayer-n66vhb`
> (open PR into `main`: yusuf-mo-ali/The-Last-Signal#1)

---

## Current Phase

**Phase 1: First Person Foundation. Complete** (plan §8). The player can enter the blockout map and walk, strafe, sprint, crouch, jump and look around, colliding correctly with the level; see "Phase 1 acceptance review" below. Phase 2 (weapon framework) has not started and is awaiting approval.

- Phase 0 (Project Foundation) is complete: see "Phase 0 acceptance review".

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

## Active Task

None. Phase 1 is complete and O-2 is resolved; waiting for approval to start **Phase 2**.

## Known Bugs

None.

## Next Task

**Phase 2: Weapon Framework (plan §9).** Suggested steps, each a small commit:
1. **Weapon data and framework** (D-011): the `Weapon` interface and config for the Pistol (M1) from `src/config/weapons.ts`; fire modes, fire rate with fractional cooldown remainders (D-004), magazine and reload state machine, ammo. Weapon definitions declare their kind (firearm / melee) and the loadout categories they fit. Start `BALANCING.md`.
2. **Loadout** (D-039): `Loadout` with named Melee, Primary and Secondary categories; `WeaponManager` with `equip`, `cycle`, `quickMelee`, `acquire` and `unlockSecondary`; `STARTING_LOADOUT` = Bare Hands, Pistol, Secondary locked. Bare Hands as a basic melee placeholder (a short-range swing against the level; damage against enemies arrives with combat). No Knife, no Secondary weapons, no shop.
3. **Hitscan** against the level (`CollisionWorld.raycast`) with spread and a range; impact markers for debugging. Enemy hitbox rigs arrive with Phase 4 (D-007).
4. **Recoil and view kick** applied through `PlayerLook` (so aim and camera stay one source of truth), plus sprint lowering the weapon and firing cancelling sprint (GAME_DESIGN §4.2).
5. **Weapon view model** (blockout), fire/reload/switch input via the step `ActionMap`: `fire`, `aim`, `reload`, `equipPrimary` (1), `equipSecondary` (2, refused while locked), `equipMelee` (3), wheel cycling, quick `melee` (V). The `weapon1–3` actions are renamed accordingly.
6. **Verify:** unit tests (fire timing at any frame rate, reload, ammo, spread determinism with `Rng`, loadout rules: locked Secondary, melee always available, replacement), headless integration, e2e firing and switching with real mouse buttons and keys; `giveAmmo` / `setInfiniteAmmo` debug commands.

**Needed from you:**
- Approval to start Phase 2.
- Optionally, O-13 (Supply Terminal presentation, Secondary unlock condition). It is not needed for Phase 2; the defaults apply otherwise.
- Run the Phase 1 performance measurement on the reference machine (TESTING.md §7.2, Phase 1 scenario, `?quality=low`), and confirm the GTX 750's VRAM (1 GB or 2 GB).
- A manual QA pass of TESTING.md §6 in real browsers, especially the new "Movement and camera" section: feel can only be judged by hand.

**Deferred on purpose:**
- **From 0.2:** state-scoped timers and the `GameEvents` payload map arrive with the first system that needs them. The `EventBus` is implemented and tested but has no consumers yet.
- **From 0.4:**
  - A `beforeunload` confirmation during a run (with the run lifecycle).
  - Settings persistence for sensitivity, invert-Y, FOV and head bob (settings phase; the runtime `applyView` path already exists).
  - Replacing `LockPrompt` with the pause menu (UI phase).
- **From 0.5:**
  - Balance numbers in `src/config/` (each system's phase, logged in BALANCING.md).
  - Enemy counts and hitboxes in the overlay (Phases 4+).
  - The analytics interface (plan §30).
- **From 0.6:** CI (a GitHub Actions workflow running check, build and e2e on each PR) is recommended but not yet added.
- **From 1:**
  - Gravity as a `Stat` (D-006) arrives with the modifier system (Phase 7: LOW GRAVITY).
  - Level tags, spawn points, objective nodes, nav grid and light fixtures (D-013) arrive with the phases that use them.
  - A graphics settings menu, persistence and auto-detection (D-037 §8).
  - Small per-step allocations in the octree query and intent object (ARCHITECTURE §8): revisit only with profiling evidence.

## Blocked Tasks

Nothing is blocked now. These later tasks need decisions (full list in `DECISIONS.md` → Open questions):

| Task | Blocked on | Needed by |
|---|---|---|
| Supply Terminal presentation; Secondary unlock condition | O-13 | Phase 9 / Phase 14 |
| Technician upgrade | O-6 (no utility/trap system defined) | Phase 9 |
| Performance measurements on the weak reference (TESTING.md §7) | Access to the reference machine (i5-4440 / GTX 750); the container has no GPU. The Phase 1 map and `?quality=low` are ready | Now (Phase 1 baseline), then each phase |
| v1 zombie roster | O-3 | Phase 5 |
| v1 mutation set; intro waves without mutations | O-4, O-7 | Phase 7 |
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
| **M1 Playable Prototype** | 0 Foundation · 1 FPS controller · 2 weapon framework (Pistol) · 3 basic combat · 4 zombie foundation (Walker) · basic 6 waves · minimal HUD, game over, restart | Player can enter a map, shoot zombies, survive waves, and die | In progress: Phases 0–1 complete |
| **M2 Core Game** | 2 (3 weapons) · 3 (full combat) · 5 archetypes · 6 wave scaling · health, ammo, reload · basic UI, main/pause menus · settings persistence (part of 19) | Genuinely playable for 15–20 minutes | Not started |
| **M3 Signature Mechanics** | 7 mutations · 8 adaptive system · 9 progression · 10 builds · 11 dynamic environment | Two runs can feel meaningfully different | Not started |
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
| `TESTING.md` | Created (Phase 0.6), updated for Phase 1 |
| `BALANCING.md` | Planned for Phase 2, when the first tunable values exist in `src/config/` |
