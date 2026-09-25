# Progress — THE LAST SIGNAL

> The working state of the project. Every session reads this file first and updates it last, so
> work can be resumed safely (plan §36).
>
> **Last updated:** 2026-09-25 · **Base branch:** `main` · **Working branch:** `claude/bold-mayer-n66vhb`
> (open PR into `main`: yusuf-mo-ali/The-Last-Signal#1)

---

## Current Phase

**Phase 0: Project Foundation.** Steps 0.1 (toolchain), 0.2 (core primitives), 0.3 (render foundation) and 0.4 (input) are complete; step 0.5 has not started.

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

## Active Task

None. Waiting for approval to start **Phase 0.5**.

## Known Bugs

None.

## Next Task

**Phase 0.5: Config, debug, errors**:
- `core/Config.ts`, with the render/camera/loop defaults moved into it.
- `src/config/` type skeletons.
- `debug/`: a dev-only dynamic import, `window.tls` command stubs, and an FPS/frame-time overlay replacing the `__TLS_DEV__` handle.
- `core/ErrorHandler`: global errors, WebGL missing, and context lost/restored.

Details are in the Phase 0 plan below.

**Deferred on purpose:**
- **From 0.2:** state-scoped timers and the `GameEvents` payload map arrive with the first system that needs them.
- **From 0.3, planned for 0.5:** moving the render and camera defaults into `core/Config.ts`, handling WebGL context loss and restore, and the full error screen that replaces the plain "WebGL 2 unavailable" message.
- **From 0.4:**
  - Mouse look and a pre-step hook in `Game` (Phase 1).
  - A `beforeunload` confirmation during a run (with the run lifecycle).
  - Sensitivity and invert-Y settings (settings phase).
  - Replacing `LockPrompt` with the pause menu (UI phase).

## Blocked Tasks

Nothing is blocked now. These later tasks need decisions (full list in `DECISIONS.md` → Open questions):

| Task | Blocked on | Needed by |
|---|---|---|
| In-run weapon acquisition | O-2 | End of Phase 2 |
| Melee action; Heavy Hands upgrade | O-6 (melee binding) | Phase 2 / Phase 9 |
| Technician upgrade | O-6 (no utility/trap system defined) | Phase 9 |
| Performance acceptance (30 FPS floor) | O-9 (reference hardware) | Phase 1 baseline |
| v1 zombie roster | O-3 | Phase 5 |
| v1 mutation set; intro waves without mutations | O-4, O-7 | Phase 7 |
| XP/Scrap sinks (meta-progression screen) | O-1 | Phase 9 |
| Signal objective rules; interact binding | O-12, O-6 | Phase 12 |
| Real art and audio | O-8 | Milestone 2+ |
| Public release | O-11 (licence) | Before first public deployment |

---

## Phase 0 plan: Project Foundation

Each step is one small commit (plan §37). Every step must end with typecheck, lint and tests passing.

| Step | Scope | Acceptance |
|---|---|---|
| **0.1 Toolchain scaffold** ✅ | `package.json` (npm; Node ≥22.12 engines). Dependencies: `three@0.186.1`; dev dependencies from D-002. `tsconfig.json` (strict, `noUncheckedIndexedAccess`, `noImplicitOverride`, `verbatimModuleSyntax`, `erasableSyntaxOnly`). ESLint flat config (typescript-eslint type-checked plus the layer import rules from ARCHITECTURE §2). Prettier, Vitest, `.gitignore`, `.nvmrc`, `.editorconfig`. `index.html` and a minimal `src/main.ts`. Scripts: `dev`, `build`, `preview`, `typecheck`, `lint`, `format`, `test`. | `npm ci`, `typecheck`, `lint`, `test` and `build` all pass. `npm run dev` serves a page with no console errors |
| **0.2 Core primitives** ✅ | `EventBus` (typed), `Time` (fixed-step clock, time scale), `GameState` (12 states, hierarchy, pause stack, transition table), `utils/Rng` (seeded), `utils/Pool` | Unit tests cover every legal and illegal transition, pause/resume restoring the child state, and event ordering and re-entrancy |
| **0.3 Render foundation** ✅ | `render/Renderer` (WebGL2 check, DPR cap, resize), `core/Game` bootstrap and fixed-step loop (ARCHITECTURE §3), test scene (floor, boxes, light), camera | Stable loop; resize correct at 1366×768–1920×1080 and smaller; no console errors |
| **0.4 Input** ✅ | `input/InputManager` (key `code`s, mouse buttons, wheel), pointer lock wrapper (D-017), `config/input.ts` default bindings, blur/visibility → pause hook | Input verified with the debug overlay; pointer lock acquire, lose and re-acquire works |
| **0.5 Config, debug, errors** | `core/Config.ts`, `src/config/` type skeletons, `debug/` (dev-only dynamic import, `window.tls` stub, FPS counter overlay), `core/ErrorHandler` (global errors, WebGL missing, context lost) | Production build contains no debug code (bundle checked); a forced error shows the error screen |
| **0.6 Verify and document** | `TESTING.md` (strategy plus manual QA checklist). Optional Playwright smoke test (loads, renders, no console errors). Update `PROGRESS.md` and `ARCHITECTURE.md` | Every Phase 0 acceptance criterion in plan §7 is met and recorded |

Plan §7 acceptance criteria: launches; no TypeScript errors; no console errors; stable rendering loop; resize works; input works; state transitions are testable.

---

## Milestone roadmap

| Milestone (plan §34) | Phases | Definition of done | Status |
|---|---|---|---|
| **M1 Playable Prototype** | 0 Foundation · 1 FPS controller · 2 weapon framework (Pistol) · 3 basic combat · 4 zombie foundation (Walker) · basic 6 waves · minimal HUD, game over, restart | Player can enter a map, shoot zombies, survive waves, and die | Not started |
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
| `TESTING.md` | Planned for Phase 0.6, alongside the test harness |
| `BALANCING.md` | Planned for Phase 2, when the first tunable values exist in `src/config/` |
