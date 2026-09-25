# Decision Log — THE LAST SIGNAL

Architecture and design decisions, with their reasoning. New decisions are appended, never rewritten. To reverse a decision, add a new entry that supersedes the old one.

**Status values**
- **Accepted:** applies now.
- **Proposed:** the lead engineer's recommendation, applied by default until you confirm or override it.
- **Open:** needs your input before the phase named in "Needed by".
- **Superseded by D-xxx:** replaced by a later decision.

---

## Index

| ID | Title | Status |
|---|---|---|
| D-001 | Tech stack as specified by the plan | Accepted |
| D-002 | Toolchain, versions, package manager | Accepted |
| D-003 | Simulation / presentation separation with headless mode | Accepted |
| D-004 | Fixed-timestep simulation, per-frame mouse look | Accepted |
| D-005 | Hierarchical reading of the plan's state list | Proposed |
| D-006 | No physics engine: kinematic capsule + octree | Accepted |
| D-007 | Combat uses hitbox rigs, not render-mesh raycasts | Accepted |
| D-008 | Flow-field navigation on a nav grid | Accepted |
| D-009 | One data-driven modifier/trigger system | Accepted |
| D-010 | Engine config vs gameplay config | Accepted |
| D-011 | One weapon framework, weapons as data | Accepted |
| D-012 | Enemy = archetype + modifiers | Accepted |
| D-013 | Level defined as data | Accepted |
| D-014 | Seeded, injected RNG | Accepted |
| D-015 | EventBus usage rules | Accepted |
| D-016 | Disposable RunSession per run | Accepted |
| D-017 | Input handling and browser shortcut constraints | Accepted |
| D-018 | DOM UI without a framework | Accepted |
| D-019 | Versioned save format without a schema library | Accepted |
| D-020 | Debug tooling excluded from production | Accepted |
| D-021 | Test tooling: Vitest now, Playwright when needed | Accepted |
| D-022 | Lighting: fixed light count, shader pre-warm | Accepted |
| D-023 | Additions to the plan's folder tree | Accepted |
| D-024 | Mutation selection vs mutation application | Accepted |
| D-025 | IMPLEMENTATION_PLAN.md committed verbatim | Accepted |
| D-026 | Adaptive system guardrails | Proposed |
| D-027 | Erasable TypeScript syntax only (no `enum`) | Accepted |
| D-028 | Layering of world changes | Accepted |
| D-029 | Player can only be damaged during WAVE_ACTIVE / BOSS | Proposed |
| D-030 | Blockout-first visuals, swappable art | Accepted |
| D-031 | Phase 0.1 tooling configuration details | Accepted |
| D-032 | Phase 0.2 core primitive semantics | Accepted |
| D-033 | Render foundation and loop wiring | Accepted |
| O-1 … O-12 | Open questions (see the end of this file) | Open |

---

## D-001 — Tech stack as specified by the plan
**Status:** Accepted · **Date:** 2026-09-25

**Decision.** Three.js with `WebGLRenderer` (WebGL2), TypeScript in strict mode, Vite, DOM UI, the Web Audio API, and Vercel static hosting (plan §4).

**Notes.**
- three.js also ships a `WebGPURenderer`. We stay on WebGL2 because:
  - the plan names WebGL;
  - WebGL2 runs on every target browser;
  - the post-processing ecosystem is mature.
- WebGPU can be revisited after v1 with a measurable reason (plan §39, rule 7).

## D-002 — Toolchain, versions, package manager
**Status:** Accepted · **Date:** 2026-09-25

**Context.** Versions checked against the npm registry on 2026-09-25.
- npm's `latest` tag for `typescript` is **7.0.2**, the native-compiler release.
- `typescript-eslint@8.70.1`, which provides type-aware linting, declares the peer range `typescript >=4.8.4 <6.1.0`.
- So a plain `npm install typescript` would pull a version the linter does not support.

**Decision.**
- **npm** as package manager; it ships with Node, needs no setup and is Vercel's default.
- **Node 22 LTS**, pinned via `.nvmrc` and `engines`. The container has 22.22.2, which meets Vite 8 (`>=22.12`), Vitest 5 (`^22.12`) and ESLint 10 (`^22.13`).
- **TypeScript pinned to `6.0.3`** (the latest 6.0.x).
- Other versions are recorded exactly by the lockfile in Phase 0:

| Package | Version at planning time |
|---|---|
| three | 0.186.1 |
| @types/three | 0.186.0 |
| vite | 8.3.1 |
| vitest | 5.0.2 |
| eslint / @eslint/js | 10.11.0 / 10.0.1 |
| typescript-eslint | 8.70.1 |
| prettier | 3.9.9 |
| eslint-config-prettier | 10.1.8 |

**Revisit** TypeScript 7 when typescript-eslint supports it.

## D-003 — Simulation / presentation separation with headless mode
**Status:** Accepted · **Date:** 2026-09-25

**Context.** Plan §27 requires integration tests for shooting a zombie, killing it, completing a wave, choosing an upgrade, spawning a boss, game over and restart. In a browser with WebGL those tests would be slow and flaky.

**Decision.**
- Game logic is pure TypeScript that may use `three` math classes but no renderer, DOM or audio.
- Presentation (meshes, UI, audio, VFX) reads the simulation state and listens to its events.
- `new Game({ headless: true })` runs the full simulation in Node.

**Consequences.**
- Needs a thin view/sync layer (`*View.ts`) and discipline, enforced by lint rules (ARCHITECTURE §2).
- In return: deterministic tests, clean restarts, and a simulation that can be profiled on its own.

## D-004 — Fixed-timestep simulation, per-frame mouse look
**Status:** Accepted · **Date:** 2026-09-25

**Decision.**
- The simulation steps at 60 Hz with an accumulator: at most 5 steps per frame, frame delta clamped to 0.25 s.
- Rendering interpolates between steps.
- Mouse look is applied every render frame.
- Weapon cooldowns keep fractional remainders.

**Why.**
- Frame-rate-independent, testable logic.
- No added input latency on aim, which matters most for feel (plan §41).
- Robust against tab switches and hitches.

## D-005 — Hierarchical reading of the plan's state list
**Status:** Proposed · **Date:** 2026-09-25

**Context.** Plan §6 lists 12 states as a flat list. Three of them overlap if read flat:
- `PLAYING` covers the wave states.
- `PAUSED` has to remember which state to return to.
- `BOSS` is a wave whose `bossFlag` is true (§13).

A flat machine would bring back hidden flags (such as "state before pause"), which the plan forbids.

**Decision.**
- Keep all 12 IDs exactly as written.
- `PLAYING` is a parent state whose children are `WAVE_START, WAVE_ACTIVE, WAVE_COMPLETE, UPGRADE_SELECTION, BOSS`.
- `PAUSED` is a push-down state that restores the previous child.
- All transitions are declared in one table; anything else is rejected (ARCHITECTURE §4).

**Alternative.** `PLAYING` could instead be a separate "free roam before wave 1" state. Rejected: `WAVE_START` already provides a pre-wave window.

## D-006 — No physics engine: kinematic capsule + octree
**Status:** Accepted · **Date:** 2026-09-25

**Decision.**
- **Player:** a kinematic capsule against the static level, using the `Octree` and `Capsule` classes from `three/addons`. These ship inside `three`, so there is no new dependency.
- **Enemies:** they move on the nav grid and push each other apart through a spatial hash, so they need no rigid-body physics.
- **Gravity** is a `Stat`.

**Why.** Plan §4 says not to add a heavy engine unless gameplay needs one, and nothing in scope needs rigid-body dynamics.

**Upgrade path.** `three-mesh-bvh`, if octree queries profile as a bottleneck. A physics engine only if a later feature truly needs dynamics.

## D-007 — Combat uses hitbox rigs, not render-mesh raycasts
**Status:** Accepted · **Date:** 2026-09-25

**Decision.**
- Each enemy has analytic hitboxes (spheres/capsules) for the six damage zones.
- The hitboxes are placed in the simulation, with a few pose presets per AI state.
- Hitscan tests those hitboxes and never the skinned render mesh.

**Why.**
- Raycasting skinned meshes is expensive and needs the animated pose, which the headless simulation does not have.
- Analytic hitboxes are cheap, deterministic, and map directly to the damage zones in plan §10.

**Cost.**
- Hitboxes and animation can drift apart visually.
- Mitigations: generous head hitboxes, pose presets matched to animation states, and a debug hitbox view.

## D-008 — Flow-field navigation on a nav grid
**Status:** Accepted · **Date:** 2026-09-25

**Decision.**
- One Dijkstra flow field from the player's cell serves every zombie. It is recomputed when the player changes cell, at most every ~250 ms.
- A second field includes climb links and is used by Climbers.

**Why.**
- Pathfinding cost does not grow with enemy count. That meets plan §25 ("no expensive pathfinding every frame for every enemy") and the high-enemy-count target.

**Fallback.** `recast-navigation` (a WASM navmesh) behind the same `NavigationService` interface, if the map outgrows grids.

## D-009 — One data-driven modifier/trigger system
**Status:** Accepted · **Date:** 2026-09-25

**Decision.**
- Upgrades, mutations, difficulty scaling, enemy modifiers and adaptive responses are all data made from five effect kinds: `stat` (add/mul/override, tagged by source), `trigger` (event → named action), `spawnRule`, `environment` and `screen`.
- Effects are applied, and removed by source id, through one system.

**Why.**
- Plan §14 requires data-driven mutations, and §17 requires builds that emerge from combinations.
- Without this, each feature would invent its own "temporary stat change" code, and cleaning up after a mutation would be error-prone.

## D-010 — Engine config vs gameplay config
**Status:** Accepted · **Date:** 2026-09-25

**Decision.**
- `src/core/Config.ts` holds engine and app settings: timestep, DPR cap, debug flags.
- `src/config/*.ts` holds all tunable gameplay data (plan §31): weapons, enemies, waves, mutations, upgrades, bosses, adaptation, economy, signal, input defaults.
- Config files are typed with `satisfies` so bad data fails to compile.

**Why.** The plan names both places. Separating them keeps balance data free of engine details, and makes balancing possible without touching logic.

## D-011 — One weapon framework, weapons as data
**Status:** Accepted · **Date:** 2026-09-25

**Decision.**
- One `Weapon` class built from composable parts (fire mode, shot pattern, recoil, ammo model) and driven by config.
- Pistol, Assault Rifle and Shotgun are config entries.
- The plan's interface (`fire, reload, canFire, getAmmo, getState`) is kept.

**Why.**
- Plan §9 says not to duplicate weapon logic, and all weapons must share one framework.
- Composition achieves that better than one subclass per weapon, and new weapons need no new code.

## D-012 — Enemy = archetype + modifiers
**Status:** Accepted · **Date:** 2026-09-25

**Decision.**
- Archetypes: Walker, Runner, Tank, Screamer, Climber.
- Modifiers overlay any archetype: Armored, Helmeted, Elite.

**Why.** The plan's adaptive responses need "armored" and "protected-head" enemies (§15), and BLOOD MOON needs "elite" enemies (§14), but none are defined as archetypes. Modifiers supply all three without multiplying archetypes.

## D-013 — Level defined as data
**Status:** Accepted · **Date:** 2026-09-25

**Decision.**
- The facility is typed TypeScript data: primitives, tags, spawn points, objective nodes, lights, doors and routes.
- That data generates render meshes, the collision octree, the nav grid and the spawn tables.

**Why.**
- One source of truth, so collision, navigation and visuals cannot drift apart.
- An AI-assisted workflow can edit and review it as text.
- Art can later replace the visuals without touching gameplay geometry.

## D-014 — Seeded, injected RNG
**Status:** Accepted · **Date:** 2026-09-25

**Decision.**
- All gameplay randomness comes from an injected, seeded PRNG: waves, upgrade offers, mutation choice, spread, drops.
- `Math.random()` is only allowed for purely cosmetic effects in presentation code.

**Why.**
- Deterministic unit and integration tests.
- Reproducible bug reports ("seed 1234, wave 7").
- Enables a future daily challenge (a nice-to-have).

## D-015 — EventBus usage rules
**Status:** Accepted · **Date:** 2026-09-25

**Decision.** The event bus is typed, dispatches synchronously, and queues events raised during a dispatch. Use it for **notifications**, where one producer has many unrelated listeners. Use direct calls for **commands** and owned dependencies. Listeners must not keep references to event payloads.

**Why.** Event buses in games tend to become untraceable spaghetti. Limiting the bus to notifications keeps control flow readable.

## D-016 — Disposable RunSession per run
**Status:** Accepted · **Date:** 2026-09-25

**Decision.**
- All per-run state lives in a `RunSession`, created on `LOADING → PLAYING` and disposed on restart, quit, game over or victory.
- Persistent services, pools and GPU resources belong to `Game`.

**Why.** Restart becomes "throw it away and build a new one", with no reset logic to forget. This directly covers plan §28 ("restart while paused") and the plan's goal that restarting a run is quick.

## D-017 — Input handling and browser shortcut constraints
**Status:** Accepted · **Date:** 2026-09-25

**Context.** Several browser realities affect the plan's control scheme (§3).

**Decision.**
1. Keys are read by `KeyboardEvent.code` (physical position), which works on any keyboard layout.
2. **Crouch defaults to `C`.** `Ctrl` is an opt-in rebind. Pages cannot intercept `Ctrl+W`, so crouch-walking forward with Ctrl closes the tab in Chrome, Edge and Firefox. The plan's "C / Ctrl" is kept as a supported, rebindable option.
3. **Pause is driven by `pointerlockchange`** (lock lost), not by Esc keydown. The browser uses that Esc press to release the lock.
4. **Re-locking the pointer** happens only inside a user-gesture handler and handles rejection. Chromium rejects re-lock requests made shortly after the user exits with Esc, so the UI shows "Click to resume".
5. **Raw mouse input** uses `requestPointerLock({ unadjustedMovement: true })` where supported (Chromium), falling back to the default elsewhere. Implausible `movementX/Y` spikes are clamped.
6. The context menu is suppressed on the game canvas. Page scrolling from Space and arrow keys is prevented. Mouse side buttons are neutralised during play. A `beforeunload` confirmation shows during a run.

**Consequences.** Plan §3's control list is unchanged; only the default for one binding differs.

## D-018 — DOM UI without a framework
**Status:** Accepted · **Date:** 2026-09-25

**Decision.**
- Plain HTML/CSS and TypeScript classes per screen, managed by `UIManager`.
- HUD values update from events and are written only when they change.
- DOM nodes are pooled for damage numbers and the kill feed.

**Why.** Plan §4 says to use DOM UI. A framework would add weight and a second rendering model for a small number of screens.

## D-019 — Versioned save format without a schema library
**Status:** Accepted · **Date:** 2026-09-25

**Decision.**
- Two `localStorage` documents, `settings` and `profile`, each shaped `{ saveVersion, data }`.
- Loading runs: parse, then step-by-step migrations, then hand-written validation guards, then merge with defaults.
- Corrupt data is backed up and replaced by defaults, never thrown.
- All storage access is wrapped in try/catch.

**Why.**
- Plan §26 requires versioning and future migrations.
- The schema is small, so a validation library (e.g. zod) is not justified yet (plan: "do not install unnecessary dependencies").

## D-020 — Debug tooling excluded from production
**Status:** Accepted · **Date:** 2026-09-25

**Decision.**
- `src/debug/` is loaded with a dynamic import guarded by `import.meta.env.DEV`, so it is excluded from production bundles.
- It provides the plan §29 commands on `window.tls` and a debug overlay.
- The overlay covers FPS and frame time, draw calls, enemy count, current state and hitboxes.
- If a debug GUI panel is needed, the copy of `lil-gui` that ships inside `three/addons` is used, so no extra dependency is added.

## D-021 — Test tooling: Vitest now, Playwright when needed
**Status:** Accepted · **Date:** 2026-09-25

**Decision.**
- **Vitest** for unit and headless integration tests. It shares Vite's config and transforms.
- **Playwright** for smoke tests (loads, no console errors, renders), added when the first rendering smoke test is written. The container already has Chromium.
- Headless Chromium may need SwiftShader flags for WebGL; to be verified when added.

## D-022 — Lighting: fixed light count, shader pre-warm
**Status:** Accepted · **Date:** 2026-09-25

**Context.** In three.js, a material's shader program depends on how many lights of each type are in the scene. Adding, removing or hiding a light (`visible = false`) forces shaders to recompile, which causes a visible hitch. BLACKOUT, POWER_FAILURE and alarms all toggle lights.

**Decision.**
- Every light in the level exists from load time, and states change only `intensity` and `color`.
- At most 2 shadow-casting lights.
- Shaders are pre-warmed during `LOADING` with `renderer.compile`/`compileAsync`.

## D-023 — Additions to the plan's folder tree
**Status:** Accepted · **Date:** 2026-09-25

**Decision.** The plan's tree (§5) is kept. The following are added, each to host a requirement the plan states elsewhere:

| Addition | Hosts |
|---|---|
| `config/` | Gameplay data (§31); the plan names it but its §5 tree omits it |
| `input/` | Input manager (§7 Phase 0) |
| `render/` | Renderer, resize, DPR, post-processing (§7) |
| `assets/` | Asset loading with graceful missing-asset fallback (§28) |
| `physics/` | Collision (§8); also no engine per D-006 |
| `navigation/` | Pathfinding and AI movement (§11, §25) |
| `modifiers/` | Shared stat/trigger system (D-009) |
| `adaptive/` | Player behaviour profile and adaptation (§15), the signature mechanic |
| `debug/` | Debug tools (§29) |
| `analytics/` | Analytics interface (§30) |
| `utils/` | Pools (§25), seeded RNG (D-014), math helpers |
| `core/RunSession.ts`, `core/ErrorHandler.ts` | D-016; basic error handling (§7) |
| `weapons/melee/`, `enemies/modifiers/`, `world/levels/`, `world/PickupManager.ts`, `save/migrations/` | Melee (§16/§17), modifiers (D-012), level data (D-013), ammo drops (§10), migrations (§26) |
| `ui/UIManager.ts`, `SettingsMenu.ts`, `LoadingScreen.ts`, `VictoryScreen.ts` | Screen flow; persistent settings (§2); the `LOADING` and `VICTORY` states (§6) |

## D-024 — Mutation selection vs mutation application
**Status:** Accepted · **Date:** 2026-09-25

**Context.** The plan has both `waves/WaveMutation.ts` and `signal/SignalMutationSystem.ts`, with overlapping names.

**Decision.**
- `WaveMutation` **selects** a mutation ID for a wave: pure, weighted, tier-gated, never the same twice in a row. `WaveGenerator` calls it.
- `SignalMutationSystem` **applies** the selected mutation's effects at wave start and removes them at wave end, through D-009.
- Neither contains per-mutation logic; mutations are data in `config/mutations.ts`.

## D-025 — IMPLEMENTATION_PLAN.md committed verbatim
**Status:** Accepted · **Date:** 2026-09-25

**Context.**
- The plan was supplied as an upload and must be kept in the repo (plan §36).
- It uses CRLF line endings and escaped Markdown (`\#`, `\*`, `&#x20;`), apparently from an editor export.
- On GitHub its headings render as literal `#` text.

**Decision.**
- Commit it byte-for-byte (SHA-256 `48c08705…d4686`); no content or formatting changes.
- The formatting is cosmetic and does not meet the "critical technical issue" bar for editing the plan.

**Follow-up.** Normalising the Markdown formatting, with no content changes, is offered as a separate, optional step.

## D-026 — Adaptive system guardrails
**Status:** Proposed · **Date:** 2026-09-25

**Decision.** Plan §15 requires thresholds and cooldowns, and adaptation that feels natural rather than punishing. The adaptive system therefore:
- evaluates only at `WAVE_COMPLETE`;
- requires minimum evidence;
- uses hysteresis and per-rule cooldowns;
- caps each multiplier, with at most 2 active adaptations;
- **changes which enemies appear, never the total threat budget**;
- lets responses fade when behaviour changes;
- does not start before wave 5;
- **tells the player** after each wave what adapted (GAME_DESIGN §10).

**Why tell the player.** An invisible adaptive system looks like randomness, and unexplained counters feel like punishment. The plan's stated goal is that the player notices the game reacted.

## D-027 — Erasable TypeScript syntax only (no `enum`)
**Status:** Accepted · **Date:** 2026-09-25

**Decision.**
- Use `as const` objects with union types instead of `enum` or `namespace`.
- Enable `verbatimModuleSyntax`, `isolatedModules` and `erasableSyntaxOnly`.

**Why.**
- Vite transpiles each file in isolation, and erasable-only syntax guarantees that works.
- It is forward-compatible with TypeScript 7 and Node's native type stripping.
- It gives smaller output.

## D-028 — Layering of world changes
**Status:** Accepted · **Date:** 2026-09-25

**Context.**
- Signal progression ("restore power"), environment states (`POWER_FAILURE`, `EMERGENCY_LIGHTING`) and the BLACKOUT mutation all change the lights.
- Without an order of authority they would fight each other.

**Decision.**
- `SignalProgression` sets the **base** `EnvironmentState`.
- `DynamicEvents` and the wave's mutation add temporary **overlays** with priorities.
- `LightingController` and the other environment consumers resolve the final state as base plus overlays.

## D-029 — Player can only be damaged during WAVE_ACTIVE / BOSS
**Status:** Proposed · **Date:** 2026-09-25

**Decision.** Damage to the player is ignored outside `WAVE_ACTIVE` and `BOSS`. `GAME_OVER` can still be entered from any `PLAYING` child for robustness.

**Why.** It rules out dying on the upgrade screen or during the wave-complete transition (plan §28) by design, rather than by special-casing each path.

## D-030 — Blockout-first visuals, swappable art
**Status:** Accepted · **Date:** 2026-09-25

**Decision.**
- Milestones 1–2 use primitive blockout geometry and simple materials, and procedural or placeholder sounds.
- The asset pipeline is prepared in these milestones: glTF models, and later compressed textures and meshes.
- `AssetManager` supplies a placeholder for any missing asset (plan §28).

**Why.**
- Gameplay feel and systems come before visual polish (plan §41).
- The asset source is still open (O-8).

## D-031 — Phase 0.1 tooling configuration details
**Status:** Accepted · **Date:** 2026-09-25

**Decision.**
- **Versions:** `three` and `@types/three` are pinned exactly, because the type package must match the runtime. `typescript` is pinned to `6.0.3` (D-002). Other dev tools use caret ranges, and `package-lock.json` locks everything; installs use `npm ci`.
- **ESLint:** `typescript-eslint` `strictTypeChecked` + `stylisticTypeChecked` with the project service, and `eslint-config-prettier` last. The simulation layer rule (D-003) is two ESLint rules scoped to simulation folders: `no-restricted-imports` and `no-restricted-globals`.
- **Prettier** formats code and config only. `*.md` is excluded:
  - the documentation is hand-maintained;
  - `IMPLEMENTATION_PLAN.md` must stay byte-identical (D-025).
  `.editorconfig` also leaves the plan's CRLF line endings alone.
- **No `@types/node`.** Nothing in `src/`, `tests/` or `vite.config.ts` uses Node APIs yet, and `skipLibCheck` covers the Node types referenced inside Vite's own declarations. Add it only when code actually needs Node APIs.
- **The first test verifies the headless assumption.** It checks that `three` math and the `Octree`/`Capsule` add-ons work in Node against an octree built from raw triangles. This backs D-003 and D-006 before any system depends on them.
- **`npm run check`** runs typecheck, lint, format check and tests. It is the gate before every commit.


## D-032 — Phase 0.2 core primitive semantics
**Status:** Accepted · **Date:** 2026-09-25

Refines D-004, D-005, D-014 and D-015 with the behaviour the code and tests now pin down.

**Game state machine (`src/core/GameState.ts`).**
- Two transitions are added to the ARCHITECTURE §4 diagram:
  - `LOADING → MAIN_MENU`, so a failed or cancelled load has somewhere to go.
  - `VICTORY` is reachable only from `WAVE_COMPLETE`, not from any run phase.
- Pausing *suspends* the run phase: no exit or enter hooks fire for it on pause or resume. Restart or quit from `PAUSED` exits `PAUSED`, then the suspended phase, then `PLAYING`.
- `transition()` is strict and returns `false` for illegal requests. `strict: true` throws `InvalidTransitionError` instead. `pause()`/`resume()` are idempotent no-ops when they don't apply, because platform events such as blur and pointer-lock loss arrive in bursts.
- Transitions requested from hooks are queued. A queued request that has become illegal by the time it runs is rejected like any other.
- Hook errors are collected and rethrown after the transition completes (or sent to `onListenerError`), so the machine is never left half-transitioned. The event bus handles listener errors the same way.

**Clock (`src/core/Time.ts`).**
- The clock never reads the wall clock; the caller passes frame time.
- Invalid frame times count as 0.
- When a frame owes more than `maxStepsPerFrame` steps, the backlog is dropped and counted in `droppedTime`. A frame that owes exactly the maximum drops nothing.
- `simTime` is `stepCount × fixedDt`, so it never drifts.

**Rng (`src/utils/Rng.ts`).**
- sfc32, seeded through splitmix32 with 12 warm-up rounds. String seeds are hashed with 32-bit FNV-1a.
- The tests compare the output against an independently written sfc32 reference and published FNV-1a vectors, plus fixed golden values. That comparison caught a counter-ordering slip during development.

**Pool (`src/utils/Pool.ts`).**
- Objects are reset on *release*, so idle objects are always clean.
- Double release and foreign release throw.
- Idle objects over `maxFree` and objects removed by `clear()` go to `dispose`.


## D-033 — Render foundation and loop wiring
**Status:** Accepted · **Date:** 2026-09-25

Refines D-001, D-003, D-004 and D-022 for Phase 0.3.

**Decision.**
- **Injected loop dependencies.** `core/Game` stays browser-free:
  - The frame source is an injected `FrameScheduler`: `requestAnimationFrame` in `main.ts`, a manual queue in tests.
  - Drawing is an optional injected `Presentation`.
  - This implements D-003's headless mode *without* a `headless` flag: a game with no presentation is headless.
- **`main.ts` is the only composition root.** It is the one file that wires browser APIs (rAF, DOM, WebGL) into the game.
- **Resizing** (`render/Renderer`):
  - A `ResizeObserver` on the container catches layout and window changes.
  - A `matchMedia('(resolution: …dppx)')` listener, re-armed after each change, catches zoom and monitor moves.
  - Both only mark the renderer dirty. The new size is applied at most once per frame, at the start of `render`.
  - The drawing buffer is `floor(css × min(dpr, 2) × renderScale)`, computed by the pure, unit-tested `render/viewport.ts`.
  - A 0 × 0 container skips drawing instead of erroring.
  - The canvas is sized by CSS; `setSize(..., false)` only changes the buffer.
- **Camera defaults** (`render/camera.ts`): 60° vertical FOV (about 90° horizontal at 16:9, wider on ultrawide), near 0.05 m, far 500 m. The renderer keeps the aspect ratio in sync.
- **Look:**
  - ACES filmic tone mapping.
  - Shadow map on, with three's default filter; setting a deprecated shadow type would log a warning.
  - Shaders compiled with `renderer.compile` before the first frame (D-022).
- **Test scene** (`world/TestScene` + `world/TestSceneView`): a fixed-step beacon drawn with interpolation. It shows the sim/`*View` split the real world will use, and is removed when the Phase 1 map arrives.
- **Build chunks:**
  - three.js is split into its own chunk via Rolldown `codeSplitting` groups, for long-term caching.
  - `chunkSizeWarningLimit` is 600 kB, because three's core (~531 kB minified, ~132 kB gzip) can't shrink below the 500 kB default. The warning stays meaningful for every other chunk.
- **Dev inspection handle.** `window.__TLS_DEV__ = { game, renderer, testScene }`, only when `import.meta.env.DEV`. The production bundle is checked to be free of it. The debug tools replace it in Phase 0.5.

**Why.**
- Keeps the simulation testable and profile-able in Node.
- Handles every real-world cause of canvas-size change without resize thrash.
- Avoids first-frame shader hitches.

---

## Open questions

None of these block Phase 0. Each lists the phase that needs the answer and the default that applies if there is no answer.

| ID | Question | Needed by | Recommendation (default) |
|---|---|---|---|
| **O-1** | What do XP and Scrap buy? The plan says "persistent purchases" and "unlocks progression" but defines no screen or items. | Phase 9 (Progression) | XP → profile level that unlocks new cards and weapons; Scrap → between-run "Workshop" of small permanent perks (adds one menu screen) |
| **O-2** | How does the player get the Assault Rifle and Shotgun during a run? | Phase 2 end (Weapons) | Start with the Pistol; weapon cards offered on the upgrade screens after waves 2 and 4 |
| **O-3** | Which 4 of the 5 archetypes ship in v1 (plan §12 lists 5, §42 targets 4)? | Phase 5 (Archetypes) | Walker, Runner, Tank, Screamer; defer Climber (most expensive: climb navigation and animation) |
| **O-4** | Which 6 of the 8 mutations ship in v1? | Phase 7 (Mutations) | BLACKOUT, HUNGER, STATIC, SCREAM, HIVE, BLOOD MOON; defer LOW GRAVITY and OVERLOAD |
| **O-5** | Boss placement, and what "unlimited waves" means next to a wave-20 victory. | Phase 6 / Phase 13 | Siren at wave 20 (final); the generator supports unlimited waves; endless mode after victory is a later nice-to-have |
| **O-6** | The controls lack **melee** and **interact**, and no **utility/trap** system exists, yet Heavy Hands, Technician, `meleeUsage` and signal objectives depend on them. | Phase 2 (melee), Phase 12 (interact) | Add Melee = V and Interact = E. Keep Technician out of the pool until a utility item is designed |
| **O-7** | "Every normal wave receives one mutation" (§14) vs "mutations become noticeable at 10–15 min" (§33). | Phase 7 | Waves 1–3 mutation-free; waves 4–19 one each; wave 20 boss rules |
| **O-8** | Where do the 3D models, animations, sounds and music come from, and under what licences? | Milestone 2 (first real assets) | CC0 sources (e.g. Kenney, Quaternius, CC0 sound libraries), with a CREDITS file; blockout until then (D-030) |
| **O-9** | What is the reference "weaker supported hardware" for the 30 FPS floor? | Phase 1 (first perf baseline) | A mid-range laptop with integrated graphics (Intel Iris Xe class) at 1366×768 as the floor |
| **O-10** | Does BLACKOUT need a player flashlight? | Phase 7 | Yes, as a simple toggle (F) using one of the ≤2 shadow-casting light slots, if playtests show BLACKOUT is frustrating |
| **O-11** | Project licence (code) and asset licence policy. | Before any public release | Decide before the first public deployment |
| **O-12** | Are signal objectives mandatory to progress, or optional but rewarded? | Phase 12 | Optional but rewarded: the phase advances with wave number; objectives add signal strength and rewards (no soft-locks) |
