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
| D-008 | Flow-field navigation on a nav grid | Accepted (for hordes; the blockout's navigation is D-042) |
| D-009 | One data-driven modifier/trigger system | Accepted |
| D-010 | Engine config vs gameplay config | Accepted |
| D-011 | One weapon framework, weapons as data | Accepted (loadout by D-039) |
| D-012 | Enemy = archetype + modifiers | Accepted (implemented by D-042, D-043) |
| D-013 | Level defined as data | Accepted |
| D-014 | Seeded, injected RNG | Accepted |
| D-015 | EventBus usage rules | Accepted |
| D-016 | Disposable RunSession per run | Accepted |
| D-017 | Input handling and browser shortcut constraints | Accepted |
| D-018 | DOM UI without a framework | Accepted |
| D-019 | Versioned save format without a schema library | Accepted |
| D-020 | Debug tooling excluded from production | Accepted |
| D-021 | Test tooling: Vitest now, Playwright when needed | Accepted |
| D-022 | Lighting: fixed light count, shader pre-warm | Accepted (shadow budget refined by D-037) |
| D-023 | Additions to the plan's folder tree | Accepted |
| D-024 | Mutation selection vs mutation application | Accepted |
| D-025 | IMPLEMENTATION_PLAN.md committed verbatim | Accepted |
| D-026 | Adaptive system guardrails | Proposed |
| D-027 | Erasable TypeScript syntax only (no `enum`) | Accepted |
| D-028 | Layering of world changes | Accepted |
| D-029 | Player can only be damaged during WAVE_ACTIVE / BOSS | Proposed (implemented by D-042) |
| D-030 | Blockout-first visuals, swappable art | Accepted |
| D-031 | Phase 0.1 tooling configuration details | Accepted |
| D-032 | Phase 0.2 core primitive semantics | Accepted |
| D-033 | Render foundation and loop wiring | Accepted |
| D-034 | Input architecture: readers, injection, pointer-lock flow | Accepted |
| D-035 | Engine config, debug tooling, error and context-loss handling | Accepted |
| D-036 | End-to-end harness and Phase 0 verification conventions | Accepted |
| D-037 | Performance targets, reference hardware and graphics quality scaling (resolves O-9) | Accepted |
| D-038 | Phase 1 first-person foundation: movement model, collision, look, blockout, run entry | Accepted |
| D-039 | Loadout of Melee, Primary and Secondary; weapons bought with Scrap at the Supply Terminal (resolves O-2) | Accepted |
| D-040 | Phase 2 weapon framework: timing, trigger, reload, hitscan, recoil, melee placeholder, events | Accepted |
| D-041 | Phase 3 combat: hitbox rigs, pure damage, reusable Health, one-time death, feedback, drops, training dummies | Accepted |
| D-042 | Phase 4 zombie foundation: generic enemy framework, the Walker, AI state machine, limited-rate decisions, route-graph navigation, melee, player health | Accepted |
| D-043 | Phase 5 archetypes: the v1 roster (resolves O-3), the Runner, the Tank and the Screamer, composable traits, and a generic alarm event | Accepted |
| D-044 | Phase 6 wave system: budget curve, seeded composition, fair spawn points, the wave cycle and slots for mutations, bosses and adaptation | Accepted |
| D-045 | Phase 7 Signal Mutations: six v1 mutations as data, one effect runtime, DEATH CRY kept apart from the Screamer, and guardrails | Accepted |
| O-1 … O-13 | Open questions (see the end of this file) | Open (O-9 resolved by D-037, O-2 by D-039; O-1 and O-6 partly answered by D-039) |

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
- How the player carries weapons (Melee, Primary, Secondary) is decided in D-039.

**Why.**
- Plan §9 says not to duplicate weapon logic, and all weapons must share one framework.
- Composition achieves that better than one subclass per weapon, and new weapons need no new code.

## D-012 — Enemy = archetype + modifiers
**Status:** Accepted · **Date:** 2026-09-25

**Decision.**
- Archetypes: Walker, Runner, Tank, Screamer, Climber. (The v1 roster is the first four; the Climber is deferred as adaptive content: D-043.)
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


## D-034 — Input architecture: readers, injection, pointer-lock flow
**Status:** Accepted · **Date:** 2026-09-25

Implements D-017 for Phase 0.4.

**Context.**
- The simulation runs at a fixed 60 Hz; render frames run at the display rate.
- If "pressed this frame" were cleared every render frame, a key tapped during a frame that runs no fixed step would never reach the simulation. On a 240 Hz display that is about 3 of every 4 taps.
- If the edges were instead cleared per step, the UI would see stale presses while the game is frozen.

**Decision.**
- **`InputState` keeps held state plus running totals** (presses, releases, mouse motion, wheel notches) that only ever grow.
- **Consumers read through their own `InputReader`.** `sample()` opens a new window; the queries describe what happened between the last two samples.
  - The **step reader** is sampled first in every fixed step (`attachStepInput`, via the new `Game.prependSystem`). A tap reaches exactly one step: never lost, never repeated across several steps.
  - The **frame reader** is sampled at the start of each render frame. Its mouse delta is the per-frame accumulation, and it resets predictably at the next sample.
  - `discard()` drops everything so far. The step reader discards when the game leaves `PAUSED` or `UPGRADE_SELECTION`, so the click that resumes can never become a shot.
  - Readers reuse their buffers, so sampling allocates nothing once warm.
- **`ActionMap`** answers per action (`isDown`, `wasPressed`, `wasReleased`) from the `config/input.ts` bindings. Wheel bindings count as presses only.
- **`BrowserInput` is the only code that touches DOM events,** and receives `window`, `document` and the canvas by injection from `main.ts`. Lint bans browser globals in all of `input/`.
  - Mouse buttons, motion and wheel reach the game only while the pointer is locked.
  - Motion events over 1500 px are dropped as browser glitches.
  - Default actions are suppressed only for bound keys without Ctrl/Meta/Alt, the canvas context menu, the wheel while locked, and the side buttons.
  - Text fields keep their keys.
  - Blur and a hidden tab release everything held.
- **`PointerLock`:**
  - Issues the browser request synchronously inside the click.
  - Asks for `unadjustedMovement`, falling back on `NotSupportedError`.
  - Supports both the Promise and the older event-only API.
  - Returns a result object instead of throwing when refused.
- **Pause and resume:**
  - `installAutoPause` pauses on pointer-lock loss, window blur and tab hidden. Pause is idempotent, so the usual burst of all three signals pauses once.
  - Resuming is never automatic: the player clicks the prompt, which re-acquires the lock.
- **`ui/LockPrompt`** is a deliberately minimal "click to play / paused / refused, click again" button. The pause menu replaces it with the UI systems (plan §22).

**Consequences.**
- Mouse look (Phase 1) must read the frame reader before the fixed steps, so `Game` will need a small pre-step hook then.
- `beforeunload` confirmation during a run (D-017 item 6) arrives with the run lifecycle, not in 0.4.


## D-035 — Engine config, debug tooling, error and context-loss handling
**Status:** Accepted · **Date:** 2026-09-25

Implements D-010, D-020 and ARCHITECTURE §7.17 for Phase 0.5.

**Engine configuration.**
- `core/Config.ts` exports one typed, deep-frozen `ENGINE_CONFIG` (loop, render, camera, input, debug, errors).
- `Time`, `Renderer`, `createCamera`, `InputState` and `PointerLock` take their defaults from it. The old per-module constants (`DEFAULT_FIXED_DT`, `RENDERER_DEFAULTS`, `CAMERA_DEFAULTS`, the input limits) are deleted, so every default exists exactly once. Constructor options still override for tests.

**Gameplay configuration skeletons.**
- The `src/config/` files hold only what the plan and design already decide: ids, schemas (`WeaponConfig`, `EnemyArchetypeConfig`, `WaveDefinition`, `MutationConfig`, `UpgradeConfig`, `BossConfig`, `AdaptationRule`, `RewardTable`, `SignalPhaseConfig`), and fixed values.
- The fixed values are: the plan's zone multipliers, difficulty tiers and signal phases; the mutation and upgrade catalogues with v1 flags; the Siren's phase thresholds; the design's adaptation guardrails.
- Balance numbers are left undefined until their phase and are logged in BALANCING.md. Inventing them now would create false precision.

**Debug tools.**
- `debug/` is loaded only through `import('./debug/installDebug')` inside `if (import.meta.env.DEV)`. Vite replaces the condition with `false` in production, and the chunk, code and CSS disappear. This is verified on `dist/` and in the browser.
- `window.tls` replaces the `__TLS_DEV__` handle. It is built by a pure, tested `DebugCommands` registry.
- The FPS / frame-time overlay uses `FrameStats`, a `FrameProbe` backed by typed-array ring buffers, so it allocates nothing per frame. The overlay text refreshes at 4 Hz.
- Hiding the overlay detaches the probe. Measured cost per frame: 15.3 ns detached vs 15.4 ns with no probe; about 130 ns attached.

**Errors.**
- Every uncaught error or rejection is fatal: stop, release the pointer, show a safe screen.
- The first error drives the screen; later ones are kept (at most 20) for `tls.errors()`.
- Events are never `preventDefault`ed, so the browser still logs them. `report()` logs caught-but-fatal errors itself.
- The error logic (`core/ErrorHandler`) receives its event target by injection and is unit-tested in Node.

**WebGL2 and context loss.**
- The WebGL2 probe has an injected canvas factory. The fallback screen covers a missing WebGL2 and a failed renderer creation after a successful probe.
- `ContextLossMonitor` owns loss, restore and a 10 s restore timeout.
- Simulation state is never touched by a loss. Outside a run the simulation keeps stepping; a run pauses, as it would for any interruption.
- On restore, shaders are pre-warmed again and the drawing buffer is re-applied.


## D-036 — End-to-end harness and Phase 0 verification conventions
**Status:** Accepted · **Date:** 2026-09-25

Implements D-021's "Playwright when the first rendering smoke test is written" (Phase 0.6).

**Decision.**
- **The browser checks now live in the repository.** `@playwright/test` (pinned exactly, 1.63.0) runs `tests/e2e/*.spec.ts` via `npm run test:e2e`. The ad-hoc scripts used for Phases 0.3–0.5 are replaced by these specs.
- **Two projects.** Every spec runs against the dev server (`dev`) and a production build served by `vite preview` (`prod`). Development-only checks are skipped in `prod`, which instead asserts that debug tooling is absent.
- **`E2E_BASE_URL`** runs the suite against a deployed build (`remote` project, production expectations), e.g. a Vercel preview. `VERCEL_AUTOMATION_BYPASS_SECRET` adds Vercel's bypass header for protected previews. The repository remains the source of truth.
- **Software WebGL** (SwiftShader) in e2e runs, for identical results with or without a GPU. E2E frame rates are therefore never performance data.
- **One worker**, because software rendering is CPU-bound and several checks are timing-based.
- **`PLAYWRIGHT_CHROMIUM_EXECUTABLE`** lets machines with a pre-installed Chromium (the cloud container) skip `npx playwright install`.
- **Isolated typing.** `tests/e2e/` has its own `tsconfig.json` (Node types), is excluded from the app project, and is typechecked by `npm run typecheck`. `@types/node` is added for this only. `src/` still has no Node types (D-031).
- **Not in `npm run check`.** E2E needs a browser and two servers (about 2 minutes). It is required before committing changes to rendering, input, UI, error handling or the build, and before merging.
- **Every e2e test asserts a clean page:** no console errors or warnings, page errors, failed requests or HTTP errors, except errors a test deliberately provokes.
- **Lint relaxation:** non-null assertions are allowed in `tests/e2e/` only, for browser-side page scripts where the element or `window.tls` is guaranteed by the test.
- **Folders are created with their first file.** The full tree is defined in ARCHITECTURE §6. No empty placeholder directories are committed; git does not track them.

**Why.** Browser behaviour verified once by hand drifts; committed specs make the Phase 0 guarantees repeatable. Running dev and production side by side catches build-only regressions and proves that debug code is stripped.


## D-037 — Performance targets, reference hardware and graphics quality scaling
**Status:** Accepted · **Date:** 2026-09-25 · **Resolves:** O-9 · **Refines:** D-022 (shadow budget), ARCHITECTURE §8

**Context.** Plan §3 and §25 ask for about 60 FPS, with 30 FPS "minimum acceptable on weaker supported hardware", but never named that hardware (O-9). The project owner has now defined it, and clarified that it is a performance floor, not a visual ceiling.

**Decision.**

1. **Weak reference machine (minimum validation target):**

   | Part | Model | Notes |
   |---|---|---|
   | CPU | Intel Core i5-4440 | 4 cores / 4 threads, 3.1–3.3 GHz, Haswell (2013) |
   | RAM | 16 GB DDR3-1333 | |
   | GPU | NVIDIA GTX 750 | Maxwell GM107, about 1.1 TFLOPS. Sold with 1 GB or 2 GB GDDR5: **VRAM budgets assume 1 GB until the actual card is confirmed** |

2. **Targets.** 1920×1080 is the primary baseline unless a phase says otherwise.

   | Tier | Hardware | Preset | Target |
   |---|---|---|---|
   | Minimum | Weak reference (above) | Low | **~30 FPS average in normal gameplay** (≤ 33.3 ms per frame) |
   | Target | Capable hardware, e.g. an RTX 4050 class GPU | High | **~60 FPS** (≤ 16.7 ms per frame) |

   - The average FPS over a representative scenario is the gate.
   - 95th-percentile and 1% low frame times are recorded alongside it [Proposed guidance]. A 95th percentile above ~50 ms on the reference is visible stutter and is investigated even if the average passes.

3. **Measure first, optimise second.**
   - Performance work starts from a recorded measurement that shows a budget miss (TESTING.md §7), never from assumption.
   - Measurements are recorded per phase once there is gameplay to measure, starting with the Phase 1 prototype map.
   - This follows plan §39 rules 6–7: fix measured regressions before adding content, and don't replace working architecture without a measurable reason.

4. **The weak reference is a floor, not a ceiling.** Rendering scales across quality presets **Low / Medium / High / Ultra** (plus Custom). The GTX 750 must reach the minimum target at Low; stronger GPUs use much better visuals at High and Ultra. The visual design targets High. Low is a readable, faithful reduction of it, and the art direction is never lowered to GTX 750 level.

5. **Quality dimensions.** Every GPU-heavy feature takes its parameters from a quality profile, never from constants in rendering code. The values below are starting points, set by measurement:

   | Dimension | Low | Medium | High | Ultra | Applied |
   |---|---|---|---|---|---|
   | Render scale | 0.75–1.0 | 1.0 | 1.0 | 1.0 | live |
   | Pixel-ratio cap | 1 | 1 | 1.5 | 2 | live |
   | Anti-aliasing (MSAA) | off | on | on | on | on reload (context attribute) |
   | Shadow casters | 1 | 1 | 2 | 2+ | on load (shader programs) |
   | Shadow map size | 1024 | 2048 | 2048 | 4096 | on load |
   | Dynamic lights | minimum (decor via emissive) | reduced | full | full | on load (D-022: fixed count per preset) |
   | Particle / decal density | 0.5× | 0.75× | 1× | 1.25× | live |
   | Post-processing | tone mapping only | + FXAA, light bloom | + bloom, SSAO (low) | + full SSAO, higher-quality bloom and grading | on load |
   | Texture resolution / anisotropy | ½ res, 2× | full, 4× | full, 8× | full (+ high-res set), 16× | on load (re-upload) |
   | Mesh LOD distances | near | medium | far | farthest | live |

6. **Gameplay parity. Quality never changes gameplay.** The simulation, hitboxes, spawns, enemy counts, AI and rules are identical on every tier. Gameplay-relevant visibility is also fixed across tiers:
   - fog distance;
   - darkness during BLACKOUT;
   - smoke that blocks sight;
   - muzzle-flash light;
   - attack and boss telegraphs.

   Effects are tagged *gameplay-critical* (always rendered) or *cosmetic* (scaled). Reducing density must never remove a tell. Low settings must not give a visibility advantage either: Low may not render thinner smoke or brighter darkness.

7. **Architecture** (ARCHITECTURE §7.18):
   - One typed `GraphicsQualityProfile` per preset, stored as data in `core/Config.ts`.
   - The active profile is passed to presentation systems (`Renderer`, lighting, VFX, post-processing), never read as a global.
   - Changing it applies *live* values immediately. *On load* values are applied at a safe point (settings menu or loading), because they recompile shaders, re-upload textures, or, for MSAA, recreate the context. D-022's fixed light count still holds within a preset.
   - Persisted later by `SettingsManager` (plan §26, "Graphics settings").

8. **Scope.**
   - The full settings system (UI, persistence, auto-detection) is **not** part of Phase 1.
   - Phase 1 adds only what it needs: the profile type and preset table for the values Phase 1 renders (render scale, pixel-ratio cap, MSAA, shadow size and casters), plus a way to choose a preset at load (e.g. `?quality=low`). The reference machine can then be measured at Low.

**Consequences.**
- ARCHITECTURE §8's budgets are now stated for the weak reference at Low, 1080p.
- D-022's "at most 2 shadow casters" becomes a per-preset value.
- TESTING.md §7 holds the measurement protocol and the results log.

---

## D-038 — Phase 1 first-person foundation: movement model, collision, look, blockout, run entry
**Status:** Accepted · **Date:** 2026-09-25 · **Implements:** plan §8 (Phase 1), D-004, D-006, D-013, D-030, D-037 §8

**Context.** Phase 1 needs a controller that "feels like a real FPS", collides reliably with a blockout map, and is identical at any refresh rate, without a physics engine.

**Decision.**

1. **Split of the player** (ARCHITECTURE §3.3): `Player` (fixed-step system), `PlayerMotor` (body and collision, the plan's `PlayerMovement`), `PlayerLook` (yaw/pitch), `PlayerController` (actions → intent), `CameraController` and `HeadBob` (presentation). The simulation never reads the camera.
2. **Movement model** (values in `config/player.ts`, tuned for feel, logged in BALANCING.md from Phase 2):
   - Walk 5 m/s; sprint 1.5× (forward only, not crouched); crouch 0.5×.
   - Ground acceleration 50 m/s², braking 40 m/s²: full speed in 0.1–0.15 s, a stop in about 0.13 s. Responsive without being twitchy.
   - Air control 12 m/s² toward the wished velocity; no input in the air keeps momentum.
   - Jump to 1.15 m under 22 m/s² gravity (a snappier arc than 9.8 m/s², usual for FPS feel). Coyote time 0.1 s and jump buffer 0.12 s as forgiveness. Jump is an edge: holding Space never repeats.
   - Capsule radius 0.35 m, height 1.8 m standing / 1.1 m crouched; eyes at 1.62 m / 0.95 m, eased between.
3. **Collision** (ARCHITECTURE §7.6): per-contact resolution against the level octree (walkable contacts push straight up, others push along their normal and cancel the velocity into them), sub-steps of at most half the radius, a downward ground probe with a snap distance, exact gravity integration, headroom check before standing, and a kill plane that respawns the player.
4. **Look.** Mouse look runs in a new `Game.addFrameSystem` hook before the fixed steps (completing D-004). Pitch is clamped to ±89°. FOV (60° vertical ≈ 90° horizontal at 16:9), sensitivity, invert-Y and head bob are `ENGINE_CONFIG.view` defaults, changeable at runtime through one `applyView` function (`tls.view()` in dev).
5. **Blockout map** (`world/levels/facility.ts`): a 48 × 48 m compact facility with a yard, a roofed control room with three entrances, a crouch-only crawl duct (1.25 m), a service corridor, a generator hall, a raised catwalk (2.5 m) reached by stairs and a ramp with a drop gap in its railing, and a loading dock (0.9 m, a jump up or a ramp). Ramps and stairs are at most ~20°. Stairs collide as their ramp. It renders as 6 merged meshes; no art (D-030).
6. **Run entry.** Clicking "Click to play" in `MAIN_MENU` captures the mouse and runs `LOADING → PLAYING` (loading is instant for now). The player simulates only while `isIn('PLAYING')` (in Phase 1 the run rests in `WAVE_START`, as waves are not implemented), and respawns on each new run. Losing the lock pauses as before.
7. **Graphics preset at load.** `?quality=low|medium|high|ultra` picks the D-037 profile; default High. `Renderer` and `WorldView` read their values from it.
8. **Config restructure.** `ENGINE_CONFIG.render` keeps only non-quality settings; GPU-quality values moved to `ENGINE_CONFIG.graphics.presets` (D-037); `camera` holds look/bob tuning; `view` holds player-facing view settings.

**Why.**
- Per-contact resolution is what makes floors, walls and ceilings behave differently when touched together (walking into a wall, crouching under a ledge), which `Octree.capsuleIntersect`'s single merged push cannot.
- Pushing straight up on walkable ground removes the classic "slide down ramps while standing" artefact of a capsule controller.
- Exact vertical integration and fixed steps make the jump apex and all movement independent of display refresh rate (tested at 30–240 Hz).

**Alternatives.**
- `Octree.capsuleIntersect` as in three.js's `games_fps`: simpler, but it blends normals and needs gravity every frame to detect the floor, which causes micro-bouncing and slope sliding. Rejected.
- A physics engine (Rapier, cannon-es): unnecessary for a kinematic controller against static geometry (D-006).
- A menu screen before the run: deferred to the UI phase; the prompt click is the smallest honest entry into `PLAYING`.

**Consequences.**
- `TestScene`/`TestSceneView` are replaced by `World` + `SignalBeacon` + `WorldView`. The beacon sits on the tower as the future signal objective's placeholder.
- The default pixel-ratio cap is now 1.5 (High preset) rather than 2; `?quality=ultra` restores 2.
- E2E and headless tests follow the same `FACILITY_ROUTE`, so any level edit that breaks traversal fails both.

---

## D-039 — Loadout of Melee, Primary and Secondary; Scrap purchases at the Supply Terminal
**Status:** Accepted · **Date:** 2026-09-26 · **Resolves:** O-2 · **Partly answers:** O-1 (what Scrap buys), O-6 (melee) · **Refines:** D-011

**Context.** The plan names three weapons (Pistol, Assault Rifle, Shotgun) and a "Shotgun + Melee" build, but not how the player carries or obtains them (O-2), nor a melee action (O-6). The project owner has defined the loadout and acquisition design.

**Decision.**

1. **Three named categories, not numbered slots.** The loadout is modelled explicitly as **Melee**, **Primary** and **Secondary** (ARCHITECTURE §7.3). Code never treats them as "slot 0/1/2".

   | Category | Run start | Later |
   |---|---|---|
   | Melee | Bare Hands (fists) | Melee weapons bought or unlocked, e.g. a Knife |
   | Primary | Pistol (the initial firearm) | Assault Rifle, Shotgun, SMG, … |
   | Secondary | **Locked** (present in the data) | Unlocked by progression / a milestone; then e.g. a secondary pistol, machine pistol or revolver |

2. **Melee is always available**, regardless of the firearm held: quick melee (V, the proposed default key) attacks without switching away, and the melee category can never be empty (Bare Hands is the fallback).
3. **Switching:** 1 = Primary, 2 = Secondary (refused while locked or empty), 3 = hold the melee weapon [Proposed], mouse wheel = cycle through available categories. The Phase 0.4 input actions `weapon1/2/3` are renamed to `equipPrimary`, `equipSecondary`, `equipMelee` in Phase 2; the physical keys do not change.
4. **Weapons declare which categories they fit.** One weapon per category; acquiring into a filled category replaces the weapon there [Proposed: no refund in v1]. The starter Pistol fits Primary and Secondary [Proposed].
5. **Acquisition:** weapons, melee weapons and ammunition [Proposed] are bought at the **Supply Terminal between waves**, with **Scrap** as the primary purchase currency. The Secondary slot and some weapons are unlocked through progression / milestones. `WeaponManager.acquire()` and `unlockSecondary()` are the only entry points, whatever the source (shop, unlock, debug).
6. **Initial run:** Bare Hands · Pistol · Secondary locked (`STARTING_LOADOUT` in config).
7. **Phase 2 scope:** the full loadout model (all three categories), the Pistol, and a basic Bare Hands melee placeholder. **Not** in Phase 2: the melee arsenal (Knife etc.), Secondary weapon content, the Supply Terminal, prices, unlock conditions.

**Why.**
- Named categories make the rules (melee always usable, Secondary locked, what fits where) explicit in types instead of hidden in slot indices, and let later phases add weapons, melee purchases and the Secondary unlock without rewriting the weapon core.
- Always-available melee plus the Pistol's unlimited reserve [Proposed] guarantees the player can always fight back, so no purchase choice can soft-lock a run.
- A between-wave shop keeps acquisition a deliberate choice and gives Scrap a clear, in-run use.

**Relation to the plan.** Plan §16 describes Scrap as "used for persistent purchases". D-039 makes Scrap the purchase currency at the in-run Supply Terminal, as decided by the project owner. Whether unspent Scrap also buys anything persistent stays open (O-1). The previous O-2 recommendation (weapon cards on upgrade screens after waves 2 and 4) is withdrawn.

**Consequences.**
- GAME_DESIGN §4.1 (controls), §5 (loadout, weapons, acquisition), §11 (Scrap), §14 (HUD loadout strip) and ARCHITECTURE §5 and §7.3 are updated.
- New open question O-13: how the Supply Terminal is presented, and what unlocks the Secondary slot.
- The Supply Terminal itself, prices and stock arrive with the progression / economy phases (plan Phases 9 and 14) and the UI phase; they are logged in BALANCING.md.

---

## D-040 — Phase 2 weapon framework: timing, trigger, reload, hitscan, recoil, melee placeholder, events
**Status:** Accepted · **Date:** 2026-09-26 · **Implements:** plan §9 (Phase 2), D-004, D-007, D-011, D-014, D-039

**Context.** Phase 2 builds the weapon framework around the approved loadout (D-039), with the Pistol as the only firearm and Bare Hands as a melee placeholder, and no enemies yet.

**Decision.**

1. **One interface, two implementations, all data.** `Weapon` is the plan's interface (`fire, reload, canFire, getAmmo, getState`, plus `update` and `cancelReload`). `Firearm` implements every gun from a `FirearmDefinition` (fire mode, pellets, spread, recoil, falloff, ammo); `MeleeWeapon` implements every melee weapon from a `MeleeDefinition`. A new weapon, including an automatic rifle, a shotgun or a Knife, is a config entry (tested with test definitions).
2. **Timing on the fixed step.** A shot cooldown keeps the fractional remainder of the step in which the weapon becomes ready, so the average fire rate is exact even when the interval is not a whole number of steps. A weapon that was already ready banks nothing, so it never fires early or bursts. At most one shot per step (fire rates up to 60/s). Timers treat a floating-point residue below 1e-9 s as finished, so step-aligned times are exact.
3. **Trigger rules** live in `WeaponManager`, not in the weapons:
   - semi-automatic and pump: one shot per press; a press up to 0.12 s before the weapon is ready still fires (buffer), older presses are dropped;
   - automatic: fires while held;
   - no firing while switching (the raised weapon's `equipTime`), during a quick melee, or during a reload (a press mid-reload is not queued);
   - an empty magazine clicks (`dryFire`) and then reloads automatically.
4. **Reload:** takes `reloadTime`, moves `min(missing, reserve)` rounds at the end, is refused with a full magazine or an empty reserve, and is cancelled by switching away or by a quick melee. The Pistol's reserve is `Infinity` (D-039).
5. **Hitscan with pluggable targets.** `Hitscan.cast` returns the nearest of the level (`CollisionWorld.raycast`) and any registered `HitscanTarget`. Enemies (Phase 4) register as targets with their hitbox rigs, and walls block them automatically. Results are plain data (`kind`, `distance`, `point`, `normal` or `targetId`/`zone`), with per-pellet damage after falloff and the weapon's headshot multiplier, ready for combat (Phase 3).
6. **Spread** is a cone around the aim, sampled uniformly over its cross-section from the run's seeded `Rng` (D-014), widened by movement (up to walking speed) and by being airborne, tightened by crouching.
7. **Recoil through `PlayerLook`.** A shot kicks yaw and pitch (random parts from the seeded `Rng`); only the upward kick is remembered and settles back at the weapon's recovery rate. Pulling the mouse down counts as recovery, and the player's own aim is never undone. Aim and camera therefore never disagree, and recoil never touches render code.
8. **Loadout rules (D-039) in code:** named categories; 1 / 2 / 3 = `equipPrimary` / `equipSecondary` / `equipMelee`; the mouse wheel cycles **firearms only** (from melee it returns to a firearm; a locked or empty Secondary is skipped); V = quick melee without switching; with melee held, Fire swings it. `acquire` fills an empty fitting category before replacing one; replacing gives a fresh weapon, with no refund.
9. **Firing cancels sprint:** any attack blocks sprint for 0.35 s (GAME_DESIGN §4.2).
10. **Events:** `WeaponManager.events` (a typed `EventBus`) announces shots, swings, dry fire, reload start/end/cancel, equips, refusals, acquisitions and the Secondary unlock. Recoil, the view model, debug tools and tests use them; combat, audio, the adaptive profile and analytics will too.
11. **Bare Hands placeholder:** a swing is an instant ray of 1.6 m along the aim that reports what it touched, with a 0.5 s cooldown. Hit arcs, animation-timed impact and damage to enemies come with combat.
12. **Presentation (blockout):** `WeaponView` draws a view model (pistol blocks, fists), a muzzle flash (unlit additive quad, no light, D-022) and up to 32 reused impact markers. `WeaponHud` is a placeholder crosshair and ammo readout until the UI phase; the loadout strip (GAME_DESIGN §14) is not built yet.

**Deviation from the plan.** Plan §9 lists the Pistol, Assault Rifle and Shotgun as the initial weapons. As the project owner scoped Phase 2, only the Pistol ships now; the Assault Rifle and Shotgun are Primary weapons bought later at the Supply Terminal (D-039). The framework supports both (automatic fire and pellets are tested with test definitions), so adding them needs data only.

**Why.** Keeping trigger rules in the manager and timing in the weapons makes each weapon a pure function of its data and the step, which is what makes behaviour identical at any frame rate and testable in Node. Pluggable hitscan targets let combat add enemies without the weapon code changing.

**Consequences.**
- Bare Hands, the Pistol and the rules are in BALANCING.md (created in this phase).
- Debug tools gain `weapons`, `giveAmmo`, `setInfiniteAmmo`, `giveWeapon` and `unlockSecondary`.
- Open for later: aim down sights (right mouse), weapon sway, audio, per-weapon view models, damage to enemies.

## D-041 — Phase 3 combat: hitbox rigs, pure damage, reusable Health, one-time death, feedback, drops, training dummies
**Status:** Accepted · **Date:** 2026-09-26 · **Implements:** plan §10 (Phase 3), D-007, D-009 (hooks), D-014, D-015, D-022, D-040

**Context.** Phase 3 builds the combat foundation that zombies (Phase 4), bosses and the player's own health will use. There are no enemies yet, so the pipeline is validated against **training dummies**, which are temporary test targets and not a gameplay feature.

**Decision.**

1. **One pipeline, nothing zombie-specific.** Weapon hit → hitbox resolution → damage calculation → `Health` → death → events. It lives in a new `src/combat/` folder (simulation layer, lint-enforced; an addition to the plan tree like those in D-023). Anything with a hitbox rig and a `Health` can be registered with the `CombatSystem`: dummies now, enemies and bosses later.
2. **Hitbox rigs (D-007).** A rig is config data (`HitboxRigDefinition`): analytic spheres and capsules, each tagged with a plan zone (`HEAD, TORSO, ARM_LEFT, ARM_RIGHT, LEG_LEFT, LEG_RIGHT`), in the owner's local space (feet origin, facing −z, so its own right is +x). `HitboxRig` places it (position, yaw), swaps poses (`setPose`, for AI poses later), and answers "where does this ray first enter, in which zone": a bounding-sphere broad phase, then every shape, nearest wins; on an exact tie the shape listed first wins. Rays are moved into local space; shapes are never transformed; nothing allocates per ray. `HUMANOID_RIG` (~1.8 m, generous head) is the first rig.
3. **Hit resolution is the existing hitscan.** `CombatSystem` is one `HitscanTarget` over all its living targets, given the level's hit distance as its range, so walls block targets and the nearest target wins without combat knowing about walls. Dead targets are skipped: shots pass through them.
4. **Damage is one pure function (`computeDamage`).** `base × falloff × zone multiplier × attacker multiplier`, then armor (flat per hit, never below `COMBAT_RULES.minimumDamage`, never raising a weaker hit), then resistance (a fraction, last). No randomness, no state; unusable inputs give 0, never NaN.
   - **Zone multiplier:** body zones come from the target's table (the plan's defaults in `config/enemies.ts`, archetype overrides). **HEAD uses the attacking weapon's `headshotMultiplier`** (Pistol 2.5, which is the plan's HEAD value; Bare Hands 1.5), scaled by the target's HEAD entry relative to the plan's, so a tougher or weaker head changes every weapon's headshot in proportion. This keeps the per-weapon headshot value approved in Phase 2 and the plan's zone table consistent.
   - **Critical damage = a headshot** (GAME_DESIGN §6: no random crits). Boss weak points will add a flag to their shapes.
   - **Falloff** comes from the weapon's hit result: pellets now carry `baseDamage` and `falloff` as well as their product. Melee has none.
   - **Hooks, default neutral:** `CombatSystem.attackerMultiplier` (upgrades), per-target `armor`, `resistance` and zone overrides (archetypes, modifiers).
5. **Reusable `Health`.** Current and maximum, damage, healing, revive, `setMax` (keep fraction or clamp), configurable start. Health stays in [0, max]; reaching 0 is death; **death happens once** (a dead owner ignores damage and healing until `revive`); floating-point dust below 1e-9 counts as dead; zero, negative and NaN amounts change nothing.
6. **Death and deactivation.** The killing hit emits `damaged` (with `killed: true`), then the target's `onKilled` hook (its owner's deactivation or removal hook), then `killed`, exactly once. `remove` unregisters a target (despawn, pool return); `revive` brings one back (`revived`).
7. **Events (D-015)** on `CombatSystem.events`: `damaged` (target, weapon, source shot/melee, quick, zone, critical, amount applied, amount dealt, health left, point, direction, distance, killed), `staggered`, `killed`, `revived`. Combat listens to the weapons' `shot` and `melee` events, so a hit is resolved in the same fixed step it was fired. Bare Hands (held or quick melee) deals damage through the same path, with no falloff.
8. **Hit reactions.** Damage landing within `COMBAT_RULES.staggerWindow` (1 s) of the previous hit adds up; reaching the target's `staggerThreshold` emits `staggered` and restarts the count. A killing hit never staggers; no threshold means stagger-immune. What a stagger does (the AI `STAGGER` state) belongs to the enemy phase.
9. **Feedback (placeholder presentation).** `ui/CombatFeedback`: a hit marker on the crosshair (white hit, gold headshot, red and larger kill) and optional damage numbers (on by default; pooled DOM nodes projected from the hit point, rising and fading). Its root also carries running totals (`data-hits`, `data-headshots`, `data-kills`) so automated checks can read the feedback in any build. `WeaponView` adds a short additive spark at body hits (8 pooled sprites). Dummies flash and tilt away from hits, tilt more on a stagger, fall on death.
10. **Ammo drops (plan §10), foundation only.** Data in `config/drops.ts`: pickup definitions (ammo: whole magazines, radius, lifetime) and drop tables (entries rolled independently with the owner's seeded `Rng`, chances scalable for Scavenger). `rollDrops` is pure apart from the injected `Rng`. `world/PickupManager` holds pickups (capped, oldest removed, lifetime), collects them when the player is within reach and the `collect` callback accepts them; a pickup nobody needs stays on the ground. Ammo goes to `WeaponManager.addAmmo`, which gives whole magazines to limited reserves only, so with the starter Pistol's unlimited reserve (D-039) pickups are not taken. Any death can roll a table: dummies do now, enemies will. There is no pickup economy, no other pickup kinds and no Supply Terminal.
11. **Training dummies (temporary).** `config/training.ts` defines two kinds on the humanoid rig: *standard* (100 health, the Pass-1 Walker placeholder, drops ammo, 3 s respawn) and *zoned* (400 health, each zone painted, no drops). `combat/training/TrainingRange` places the configured range (three dummies in the yard facing the spawn; the first straight ahead, so the spawn view is a headshot), registers them with combat, rolls drops on death and stands them up again after the delay. No AI, no movement, no attacks, no collision with the player. The range is on in every build while there is nothing else to shoot (`TRAINING_RANGE.enabled`), so the production build can be verified too; the wave phase turns it off, and the debug tools can still spawn dummies.
12. **Rendering stays inside the budget.** Each dummy is one merged mesh with vertex colours (one draw plus one shadow draw). With a mesh per shape, 24 dummies measured ~285 draw calls, over the Low budget of 250; merged, 24 dummies cost ~59 and 60 cost ~113. Enemies should follow the same rule (one body mesh per enemy).
13. **Prewarm covers hidden objects (refines D-022).** `WorldView.prewarm` shows every hidden object (muzzle flash, impact markers, sparks, pickups) for one render behind the start prompt, because `compile` only visits visible objects. The first shot of a session had cost ~200 ms (present since Phase 2, found by the Phase 3 measurements); it now costs the same as any other shot.
14. **Debug (dev only):** `tls.combat()`, `dummies()`, `spawnDummy(kind?, distance?)`, `resetDummies()`, `clearDummies()`, `reviveDummies()`, `aimAt(x, y, z)`, `aimAtTarget(id, zone?)`, `showHitboxes()` (the hitbox visualiser: wireframes from the simulation's rigs, HEAD gold), `damageNumbers()`, `pickups()`, `spawnPickup(id?, x?, y?, z?)`; an overlay line with living targets and the last hit. `healPlayer` and `setGodMode` stay stubs, now labelled Phase 4: nothing damages the player until enemies attack.

**Why.**
- A pure damage function and a `Health` that knows nothing about zones or weapons make every combat rule testable in Node and reproducible; the same pieces serve dummies, zombies, bosses and later the player.
- Rigs as data, tested through the existing hitscan, keep combat cheap and deterministic (D-007) and let walls and nearest-hit work unchanged.
- Validating against dummies that use exactly the enemy format means Phase 4 adds behaviour, not combat plumbing.

**Consequences.**
- Combat values (zone multipliers, headshot rule, stagger, drops, dummy health) are logged in BALANCING.md.
- Player health and damage to the player are not in this phase; `Health` is ready for them (Phase 4, D-029).
- Open for later: boss weak points (a flag on shapes), helmets (per-zone armor that breaks), pose presets per AI state, hit reactions in the AI, a settings toggle for damage numbers, real blood and impact VFX, enemy collision with the player.

---

## D-042 — Phase 4 zombie foundation: generic enemy framework, the Walker, AI state machine, limited-rate decisions, route-graph navigation, melee, player health
**Status:** Accepted · **Date:** 2026-09-26 · **Implements:** plan §11 (Phase 4), D-012, D-029, D-041 · **Refines:** D-008 (navigation for the current blockout)

**Context.** Phase 4 builds the enemy foundation: a reusable framework, the first archetype (the Walker), the plan's seven AI states with decisions at a limited rate, and the first damage to the player. Combat (D-041) is reused as it is. There is no wave system yet (Phase 6), and no other archetype (Phase 5).

**Decision.**

1. **An enemy is archetype data, a behaviour and the generic framework; nothing generic names an archetype.**
   - `config/enemies.ts`: `EnemyArchetypeConfig` holds the plan's base fields (health, move speed, attack damage, attack range, detection range, attack cooldown) plus body size, hitbox rig and attack pose, turn rate and acceleration, combat overrides (zones, armor, resistance, stagger threshold and duration), perception (lose range, memory, reaction time), the attack's shape (wind-up, recovery, reach, arc, vertical reach), patrol, corpse time, threat cost, drop table, and `behavior`: which brain drives it. Only the Walker has data; `enemyConfig(id)` refuses archetypes without any. `ENEMY_RULES` holds what is shared (think interval, living cap, separation, route and stuck tuning, walkable-line heights).
   - `enemies/Enemy.ts`: one pooled instance: a body (the player's `PlayerMotor` with the archetype's size and speeds), a `HitboxRig`, a `Health`, an `EnemyStateMachine`, and the AI's working state (target, perception, attack phase and timers, route, steering). `prepare` resets all of it for reuse.
   - `enemies/EnemyManager.ts`: the fixed-step system: spawning (living cap, pools per archetype, unique ids `walker-1`, `walker-2`…), registration with combat exactly like a training dummy, decision scheduling, separation, movement, death, removal exactly once, `clear` for a new run, `canStand` (spawn validation), and the debug controls.
   - `enemies/ai/`: `EnemyStateMachine` (the transition table), `brain.ts` (the behaviour interface: `think`, `update`, `onDamaged`, `onStaggered`, `alert`), `meleeBrain.ts` (walk up to the target and hit it: the Walker's behaviour, driven only by its config) and `brains.ts` (behaviour id → brain). A Runner or a Tank is new data; a Screamer or a Climber adds a brain (or a brain option) next to the melee one.
2. **AI state machine (plan §11).** The seven plan states with one table of legal transitions: IDLE → PATROL, DETECT, STAGGER, DEAD; PATROL → IDLE, DETECT, STAGGER, DEAD; DETECT → CHASE, ATTACK, IDLE, STAGGER, DEAD; CHASE → ATTACK, IDLE, STAGGER, DEAD; ATTACK → CHASE, IDLE, STAGGER, DEAD; STAGGER → IDLE, CHASE, ATTACK, DEAD; DEAD is terminal. No self-transitions (a second stagger or a new attack is handled inside the state). Anything else is refused, and throws in strict mode (development builds and tests). All 49 pairs are tested against an independent table.
3. **Decisions at a limited rate (plan §11 "no expensive logic every render frame").**
   - `think` (sight rays, target choice, route planning, patrol choice) runs every `thinkInterval` (0.1 s = every 6th fixed step). Each enemy's turn is offset by its spawn number, so decisions are spread evenly over the steps and never pile up on one (measured at 64 Walkers: at most 11 decisions in any step).
   - `update` runs every fixed step and holds everything that must be exact: reaction time, wind-up, strike, recovery, stagger, cooldown. Movement runs every fixed step.
   - All of it is fixed-step simulation: nothing depends on the render frame rate (the same fight gives the same timeline at 30, 60 and 144 Hz, tested). This replaces the separate `AIScheduler` sketched in ARCHITECTURE §7.4: the manager's step counter is the scheduler.
4. **Perception and targeting, generic.** Targets are `EnemyTarget`s (id, position, eye height, radius, alive, `receiveHit`): the player today, anything later. An enemy acquires the nearest living target within detection range that it can see (one ray, eye to eye). It keeps a target while it sees it, or for its memory time after, within its lose range. Being told where the target is overrides range and sight: a hit tells it for its memory time; the game's `alert` (the horde now, a Screamer later) tells it for good. It loses a target that dies, gets too far away or stays unseen too long.
5. **Navigation fits the blockout (refines D-008 for now).** The facility has a raised catwalk, a dock, a roofed control room reached through doorways and a crawl duct, so walking straight at the player is not enough. A nav grid with flow fields is more than it needs yet, and the brief asked for simple route data first. So:
   - **Direct pursuit** whenever a body can walk the straight line (`LineTester.walkable`: ends within a step of each other in height, knee-height rays along the centre and both sides of the body, one chest-height ray).
   - Otherwise **an authored route graph** in the level data (`LevelDefinition.navigation`; the facility has 37 nodes and 48 links), searched with A* (ties resolve to the lower node index, so routes are deterministic). A route starts at the nearest node the body can walk to and ends at the node nearest the target with a straight walk to it (one goal per target per step, shared by all enemies). Re-plans start from the node being walked to, so a re-plan half-way up the stairs never sends it back down. Corners are cut when a later node is already walkable.
   - **Stuck detection:** no progress for 0.8 s on a straight walk means something the rays cannot see is in the way (a kerb below knee height, a beam above the chest): the enemy then follows the route link by link, without cutting corners (every link is walkable by a body), until the route ends or it reaches its target. A stuck route is re-planned. (A first version retried the straight line after 2 s and cut corners on the route with the same rays; the planted-bug tests showed it could never get round such an obstacle.)
   - Tests walk every link both ways with a Walker body through the real collision, and chase a target into every area of the map.
   - **D-008 stays the plan for hordes.** The brain only sees `lines`, `routes` and `goalNodeFor` in its context, so a flow field can replace the route graph behind the same context when a measurement asks for it. At 64 Walkers, decisions (sight, walkable lines and routes together) cost about 0.1 ms per step.
6. **Movement.** Enemies move through the player's capsule motor (walls, steps, ramps, stairs, gravity against the level octree), so they cannot walk through walls or fall through floors, and they move identically at any frame rate. The heading turns at the archetype's turn rate; the body walks along its facing and slows while still turning (no sliding sideways). Enemies push apart, and away from a target's body, through their velocity, never by moving their position. One that falls below the kill plane is removed (a safety net; the blockout is closed).
7. **Melee attack.** In range (horizontal distance ≤ attack range, height difference within vertical reach), in sight and with the cooldown ready, it enters ATTACK:
   - **Wind-up** (the telegraph): it stops, its facing is locked, and its rig switches to the arms-forward reach pose.
   - **One strike** at the end of the wind-up. It lands only if the target is still within reach, inside the committed arc, at a reachable height and not behind a wall; otherwise it misses (the attack can be dodged).
   - **Recovery**, then it attacks again when the cooldown (counted from the start of the attack) allows, or chases.
   - One damage per attack. A stagger or death during the wind-up cancels it. Damage goes to the target's `receiveHit`: for the player, `PlayerHealth`.
8. **Player health (implements D-029).** `PlayerHealth` wraps a `Health`: maximum from `config/player.ts` (100); damage only while `canBeDamaged` (the game is in `WAVE_ACTIVE` or `BOSS`); god mode (debug); death once (`died`); healing never while dead; `reset` for a new run. Events: `damaged` (amount applied, health, source, direction, killed), `died`, `healed`, `reset`. `main.ts` turns `died` into `GAME_OVER` and releases the mouse; clicking the game-over prompt starts a new run (`LOADING` → `PLAYING`), which resets the player, the enemies, the dummies, the pickups and the weapons.
9. **Run flow placeholder.** There is no wave system, so entering `WAVE_START` moves straight to `WAVE_ACTIVE`: one open-ended wave, in which the player can be hurt. Phase 6's `WaveManager` replaces this.
10. **Combat integration, no redesign.** Enemies register with the `CombatSystem` exactly like dummies (rig, health, zone overrides, armor, resistance, stagger threshold, `onKilled`). Combat's `damaged` event alerts the brain; `staggered` puts the enemy in STAGGER; death uses `onKilled`. Two small additions to `CombatSystem`: `applyDamage(id, {amount, zone?})` (direct damage without a weapon: debug commands now, hazards later; `weaponId: null`, source `direct`) and `kill(id)`. Both do nothing to dead or unknown targets.
11. **Stagger.** The Phase 3 stagger event (for the Walker: 35 damage within 1 s) cancels a wind-up and stops the enemy for its stagger duration (0.7 s); then it attacks, chases or idles, whichever fits. A stagger during a stagger restarts it.
12. **Death and cleanup.** The killing hit runs `onKilled`: the attack is cancelled, the pose reset, the state set to DEAD, the target dropped, the drop table rolled (Walker: ammo, 20%), the corpse timer started (5 s). Then the enemy is removed exactly once: unregistered from combat and returned to the pool. A dead enemy takes no damage, and shots pass through its body.
13. **Presentation (placeholders).**
    - `EnemyView` draws each enemy from its own rig: head, torso, legs and arms in zone colours with yellow eyes, as **one skinned mesh with two bones** (the body at the feet, the arms at the shoulders). It shows a walking bob and sway, turning, a wind-up (arms rising to reach forward, an orange glow growing until the strike), a hit flash and push, a stagger rock, and a fall and sink on death.
    - One mesh per enemy follows D-041's rule (one draw call plus one shadow draw). A separate mesh for the arms had measured **272 draw calls at 64 Walkers**, over the Low budget of 250; the skinned mesh measures **144**. One hidden, pooled visual per archetype exists from the start, so the start-up shader prewarm compiles the enemy materials before the first spawn.
    - `HealthHud`: the health number and a bar in the bottom-left corner, and a red flash on damage. The lock prompt gains a game-over mode ("You died / Click to start a new run").
14. **Test encounter (temporary, like the training range).** `TrainingEncounter` places three Walkers from `config/training.ts` at every new run: two sentries 14–15 m from the spawn (beyond detection range, so a player standing at the spawn is never engaged) and a patroller in the north-east yard. Each comes back 10 s after its body is removed. It is on in every build until the wave system arrives, so the Walker can be played in production.
15. **Debug (development only).** `tls.playerHealth()`, `healPlayer(amount?)`, `setGodMode()`, `damagePlayer(amount?)`, `killPlayer()`, `enemies()`, `enemy(id)`, `spawnEnemy(type?, distance?)` and `spawnWalkers(count?, distance?)` (both only on spots where a body fits), `killEnemy(id)`, `killAll()`, `damageEnemy(id, amount?)`, `setEnemyState(id, state)`, `alertEnemies()`, `clearEnemies()`, `freezeEnemies()`, `showAI()` (per enemy: a label with id, state and health, the detection and attack ranges as rings, a line to its target and the route it follows). An overlay line counts enemies by state and shows the player's health. The plan §29 stubs left are `startWave` (Phase 6), `triggerMutation` (Phase 7) and `spawnBoss` (Phase 13).

**Why.**
- Data plus a small set of brains keeps archetypes cheap: the Runner and the Tank are mostly numbers, and the rules that make an attack fair (telegraph, commitment, one hit, walls block) are written once.
- An explicit transition table makes illegal behaviour impossible rather than unlikely, and testable.
- Exact timing every step and expensive decisions at 10 Hz give fair, deterministic fights with a flat cost per step.
- Reusing the player's motor and the combat pipeline means enemies obey the same world and the same damage rules as everything else, with no second physics or hit model to keep consistent.
- The route graph is the least navigation the blockout needs; it is data in the level, validated by tests, and replaceable.

**Consequences.**
- Walker numbers, player health, the enemy rules and the Walker's drop are logged in BALANCING.md.
- The player can walk through enemies (enemies stop short of the player and push away from their body, but the player's motor does not collide with them). Body blocking comes with the horde work if play needs it.
- Open for later: the wave spawner and spawn points (Phase 6), the other archetypes and elite traits (Phase 5), a flow field if hordes outgrow the route graph (D-008), per-state rig poses beyond the reach pose, final models and animation (D-030), a proper HUD (health vignette, damage direction).

## D-043 — Phase 5 archetypes: the v1 roster (resolves O-3), the Runner, the Tank and the Screamer, composable traits, and a generic alarm event
**Status:** Accepted · **Date:** 2026-09-27 · **Implements:** plan §11 (Phase 5), §12, §15 (armored / protected-head / elite), D-012 · **Resolves:** O-3 · **Builds on:** D-041, D-042

**Context.** Phase 5 adds the rest of the v1 roster on top of the Phase 4 framework, plus the traits the adaptive system and BLOOD MOON will need (plan §15: "armored", "protected-head", "elite"). O-3 asked which four of the plan's five archetypes ship in v1. There are still no waves (Phase 6), no mutations (Phase 7) and no adaptive system (Phase 8).

**Decision.**

1. **O-3: the v1 default roster is Walker, Runner, Tank and Screamer. The Climber is deferred, as adaptive content.**
   - `DEFAULT_ROSTER` (config) lists the four; it is what `tls.spawnMixed` cycles through and what Phase 6's normal wave composition will draw from. The Climber is in neither the roster nor `IMPLEMENTED_ENEMY_IDS`, so it cannot be spawned (`enemyConfig('climber')` refuses: there is no data) and it will not appear in normal waves.
   - It stays in `ENEMY_ARCHETYPES` (`inV1: false`) with its purpose restated: it counters camping on high ground. The architecture keeps room for it: an archetype is data plus a behaviour, so adding it means its `EnemyArchetypeConfig`, a climbing behaviour (or an option of the melee one) and climb links in the level's navigation (D-008). Nothing generic needs to change.
   - **Later, the adaptive system (Phase 8) may bring the Climber in as a response to heavy high-ground use** (its "camping on high ground" metric), instead of it being part of every run. Nothing adaptive is built now.
   - Why: the Climber is the most expensive archetype (climb navigation, climb links, climb animation) and only matters against one play style. As a targeted response it keeps its purpose without costing every wave.
2. **Archetypes stay data plus a small set of behaviours (D-042 unchanged).** Phase 5 adds optional archetype fields rather than archetype code:
   - `staggerZones`: only damage to these zones counts toward a stagger (the Tank: head only).
   - `attack.lunge {distance, speed}`: a committed leap between the wind-up and the strike (the Runner).
   - `weave {angleDeg, period, minDistance, maxDistance}`: a zig-zag approach in the open at mid range (the Runner).
   - `preferredRange {min, max}`: the distance a ranged or support enemy keeps (the Screamer).
   - `ability {kind: 'scream', radius, alertDuration, haste}`: what its attack does instead of a strike (the Screamer).
   - There are two behaviours: `melee` (Walker, Runner, Tank; the options above switch parts on) and `screamer` (support). Both sit on `enemies/ai/common.ts` (perception and targeting, chase planning, path following, stuck checks, idle and patrol, alerts, stagger, attack cancelling), so every archetype shares the state machine, the 10 Hz decisions spread over the steps, the navigation and the combat hooks. No class or `if` names an archetype.
3. **Runner: pressure through movement.** It is fast (5.2 m/s: faster than the player walks, slower than the player sprints) and fragile (60 health: three Pistol body shots or one headshot; any body shot staggers it). It notices from further away (15 m). In the open at 4–12 m it **weaves** 35° either side of the direct line (the side alternates over time and is taken only if walkable), which makes it harder to track. Its attack starts from 3.2 m. After a short wind-up (0.4 s, the telegraph) it **leaps** 2.2 m along its locked facing at 9 m/s and strikes (10 damage). The leap is committed: side-stepping during the wind-up makes it miss. It stops early a body's width from the target and brakes hard on landing (it plants its feet instead of sliding on). A hit during the leap staggers it and cancels the attack.
4. **Tank: a slow wall that must be shot in the head.** 360 health, 1.1 m/s, a slow turn. Body shots do half, limbs a third, and **only head damage staggers it** (`staggerZones: ['HEAD']`, threshold 60): one Pistol headshot. It takes six headshots, or about 28 body shots, to kill. It hits for 35 after a long 1.1 s wind-up, with a wide arc and 2.4 m reach. It has no ranged attack. Its bigger body (radius 0.5 m) still fits every route link in the facility (tested). Future resistances are data (`resistance`, `armor`, `zoneArmor`), not Tank code.
5. **Screamer: support that disrupts, never damages.**
   - **Positioning:** it closes in when it cannot see the target or is beyond `preferredRange.max` (11 m), backs away (to a walkable point 3 m away, straight back or angled up to 90°) when the target is inside `preferredRange.min` (6 m), and otherwise holds its ground facing the target.
   - **Ability:** with the target in sight within 14 m and its cooldown ready, it raises its arms and glows violet for 1.2 s (the telegraph, readable at range), then screams, then recovers for 1 s. The cooldown (10 s) is spent when the scream starts, so interrupting it (any hit ≥ 25 staggers it) wastes the scream, and the next one is still a full cooldown away.
   - It deals no damage itself. What the scream does is up to whoever listens to its alarm.
6. **The alarm: one generic event for "the enemies are being called".**
   - The screamer brain emits `alarm` on the enemy event bus: `{sourceId, kind: 'scream', position, radius, targetId, targetPosition, alertDuration, haste {multiplier, duration} | null, time}`. Nothing in the payload needs a listener to know a Screamer raised it; `kind` names the cause for presentation and can grow (a siren objective, a mutation) without new event types.
   - **Prototype response (in `EnemyManager`, testable):** every other living enemy within the radius (and within half the radius in height) is told where the target is for `alertDuration` (8 s), and, if the alarm carries haste, moves faster for its duration (×1.35 for 6 s; a repeat refreshes it and does not stack). Each emits `hasted`. Any code may emit an alarm and get the same response.
   - **Presentation:** an expanding violet shockwave ring at the source (`EnemyView`, a pool of four), and a violet screen-edge pulse with a short shake when the player is within the radius (`ui/AlarmPulse`, simulated time, so it holds while paused).
   - **Later consumers need no Screamer dependency:** the wave manager can spawn reinforcements toward an alarm, SCREAM (a mutation) can emit alarms on its own, the adaptive system can count them, and audio and VFX react to `kind`. There is no dependency on a WaveManager or mutation system now.
7. **Traits: data overlays that compose, on any archetype (plan §15, D-012).**
   - `config/traits.ts` defines three traits, each a set of optional overlays: health, speed, damage, stagger-threshold and threat multipliers; flat armor per zone; breakable plates; bonus drop tables.
     - **Armored:** +10 armor on the torso and +6 on each limb (none on the head), 0.9× speed, 1.5× threat. It punishes spraying the body and rewards headshots.
     - **Helmeted:** a helmet over the head (a breakable plate with 50 durability) that absorbs headshot damage until it breaks. Breaking it staggers the wearer and emits `armorBroken`; after that, headshots land in full. 1.3× threat.
     - **Elite:** 1.6× health, 1.1× speed, 1.3× damage, 1.5× stagger threshold, 2.5× threat, and a bonus `elite` drop (always an ammo pickup).
   - `applyTraits(base, traits)` is pure. It folds the traits into the archetype in canonical order whatever order they were given in; duplicates count once. Multipliers multiply, per-zone armor adds up, and plates and bonus drops are collected. Unknown traits throw. The result, `EnemyConfig`, is what an enemy reads everywhere (stats, speed, combat profile, drops, view attachments). The archetype definition is never changed.
   - **Run time:** `EnemyManager.setTraits / addTrait / removeTrait` swap an enemy's config. Health keeps its fraction; a plate still worn keeps its damage (a broken helmet stays broken); the combat profile is updated at once (`CombatSystem.configure`); `traitsChanged` is emitted. A pooled enemy starts its next life with only the traits it is spawned with: whole plates and no haste.
8. **Combat: mitigation through a generic `DamageProfile` (D-041 extended, no per-archetype code).** A target's profile is its zone multipliers, flat `armor`, `zoneArmor`, `plates`, `resistance`, `staggerThreshold` and `staggerZones`, set at registration and changeable with `configure(id, profile)`.
   - The order of a hit is: `computeDamage` (with the armor for that zone: `armor + zoneArmor[zone]`), then plates covering the zone absorb what they can (`ArmorPlate`, `combat/armor.ts`), then health.
   - `damaged` now also reports `armorReduction` and `absorbed`, and the hit marker shows a steel "armored" marker when a hit was mitigated (and did not kill).
   - Stagger only counts damage to `staggerZones` when set. A plate with `staggerOnBreak` staggers its wearer when it breaks, unless the blow killed.
   - Direct damage (debug, hazards) ignores armor and plates.
9. **Separation and posture fixes that mixed crowds exposed.**
   - Push distance is the larger of the rule's distance and both bodies' radii plus 0.1 m (a Tank needs more room).
   - Two bodies closing on each other push apart **earlier and harder**: the room grows by their closing speed × `separationAnticipation` (0.5 s), and the push by the closing speed × `separationSpeedFactor` (1.5). A body cannot brake or turn instantly (acceleration limits), so the push has to start before the overlap. With the flat Phase 4 push, a sprinting Runner ran straight through an oncoming enemy (its centre passed within 0.2 m of the other's); now it steers round every archetype head-on (tested). Slow crowds, which barely close on each other, are almost unaffected.
   - The push is applied in m/s relative to the body's current top speed (haste and a leap included).
   - A Runner's or Tank's resting lean is **part of its hitbox rig** (`leanRig`: head, torso and arms turned about the hips), not only of its drawing. The drawn body is built from the rig, so what is drawn is what is hit. When it was drawn only, the Runner's visible head sat about 0.2 m ahead of its hit sphere.
10. **Presentation (placeholders).**
    - Each archetype is drawn from its own rig with its own palette (`config/enemyLooks.ts`):
      - Runner: slighter, leaning, red eyes, amber telegraph.
      - Tank: huge, dark, a lighter head so the weak point stands out, red telegraph.
      - Screamer: tall and thin with a big pale head and a gaping mouth, violet eyes and telegraph; it raises its arms to scream.
    - Traits change the outline, so they read without colour: chest, back and shoulder plates (Armored), a steel dome that disappears when it breaks (Helmeted), bone spikes on the shoulders and spine and pale eyes (Elite).
    - Attachments are built into the enemy's single skinned mesh. Geometry is cached per archetype and set of attachments, so an enemy is still one draw call plus one shadow draw.
11. **The test encounter shows the roster.** Five placements: a Helmeted Walker and an Armored Tank as sentries, a patrolling Runner, a Screamer by the north wall, and a patrolling Elite Walker. Each is beyond its own detection range (plus patrol radius) from the spawn, and each comes back after its body is removed. Temporary, until the wave system.
12. **Debug (development only).**
    - Spawning: `spawnEnemy(type?, distance?, traits?)` (all four archetypes) and `spawnMixed(count?, distance?, traits?)` (cycles the roster).
    - Traits: `traits()`, `setTraits(id, traits)`, `applyTrait(id, trait)`, `removeTrait(id, trait)`.
    - Ability: `forceAbility(id)` (use the attack or scream now, ignoring the cooldown).
    - Inspection: `enemies()` and `enemy(id)` now include traits, haste, plates and the effective stats.
    - The `showAI()` label adds traits and HASTE and carries `data-archetype`, and a violet ring shows the ability radius.

**Why.**
- Every archetype plays differently through existing systems. The Runner changes when and from where the player must shoot; the Tank changes where; the Screamer changes what to shoot first. There is no new AI architecture, no per-archetype damage code, and one timeline per fight (deterministic, tested).
- Traits as data overlays give the adaptive system and BLOOD MOON "armored", "protected-head" and "elite" enemies on any archetype without new classes, and they compose predictably.
- A generic alarm keeps the Screamer small and gives Phases 6–8 a hook they can emit and consume without knowing about each other.

**Consequences.**
- Balance values for the four archetypes and three traits are logged in BALANCING.md §2.7–2.10.
- Measured costs at 64 mixed enemies (TESTING.md §7.4, on a slower host than Phase 4's):
  - Simulation: 1.27 ms per step headless, against 1.15 ms for 64 Walkers in the same run.
  - Browser: the same frame cost as 64 Walkers and the same 144 draw calls; each enemy is still one mesh, and traits add triangles, not draw calls.
- Open for later:
  - the Climber (as adaptive content, with climb links);
  - reinforcements toward an alarm (Phase 6) and SCREAM (Phase 7);
  - Elite visuals beyond placeholders;
  - audio for the scream and the helmet (Phase 11);
  - distance-based think rates if hordes need them;
  - body blocking of the player (still none).

---

## D-044 — Phase 6 wave system: budget curve, seeded composition, fair spawn points, the wave cycle and slots for mutations, bosses and adaptation
**Status:** Accepted · **Date:** 2026-09-28 · **Implements:** plan §13 (Phase 6), GAME_DESIGN §3, §8 · **Applies:** O-5 (default), D-024, D-026, D-029, D-043 · **Notes:** O-7 for Phase 7

**Context.** Until Phase 5 a run was a placeholder: one open-ended `WAVE_ACTIVE` with a fixed test encounter and the training dummies. Plan §13 asks for waves with `waveNumber, enemyBudget, spawnRate, enemyComposition, mutation, specialEvent, bossFlag`, a controlled difficulty curve (1–3 introduction, 4–7 variety, 8–12 pressure, 13–19 complex, 20 boss / major event) instead of ever-growing health, and support for unlimited waves. Mutations (Phase 7), the Adaptive system (Phase 8), upgrades and currencies (Phase 9) and bosses (Phase 13) do not exist yet, but each needs a place to plug in. The Climber must stay out of normal waves (D-043).

**Decision.**

1. **Modules (`src/waves/`, all simulation, all headless-testable).**
   - `WaveDifficulty` (pure): the curves as functions of the wave number (budget, max alive, spawn rate, group size, tier, unlocks, caps, trait chances, Elite limit). Defined for any wave number; out-of-range input is clamped to wave 1.
   - `WaveGenerator` (pure, seeded): `generateWave(n, {seed, modifiers, mutation, roster})` → a `WaveDefinition` with the plan's fields plus `tier`, `theme`, `finale`, `boss`, an ordered `spawns` list (archetype, traits, cost), `budgetSpent`, `groupSize`, `spawnBias` and the applied `modifiers`.
   - `WaveMutation`: the selection slot (D-024). Returns `null` in Phase 6.
   - `SpawnDirector`: picks a fair spawn point for a group and places its members.
   - `WaveManager`: the runtime. It drives the state machine, paces spawns, detects completion, runs the breather, victory and endless, moves stragglers, answers alarms, and owns `WaveEvents` and `RunStats`.
   - All numbers live in `config/waves.ts` (`WAVE_RULES`), and spawn points in the level data (`FACILITY.spawnPoints`, D-013).
2. **Difficulty through budget, composition, traits and concurrency, never health (no HP scaling on waves 1–20).**
   - Threat budget: `B(n) = round(6 + 2.2(n−1) + 0.08(n−1)²)` up to wave 20 (6, 8, 11, … 72, 77), then +5.2 per wave.
   - Concurrency: at most `min(24, 5 + n)` wave enemies alive; after wave 20, `min(32, 24 + ⌊(n−20)/5⌋)`. This stays under the enemy manager's hard cap of 64.
   - Spawn rate: `min(2, 0.5 + 0.05n)` enemies per second while under the cap.
   - Groups: 1 to `min(4, 1 + ⌊n/6⌋)` enemies (+1 on ambush waves).
   - Traits: Armored and Helmeted from wave 8 (+4% per wave, at most 25% each). Elite from wave 13 (+3% per wave, at most 12%), with at most 1 Elite per wave on waves 13–15, 2 on 16–19, 3 on wave 20, and `1 + ⌊n/8⌋` in endless.
   - The tested time-to-kill intents (BALANCING §2.6–2.10) therefore stay true at every wave. Endless health scaling is deferred (capped if ever added).
3. **Composition (seeded per run and wave; `${runSeed}:wave:${n}`).**
   - **Themes** (GAME_DESIGN §8): `intro` on waves 1–3; a rotation of `mixed / swarm / heavy / ambush` from a seeded start (never the same theme twice in a row); `finale` on wave 20.
   - **Unlocks:** Walker from wave 1, Runner from 3, Screamer from 4, Tank from 6. Only `DEFAULT_ROSTER` archetypes are drawn.
   - **Weights** = tier base × theme multiplier × the product of modifier weights (clamped to [0.5, 2]).
   - **Caps:** Screamers `1 + ⌊(n−4)/5⌋`, Tanks `1 + ⌊(n−6)/4⌋`.
   - **Guarantees:**
     - An archetype's first wave has exactly one of it (a readable introduction).
     - Walkers are at least 30% of the budget.
     - The finale has at least 2 Tanks and 2 Screamers.
   - **Fill:** draw an affordable archetype, roll its traits (a trait that makes it unaffordable is dropped), pay its trait-adjusted threat cost (`applyTraits`), and finish with Walkers. The spend is always within 1 of the budget (tested).
   - **Order:** a seeded shuffle, then Tanks and Screamers are kept out of the first 15% of spawns so a wave opens readably.
4. **The Climber cannot appear in normal waves.**
   - Only roster archetypes are drawn.
   - `extraArchetypes` are accepted only from `source: 'adaptive'` modifiers, only for implemented archetypes, and at most two per wave. The Climber is not implemented.
   - Tested over waves 1–200 × 30 seeds, with and without modifiers from every source.
5. **Spawning (`SpawnDirector`).**
   - The facility declares 13 spawn points, each with a compass region; the catwalk point is tagged `elevated` and reserved for adaptive content.
   - A point is eligible when all of these hold:
     - it is at least 12 m from the player (horizontally);
     - the player cannot see it, i.e. it is outside the view cone (half the horizontal FOV + 15°) **or** a wall blocks the line from the eye to head height at the point;
     - every member of the group can stand around it: the point plus a ring of six slots 1.2 m out, each walkable from the point.
   - The draw is weighted:
     - full weight at 16–30 m, less outside that band;
     - ×0.3 for the points of the last two groups;
     - ×2 for favoured regions.
   - With no eligible point, the group waits and retries every 0.5 s. After 3 s the view rule is relaxed (never the distance), and this is counted in the stats.
   - Spawned enemies know where the player is (`alertTo`, the horde is drawn to the signal) and do not patrol. They spawn facing the player.
6. **The wave cycle (fixed-step timers; nothing moves while paused).**
   - `PLAYING` (a new run) → `startRun()`: wave 0, fresh stats, fresh streams (`${seed}:run:${k}`).
   - `WAVE_START`: generate the wave, reserve the pools, prewarm the looks (no first-spawn hitch), announce the wave, and wait out a 3 s intro. Then `WAVE_ACTIVE` (or `BOSS` when `bossFlag` is set, which Phase 13 will do).
   - `WAVE_ACTIVE`: the first group arrives 2 s in, then groups follow at the spawn rate under the concurrency cap. The wave completes when the queue is empty and no wave enemy is alive. Debug spawns and sandbox enemies never count.
   - `WAVE_COMPLETE`: on the final wave (not endless) → `VICTORY`, with the cursor released and a "Signal transmitted · Wave 20 cleared" prompt. Otherwise a 10 s breather → `UPGRADE_SELECTION`.
   - `UPGRADE_SELECTION`: passes straight through to `WAVE_START` until Phase 9.
   - Death is unchanged (`GAME_OVER`); the prompt now names the wave reached.
   - Health persists between waves with no healing (GAME_DESIGN §4.2), and D-029 still applies: no damage in the intro or the breather.
7. **Alarms and stragglers.**
   - **Alarm (a Screamer's scream) during `WAVE_ACTIVE` with enemies still queued:** the next group is pulled forward (it spawns now) and favours the region of the spawn point nearest the alarm. It adds no budget: extra enemies are a mutation's business (SCREAM, HIVE).
   - **Stragglers:** with the queue empty, ≤ 2 wave enemies left, and no wave enemy dying or hurt for 40 s, each one farther than 25 m is moved to a fresh eligible point, keeping its traits. A wave cannot stall on a stuck body.
8. **Slots for later phases.**
   - **Mutations (Phase 7):** `selectMutation` fills `definition.mutation` (waves 1–3 stay mutation-free, O-7). A mutation's composition effects arrive as a `CompositionModifier` with `source: 'mutation'`, the only source allowed a (clamped, ×0.5–1.5) `budgetMultiplier`.
   - **Adaptive (Phase 8):** `WaveManager` takes `modifiers()` and hands them to the next `generateWave`. Archetype weights, trait chances (±0.2) and spawn bias are clamped. Adaptation never changes the budget (D-026). The applied modifiers are carried in the definition for the "SIGNAL ANALYSIS" line.
   - **Bosses (Phase 13):** `definition.boss` / `bossFlag` and `WAVE_START → BOSS`. In Phase 6, wave 20 is a `finale` normal wave (the largest budget, guaranteed heavies).
   - **Rewards (Phase 9):** `waveCompleted {wave, duration, kills, stats}`, `died` now carries the enemy's traits, and `RunStats` (kills per archetype, Elite kills, headshots, damage taken, wave times) are what XP and Scrap will read. No currency is added now.
9. **O-5 (default applied):** a standard run ends in victory after wave 20. `?endless=1` (or `tls.setEndless(true)`) keeps going with the endless tail of every curve. A menu option comes with the UI phase.
10. **The Phase 3–5 sandbox leaves normal play.** The training range, the test encounter and the one open-ended wave are kept behind `?sandbox=1` (any build) for manual testing and the Phase 2–5 end-to-end specs.
11. **Presentation (placeholders):** `WaveHud` shows "WAVE 7 · 12 LEFT" (queued + alive) top-left, a "WAVE 7" banner during the intro and "WAVE 7 CLEARED · NEXT WAVE IN 8" during the breather. `LockPrompt` gains a `victory` mode and shows the wave reached.
12. **Debug (development only):**
    - Wave control: `startWave(n)` (replaces the Phase 0 stub), `completeWave()`, `skipWaveTimer()`, `wave()`, `setEndless()`, `pauseSpawning()`, `runStats()`.
    - Planning: `previewWave(n, seed?)`, `waveTable(from?, to?)`.
    - Spawn points: `spawnPoints()` (the status of each for the current view) and `showSpawns()` (coloured rings: green eligible, red in view, orange too close, grey no room, violet reserved).
    - An overlay line: `wave 7 WAVE_ACTIVE 12 left · queued 8 · alive 4/12`.

**Why.**
- A budget in threat points (with traits folded into each enemy's cost) makes waves comparable, however they are composed. The curve, caps and guarantees keep them readable and escalating without health inflation, and the seeded generator makes every wave reproducible for tests, balancing and bug reports.
- Authored spawn points with a view-and-distance rule are cheap (evaluated only when a group is due), predictable to design around and fair: nothing appears in the player's face or in plain sight.
- One modifier channel, with every value clamped and the budget protected, lets mutations and adaptation shape waves without owning them (D-024, D-026) and makes "no Climber" a property that can be tested.

**Consequences.**
- Balance values are logged in BALANCING.md §2.14.
- Measured costs are in TESTING.md §7.4.
- Open for later:
  - endless health scaling (if ever);
  - a wave-clear heal if runs prove too short;
  - more spawn points per level with the Phase 10 facility;
  - a real boss on wave 20 (Phase 13).

---

## D-045 — Phase 7 Signal Mutations: six v1 mutations as data, one effect runtime, DEATH CRY kept apart from the Screamer, and guardrails
**Status:** Accepted · **Date:** 2026-09-29 · **Implements:** plan §14 (Phase 7), GAME_DESIGN §9 · **Resolves:** O-4, O-7 · **Updates:** O-10 · **Applies:** D-009, D-014, D-022, D-024, D-026, D-028, D-029, D-043, D-044

**Context.** Plan §14: "Every normal wave receives one mutation… Mutations modify gameplay rules… must be data-driven. Do not hard-code them directly into WaveManager." Phase 6 left the slots (`selectMutation` returning `null`, `WaveDefinition.mutation`, the `source: 'mutation'` composition channel, an empty catalogue, the `tls.triggerMutation` stub). Nothing could yet apply a stat, trigger, environment or screen effect: the scene had two lights and no point lights, enemy eyes were not emissive, the muzzle flash was unlit. Three things had to stay separable for the player: the Screamer's scream (an archetype ability, D-043), the SCREAM mutation, and the future Adaptive system (Phase 8).

**Decision.**

1. **O-4 resolved: six mutations ship in v1.**
   - Enabled: BLACKOUT, HUNGER, STATIC, SCREAM (shown to the player as **DEATH CRY**), HIVE and BLOOD MOON.
   - Deferred: LOW GRAVITY and OVERLOAD. They stay in the catalogue with full effect data (`status: 'deferred'`) but their stat target (`world.gravity`, `weapon.recoil`) and trigger action (`environmentPulse`) are not registered. The effect router refuses them atomically and the selector and debug tools never offer them. Enabling one later = register its target or action, flip `status`.
2. **O-7 resolved: when mutations happen.**
   - Waves 1–3: none. Wave 20: none (finale / boss rules).
   - Every other wave, endless included: exactly one.
3. **Data model (`config/effects.ts`, `config/mutations.ts`, `config/environment.ts`).**
   - A typed `Effect` union with the five D-009 kinds: `stat {target, op, value}`, `trigger {on, action, params}`, `spawnRule {composition?, surges?}`, `environment {overlay, priority, fadeIn, fadeOut}`, `screen {effect: 'static', params}`.
   - A mutation is `{id, name, rule, hint, status, minWave, weights per tier, group?, accent, effects}`. `name`, `rule` and `hint` are what the player reads.
   - Environment overlays are channel presets (`ambient, sun, tint, tintAmount, fog, emergency, eyeshine, muzzleLight`) over a base.
   - Levels declare their emergency light fixtures (`LevelDefinition.lights`; three in the facility).
4. **One effect runtime (`src/modifiers/`, simulation).**
   - `StatRegistry`: modifiers per registered stat and source, `value = override ?? (base + Σadd) × Πmul`. Unknown stat → error.
   - `TriggerRegistry`: event → named action. Unknown action → error.
   - `ScreenEffects`: the STATIC burst schedule, seeded, in simulated time.
   - `Environment` (`src/world/`, D-028): a base plus prioritised overlays that fade in and out in simulated time, then visibility floors.
   - `EffectRouter`: `apply(sourceId, effects, {kinds})` / `remove(sourceId, {kinds, immediate})`. Apply is atomic (everything validated first) and clamps every value again, whatever the data says.
5. **Selection (`waves/WaveMutation.ts`, pure, D-024).**
   - Pool: enabled mutations whose `minWave` has come (HUNGER, BLACKOUT 4; SCREAM 5; STATIC 6; HIVE 7; BLOOD MOON 9) with a weight for the wave's tier.
   - Never the previous wave's mutation; never two `vision` mutations (BLACKOUT, STATIC) back to back unless nothing else is left.
   - Weighted draw, ×0.35 for a mutation used in the last 3 waves, from the stream `${runSeed}:mutation:${n}` (D-014).
   - The history is the run's played sequence (kept by `WaveManager`); `mutationSchedule(seed, to)` previews it and matches normal play (tested).
6. **Application (`signal/SignalMutationSystem.ts`), keyed by source id `mutation:<ID>`.**
   - `WAVE_START`: announce (card and badge) and apply the **environment** effects, which fade in over the 3 s intro.
   - `WAVE_ACTIVE`: apply **stat, trigger and screen** effects. Nothing that changes play acts during the announcement.
   - `WAVE_COMPLETE`: lift everything; the lighting fades back over 2 s of the breather.
   - `GAME_OVER`: stats, triggers and screen effects removed; the lighting is left as it was behind the prompt.
   - `VICTORY`, `MAIN_MENU`, a new run: everything removed at once.
   - `PAUSED`: nothing runs (push-down state, no fixed steps), so fades and bursts freeze.
   - Composition effects (`spawnRule`) never pass through here: `generateWave` reads them from the data, so previews, debug jumps and play build the same wave.
7. **The six mutations (values in BALANCING §2.15).**
   - **BLACKOUT:** environment overlay. Ambient ×0.3, sun ×0.12, red emergency lights on, the muzzle flash lights the scene, enemy eyes glow. Fog distance unchanged.
   - **HUNGER:** `enemy.moveSpeed` and `enemy.acceleration` ×1.2. An enemy is never pushed above max(its own speed, 0.9 × the player's sprint = 6.75 m/s); the Runner's lunge and the landing brake are unaffected.
   - **STATIC:** a screen burst every 6–10 s for 0.4–0.7 s, at most 26 % opaque; the first ≥ 4 s into the wave.
   - **DEATH CRY:** every death raises a small alarm (see 8).
   - **HIVE:** budget ×1.3 (mutation-owned, clamped ≤ 1.5) and two announced surges at 40 % and 75 % of the queue.
   - **BLOOD MOON:** Elite chance +0.15, Elite limit +1 (+1 more every 5 waves after 9, at most +3), at least one Elite (Walkers promoted inside the same budget), and a red sky.
8. **Screamer vs DEATH CRY vs Adaptive (the overlap).**
   - `AlarmEvent` gains `kind: 'scream' | 'deathCry'` and `reinforcements`.
   - The Screamer's scream: `reinforcements: true`, 18 m, violet ring and screen pulse; the `WaveManager` pulls the next group forward (unchanged, D-043/D-044).
   - DEATH CRY: `reinforcements: false`, 8 m, alert 6 s, haste ×1.2 for 2.5 s, a small **red** ring at the body, no screen pulse, **never** reinforcements. Haste from either keeps the larger value; it never stacks.
   - Adaptive (Phase 8) changes composition between waves only, never raises alarms, never picks or suppresses mutations, and is explained after a wave ("SIGNAL ANALYSIS"). A mutation is always announced before its wave and badged during it. `RunStats` records each wave's mutation so adaptive metrics can discount mutation-caused events.
9. **Generator integration (D-026 kept).**
   - The mutation's composition arrives as a `CompositionModifier` with `source: 'mutation'` next to the adaptive ones, under the existing clamps.
   - New mutation-only fields: `eliteMaxBonus` (≤ 3), `eliteMinimum` (≤ 2), `surges` (≤ 3 surges, +2 group size, groups ≤ 6, warning 1–4 s). Ignored from any other source.
   - A mutation never changes `maxAlive`, the spawn rate, the spawn distance or view rule, the D-029 damage window, unlocks, or the roster.
10. **Surges (HIVE, executed generically by `WaveManager`).** When the queue reaches a surge point, a fair spawn point is chosen and announced (`surgeWarning {region, pointId}`; "HIVE SURGE · EAST" with an arrow). After the warning the group spawns there, or in that region if the point is no longer fair, with `min(size, queued, room)` members: never above `maxAlive`, never breaking spawn rules.
11. **Presentation (D-022: no light is ever added at runtime).**
    - Three emergency `PointLight`s and one muzzle `PointLight` exist from load at intensity 0; `LightingController` changes only intensities, colours, fog and background, so no shader recompiles (the browser test checks the program count).
    - `MutationHud`: an intro card (name, rule, counter-play hint), a badge for the whole wave (`◆ BLACKOUT`, `· ELITES ×N`, flicker with each STATIC burst), `BLACKOUT LIFTED` in the breather, and the surge cue.
    - `StaticOverlay`: a DOM layer directly above the canvas and below every HUD element, with a clear centre, ≤ 3 Hz jitter, none with `prefers-reduced-motion`, no pointer events.
    - The game-over prompt names the mutation ("Wave 7 · Blackout").
12. **Guardrails (checked by data tests and enforced again at runtime).**
    - Speed ×0.5–1.25 with the sprint cap; budget ≤ 1.5; alarms ≤ 10 m, haste ≤ 1.25 for ≤ 3 s, never reinforcing; ambient ≥ 0.25 and eyeshine ≥ 0.1 in the dark; STATIC ≤ 0.35 opaque, ≤ 0.8 s bursts, ≥ 5 s apart; fades ≤ 5 s.
    - A balance tripwire: a scripted headless defender (no god mode) clears waves 6, 9 and 12 under every mutation and takes at most 1.6× the unmutated damage + 20.
13. **O-10 updated: no flashlight in Phase 7.** BLACKOUT is playable with the emergency lights, the muzzle light and eyeshine. Revisit after a hands-on playtest.
14. **Debug (development only):** `mutation()`, `mutations()`, `triggerMutation(id)` (replaces the stub), `startWave(n, id?)`, `clearMutation()`, `setMutations(bool)`, `mutationSchedule(from?, to?, seed?)`, `staticBurst()`, and an overlay line (`mutation STATIC active · burst in 3.2 s`).

**Why.**
- One typed effect vocabulary with one runtime keeps mutations as data, and the same runtime will carry upgrades (Phase 9) and signal events (Phase 12).
- Splitting announcement (environment) from activation (play-changing effects) keeps D-029's promise that the intro and breather are safe, and lets the player read the rule before it acts.
- Separate alarm kinds with separate looks make it always clear whether a zombie or the wave rule caused a rush.
- Clamping twice (data tests and runtime) means a typo in the catalogue cannot make a wave impossible.

**Consequences.**
- Balance values: BALANCING §2.15. Measured costs: TESTING §7.4.
- Open for later: the mutated-wave reward bonus (Phase 9), mutation audio (Phase 11), LOW GRAVITY and OVERLOAD, a flashlight (O-10).

---

## Open questions

None of these block Phase 0. Each lists the phase that needs the answer and the default that applies if there is no answer.

| ID | Question | Needed by | Recommendation (default) |
|---|---|---|---|
| **O-1** | What does XP buy, and does unspent Scrap buy anything persistent? (**Partly answered by D-039:** Scrap is the purchase currency at the Supply Terminal between waves.) | Phase 9 (Progression) | XP → profile level that unlocks new cards and purchasable weapons; unspent Scrap does not carry over between runs |
| ~~**O-2**~~ | ~~How does the player get the Assault Rifle and Shotgun during a run?~~ **Resolved 2026-09-26 → D-039:** loadout of Melee (Bare Hands), Primary (Pistol) and Secondary (locked); weapons bought with Scrap at the Supply Terminal between waves | — | — |
| ~~**O-3**~~ | ~~Which 4 of the 5 archetypes ship in v1 (plan §12 lists 5, §42 targets 4)?~~ **Resolved 2026-09-27 → D-043:** Walker, Runner, Tank and Screamer are the default roster; the Climber is deferred and kept as possible adaptive content (a response to high-ground camping), not part of normal waves | — | — |
| ~~**O-4**~~ | ~~Which 6 of the 8 mutations ship in v1?~~ **Resolved 2026-09-29 → D-045:** BLACKOUT, HUNGER, STATIC, SCREAM (shown as DEATH CRY), HIVE and BLOOD MOON; LOW GRAVITY and OVERLOAD deferred but kept representable in data | — | — |
| **O-5** | Boss placement, and what "unlimited waves" means next to a wave-20 victory. | Phase 6 / Phase 13 | Siren at wave 20 (final); the generator supports unlimited waves; endless mode after victory is a later nice-to-have. (**Default applied by D-044:** victory after wave 20; the generator and every curve are defined for any wave; `?endless=1` continues past 20; the boss itself is Phase 13.) |
| **O-6** | The controls lack **interact**, and no **utility/trap** system exists, yet Technician and signal objectives depend on them. (**Melee answered by D-039:** always-available quick melee, default key V.) | Phase 12 (interact) | Interact = E. Keep Technician out of the pool until a utility item is designed |
| ~~**O-7**~~ | ~~"Every normal wave receives one mutation" (§14) vs "mutations become noticeable at 10–15 min" (§33).~~ **Resolved 2026-09-29 → D-045:** waves 1–3 mutation-free; one on every other wave (endless included); none on wave 20 (finale / boss rules) | — | — |
| **O-8** | Where do the 3D models, animations, sounds and music come from, and under what licences? | Milestone 2 (first real assets) | CC0 sources (e.g. Kenney, Quaternius, CC0 sound libraries), with a CREDITS file; blockout until then (D-030) |
| ~~**O-9**~~ | ~~What is the reference "weaker supported hardware" for the 30 FPS floor?~~ **Resolved 2026-09-25 → D-037:** i5-4440, 16 GB DDR3-1333, GTX 750; ~30 FPS at 1080p Low; ~60 FPS on capable hardware at High | — | — |
| **O-10** | Does BLACKOUT need a player flashlight? (**Updated by D-045:** no flashlight in Phase 7; BLACKOUT relies on emergency lights, the muzzle light and enemy eyeshine.) | After a hands-on playtest | A simple toggle (F) using one of the ≤2 shadow-casting light slots, only if playtests show BLACKOUT is frustrating |
| **O-11** | Project licence (code) and asset licence policy. | Before any public release | Decide before the first public deployment |
| **O-12** | Are signal objectives mandatory to progress, or optional but rewarded? | Phase 12 | Optional but rewarded: the phase advances with wave number; objectives add signal strength and rewards (no soft-locks) |
| **O-13** | How is the Supply Terminal presented (a screen in the between-wave flow, or a terminal in the facility reached with Interact), and what unlocks the Secondary slot (a wave / signal milestone, an XP level, or a Scrap purchase)? | Phase 9 (Progression) / Phase 14 (Economy) | A terminal-styled screen right after the upgrade choice (time stays frozen, no walking between waves); Secondary unlocks at the first signal milestone (end of wave 5, "components collected") |
