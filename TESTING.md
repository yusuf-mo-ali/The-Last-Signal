# Testing — THE LAST SIGNAL

How the project is tested, how to run each level, what is covered, and what still needs a human in a real browser. Required by plan §36; strategy from plan §27 and ARCHITECTURE.md §9 (D-021, D-036).

> **Status (end of Phase 1):** 525 unit and integration tests; 64 end-to-end tests (32 tests × `dev` and `prod`: 49 run, 15 skipped by design); manual QA checklist not yet run in a real browser (see §6).

---

## 1. Test levels

| Level | Tool | Where | Runs in | Purpose |
|---|---|---|---|---|
| **Unit** | Vitest | `src/**/*.test.ts` (next to the code) | Node | Every module's rules and edge cases, deterministic |
| **Integration** | Vitest + headless `Game` | `src/**/*.test.ts`, `tests/*.test.ts` | Node | Systems working together through the real loop (e.g. `Game` + `World` + `Player` + input readers walking the whole map), driven by a manual frame queue |
| **End-to-end** | Playwright | `tests/e2e/*.spec.ts` | Chromium, against the dev server **and** a production build | What only a browser can show: WebGL rendering, resize/DPR, DOM input, pointer lock, error screens, context loss, dev-vs-prod differences |
| **Manual QA** | A person, real browsers | §6 checklist | Chrome, Edge, Firefox on real hardware | Feel, and browser behaviour headless Chromium cannot reproduce (§5) |

**Why game logic runs in Node.** The simulation (`core/`, `world/` sims, and later gameplay) is browser-independent (D-003). Integration tests therefore need no browser. They are fast and deterministic, and they are the level where plan §27's gameplay scenarios (shoot → kill → wave complete → upgrade → boss → game over → restart) will live.

---

## 2. Running the tests

| Command | What it does | When |
|---|---|---|
| `npm test` | Unit + integration tests (Vitest, ~2 s) | Constantly |
| `npm run test:watch` | Vitest in watch mode | While developing |
| `npm run check` | Typecheck (app + e2e) → lint → format check → unit/integration tests | **Before every commit** |
| `npm run build` | Typecheck + production build | Before every commit |
| `npm run test:e2e` | Playwright against the dev server and a production preview (~2 min) | Before committing changes to rendering, input, UI, error handling or the build; before merging |

### End-to-end setup

- **First time on a machine:** `npx playwright install chromium`.
- **Containers with a pre-installed Chromium:** set `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/path/to/chrome` instead. In the Claude Code cloud container this is `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`.
- **Servers:** `npm run test:e2e` starts both itself: `npm run dev` on port 5173 and `npm run build && npm run preview` on port 4173. An already-running dev server on 5173 is reused locally, but not in CI.
- **Rendering mode:** tests force software WebGL (SwiftShader), so results are the same on machines with and without a GPU. Frame rates in e2e runs are therefore **not** performance data (§7).

### Testing a deployed build (e.g. a Vercel preview)

```bash
E2E_BASE_URL=https://<deployment>.vercel.app npm run test:e2e
# Protected Vercel previews: also set the project's automation bypass secret
VERCEL_AUTOMATION_BYPASS_SECRET=<secret> E2E_BASE_URL=https://… npm run test:e2e
```

- **Project and expectations:** this runs every spec as the `remote` project with production expectations, and starts no local servers.
- **The repository stays the source of truth.** A preview only verifies that the deployed build behaves the same.
- **From the Claude Code cloud container:** `*.vercel.app` must first be allowed in the environment's network settings (§8).

---

## 3. What is covered (Phases 0–1)

| Area | Unit / integration | End-to-end |
|---|---|---|
| **Toolchain** | `tests/toolchain.test.ts`: three.js math and `Octree`/`Capsule` run in Node | — |
| **Engine config** | `core/Config.test.ts`: defaults, deep freeze, single source | — |
| **Gameplay config** | `config/input.test.ts`, `config/gameplayConfig.test.ts`: ids, plan values, wave/phase coverage 1–20 | — |
| **EventBus** | `core/EventBus.test.ts`: typing, order, re-entrancy, error isolation, scopes | — |
| **Time** | `core/Time.test.ts`: 30/60/120/144 Hz, drift, hitches, scale | `smoke.spec`: steps + dropped time = real time |
| **State machine** | `core/GameState.test.ts`: all 132 transition pairs against an independently written table; pause/resume from every phase; restart and quit while paused; queued and invalid transitions | `smoke.spec`: pause freezes steps, rendering continues |
| **Game loop** | `core/Game.test.ts`: headless loop with a manual frame queue; frozen states; stop/restart; fail-fast; frame probe | `smoke.spec` |
| **Rng / Pool** | `utils/Rng.test.ts`: matches an independent sfc32 reference and FNV-1a vectors; `utils/Pool.test.ts` | — |
| **Rendering** | `render/viewport.test.ts`: sizes and DPR at every target resolution | `smoke.spec`: WebGL 2, pixels drawn, animation. `resize.spec`: 5 resolutions, live DPR 2/1.25/3, DPR cap, collapsed container |
| **Input** | `input/*.test.ts`: readers, edges at any frame/step ratio, wheel notches, glitch motion, real DOM listener path on Node `EventTarget`s, pointer-lock success/fallback/refusal/legacy/timeout, auto-pause, step discard | `input.spec`: default suppression, physical keys (AZERTY), edges, lock on click, motion/buttons/wheel, lock loss → pause, refusal → "click again", resume, blur/hidden |
| **Errors / WebGL** | `core/ErrorHandler.test.ts`, `render/webglSupport.test.ts`, `render/ContextLossMonitor.test.ts` | `resilience.spec`: context loss/restore/timeout, forced frame/async/rejection errors, missing WebGL 2, renderer failure |
| **Debug tools** | `debug/DebugCommands.test.ts`, `debug/FrameStats.test.ts` | `debug.spec`: `tls`, plan §29 stubs, player commands, overlay (dev); nothing in production |
| **Player config** (Phase 1) | `config/player.test.ts`: body proportions, speed order, responsiveness, `jumpSpeed`, fit with the blockout (dock jumpable, duct crouch-only) | — |
| **Level geometry** | `world/levels/geometry.test.ts`: outward normals for boxes, ramps in all 4 directions and stairs; stairs render as steps and collide as a ramp; grouping by surface | — |
| **Blockout map** | `world/levels/facility.test.ts`: brushes well-formed and in bounds, triangle budget, walkable slopes, clear spawn, clear ground at every route waypoint, duct fits crouched not standing, beacon clear | `smoke.spec`: map renders, beacon visible from the spawn |
| **Collision** | `physics/CollisionWorld.test.ts`: floor / wall contacts reported separately, deepest first; one-sided faces; raycast range and back faces | `player.spec`: walls, desk, duct |
| **Movement** | `player/PlayerMotor.test.ts` (37 tests): direction per key and yaw, acceleration, braking without backslide, diagonal speed, sprint rules, crouch speed / eye ease / headroom / tunnel, jump apex and air time, no repeat, no air jump, jump buffer on/off, coyote time on/off, gravity and terminal speed, ledges, ramp up / sprint down (snap), no sliding standing or landing on a ramp, steep slopes, wall stop and slide, no tunnelling through thin floors and walls, never below the floor, kill-plane respawn | `player.spec`: WASD, turned-view movement, sprint 1.5×, crouch, jump height, no bunny-hop, never below the floor |
| **Look and camera** | `player/PlayerLook.test.ts`: direction, invert-Y, sensitivity scaling, pitch clamp and recovery, yaw wrap, validation. `player/HeadBob.test.ts`: none when still, subtle amplitude, sprint cap, distance-based rhythm, eased fade, paused, disabled | `player.spec`: real mouse → yaw/pitch, sensitivity 2×, clamp at ±89°, invert-Y, FOV, camera follows look; head bob visible when walking, none when still or disabled |
| **Controller and loop** | `player/PlayerController.test.ts` (with the real `InputState`/`ActionMap`); `core/Game.test.ts`: frame systems before steps, while frozen, removal; `player/traversal.test.ts`: player only moves while playing, respawn per run, **identical positions at 30/60/75/144/240 Hz**, **headless walk of the whole map** | `player.spec`: click to play starts the run; **walk of the whole map with real keys** (W/Shift held, C through the duct, Space at the dock); `prod`: strafing and turning move the beacon on screen |

**Every end-to-end test also asserts a clean page:** no console errors or warnings, page errors, failed requests or HTTP errors. The only exceptions are ones a test deliberately provokes, and those are listed in the test.

---

## 4. Conventions

- **Determinism.**
  - All gameplay randomness goes through a seeded `Rng` (D-014).
  - Loops are driven by manual frame queues or exact frame times, never the wall clock.
  - Timers use Vitest's fake timers.
- **Inject, don't mock globals.** Browser-facing code receives `window`, `document`, canvases and event targets as parameters (D-034, D-035). Tests pass Node's real `EventTarget`/`Event`/`AbortController`, so listener registration, removal and `preventDefault` are exercised for real.
- **Test against independent truth.** Expected tables and reference implementations are written in the test, not copied from the code. Examples: the transition table, the sfc32 reference, published FNV-1a vectors.
- **Tests must be able to fail.** For important behaviour, plant a realistic bug and confirm a test goes red.
  - Phases 0.2 and 0.4: 16 of 16 unit-level mutations were caught.
  - Phase 0.6: a planted e2e bug (refusal feedback removed) failed in both projects.
  - Phase 1: 9 of 9 movement mutations caught (no sub-steps, no headroom check, no diagonal normalisation, sprint in any direction, no coyote time, no jump buffer, sliding on slopes, no ground snap, no kill plane). The first run caught 5; the 4 survivors exposed weak test setups, which were fixed.
  - Mutations are always reverted.
- **Naming.** Unit/integration files are `*.test.ts` (Vitest); end-to-end files are `*.spec.ts` (Playwright). They never overlap.
- **Development vs production.** E2E specs branch on the project name. Checks needing `window.tls` run only in `dev`; `prod` verifies that the debug tools are absent.

---

## 5. Headless limits

Headless Chromium does not reproduce some browser behaviour. Each case is covered by driving the same code path, and is repeated in the manual checklist.

| Real behaviour | In headless | How it is covered |
|---|---|---|
| **Esc releases the pointer lock** (and the browser swallows the key) | Esc does nothing | `document.exitPointerLock()` fires the same `pointerlockchange` |
| **Chromium refuses a re-lock shortly after Esc** | No cooldown | The canvas's `requestPointerLock` is made to reject once with Chromium's exact `SecurityError`, so the real click → request → "refused" path runs |
| **Switching tabs/windows fires `blur` and `visibilitychange`** | Pages always look visible and focused | The same events are dispatched; unit tests cover the handlers |
| **Raw (`unadjustedMovement`) mouse input on Chromium** | Unsupported | The fallback path runs for real |
| **GPU rendering and frame rates** | Software rendering (SwiftShader), ~7–12 FPS | Performance is measured manually (§7). Movement assertions use simulated time (`tls.player()`), not wall-clock distances, because a slow software frame drops simulated time (max 5 steps per frame) |

---

## 6. Manual QA checklist

Run it in **Chrome, Edge and Firefox** on real hardware:
- against `npm run dev` (dev tools available: open the console and use `tls.help()`);
- against a production build: `npm run build && npm run preview`, or the Vercel preview.

Record the date, browser version and results in PROGRESS.md.

**Status: not yet run.** The Claude Code container has only headless Chromium, and its network policy blocks the Vercel preview.

### Load and rendering
- [ ] **Load and render:** the page loads with no console errors, the blockout map renders (yard, tower with the red spinning beacon, buildings), and "Click to play" is shown.
- [ ] **Resolution:** 1920×1080, 1600×900, 1366×768 and a small window are sharp, not stretched, and the aspect ratio stays correct while resizing.
- [ ] **Browser zoom:** Ctrl/Cmd +/−, and moving the window to a monitor with a different scaling, re-render sharp (pixel ratio capped at 2).

### Pointer lock and input
- [ ] **Capture:** clicking "Click to play" hides the cursor and the prompt.
- [ ] **Esc:** releases the cursor and shows "Paused"; `tls.state()` reports `PAUSED`. Clicking resumes where the player stood.
- [ ] **Chrome, re-lock cooldown:** click again immediately (under 1 s) after Esc. Expect "Mouse not captured … Click again"; a click a second later captures.
- [ ] **Focus loss:** Alt+Tab / Cmd+Tab and switching browser tabs while captured pause the run. A key held during the switch is no longer held on return: `tls.inspect().input.isKeyDown('KeyW')` is `false`.
- [ ] **Raw input:** the overlay's `lock` line shows `on raw` in Chrome/Edge where supported, and `on accel` in Firefox.
- [ ] **Browser defaults:**
  - right-click on the canvas opens no context menu;
  - mouse side buttons do not navigate back or forward;
  - Space does not scroll;
  - Ctrl+R / Cmd+R still reload.
- [ ] **Keyboard layout:** with an AZERTY (or other) OS layout, the physical W key reports `moveForward`: `tls.inspect().frameActions.isDown('moveForward')` is true while held.

### Movement and camera (Phase 1)
- [ ] **Feel:** walking, strafing and stopping feel immediate (no ice, no floatiness); diagonal movement is not faster.
- [ ] **Sprint (Shift)** is clearly faster, forward only. **Crouch (C, held)** lowers the view smoothly and slows down; releasing it under the duct ceiling keeps you crouched until you are out.
- [ ] **Jump (Space):** a tap jumps once; holding does not repeat; you can jump onto the loading dock and the small crates, not onto the tall crate or the container.
- [ ] **Mouse look:** smooth at 60/120/144 Hz monitors, no jitter while strafing and turning; looking straight up/down stops just short of vertical without flipping.
- [ ] **Settings (dev):** `tls.view({ fov: 90 })`, `tls.view({ sensitivity: 2 })`, `tls.view({ invertY: true })`, `tls.view({ headBob: false })` take effect immediately.
- [ ] **Head bob:** subtle while walking, a little stronger sprinting, none when standing still or in the air.
- [ ] **Collision:** no wall, corner or doorway lets you through or snags you; sliding along walls is smooth; the stairs and ramps are smooth to walk up and down; you never fall through the floor (`tls.player().respawns` stays 0).
- [ ] **Whole map:** walk the loop from the yard through the control room, crawl duct (crouch), service corridor, generator hall, west annex, stairs, catwalk (and drop through the railing gap), ramp, loading bay, dock and back.

### Resilience
- [ ] **Context loss** (dev, real GPU): `tls.loseContext()` shows "Graphics paused"; `tls.restoreContext()` restores the scene and "Paused" → click resumes.
- [ ] **Error screen:** `tls.throwError()` shows "Something went wrong" with a stack in dev; production shows no stack. Reload works.
- [ ] **WebGL disabled:** hardware acceleration off (Chrome) or `webgl.disabled = true` (Firefox `about:config`) shows the "WebGL 2 is not available" screen with steps.

### Debug tools and performance
- [ ] **Overlay:** the Backquote key toggles the stats overlay in dev, and the overlay is absent in production builds.
- [ ] **Performance:** follow §7. The weak reference machine reaches ~30 FPS average at 1080p, Low preset; capable hardware reaches ~60 FPS at High. Record the results in the §7 log.

---

## 7. Performance testing (D-037)

### 7.1 Reference hardware and targets

| Tier | Machine | Preset | Resolution | Target |
|---|---|---|---|---|
| **Minimum** | **Weak reference:** Intel Core i5-4440 · 16 GB DDR3-1333 · NVIDIA GTX 750 (confirm 1 GB or 2 GB) | Low | 1920×1080 | **~30 FPS average** (≤ 33.3 ms per frame) in normal gameplay |
| **Target** | Capable hardware, e.g. an RTX 4050 class GPU | High | 1920×1080 | **~60 FPS** (≤ 16.7 ms per frame) |

- **1080p is the primary baseline** unless a phase states otherwise.
- **The reference is a performance floor, not a visual ceiling.** Higher presets must look significantly better on stronger GPUs, with identical gameplay (ARCHITECTURE §7.18).
- **Budgets:** ARCHITECTURE §8.
- **Measure first, optimise second.** Optimisation work starts from a logged measurement that misses a budget.

### 7.2 How to measure

1. **Build:** measure the **production** build (`npm run build && npm run preview`, or the Vercel preview). The development build adds HMR and debug overhead.
2. **Browser:**
   - Latest Chrome, and Edge or Firefox as a second browser. No other tabs or apps running.
   - Laptops plugged in; OS power plan set to High performance.
   - Browser window fullscreen (F11) at 1920×1080, browser zoom 100%.
3. **Preset:** Low on the weak reference, High on capable hardware: open the build with `?quality=low` or `?quality=high` (default High).
4. **Scenario:** use the phase's scenario (table below). Let the scene settle for 10 s, then record for **60 s**.
5. **Frame rate** (works in production): Chrome DevTools → More tools → Rendering → **Frame Rendering Stats**, plus a Performance-panel recording of the 60 s.
6. **Our CPU cost** (development build, same scenario): the overlay and `tls.stats()`, which report cost avg/p95/max per frame, draw calls and steps per frame.
7. **Record:** average FPS, p95 and 1% low frame times, our CPU cost p95, draw calls, and anything unusual (stutter, hitches) in the log below.

| Phase | Scenario |
|---|---|
| 1 | Walk the full prototype-map loop continuously for 60 s (sprinting, jumping, looking around) |
| 3–6 | A wave at the default `maxAlive` (24) under fire; plus the stress test at 60 enemies |
| 7, 11 | The same with BLACKOUT, and a lighting-heavy environment state |
| 13 | The boss fight, including its screen effects |

**Pass rule:** the average FPS meets the tier target.
- A p95 above ~50 ms on the reference is investigated even when the average passes.
- A phase that misses its target on the reference fixes it before adding major content (plan §39, rule 6).

### 7.3 Results log

| Date | Commit | Build | Machine | Browser | Preset | Resolution | Scenario | Avg FPS | p95 / 1% low (ms) | CPU cost p95 (ms) | Draw calls | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| — | — | — | — | — | — | — | — | *No reference-machine measurements yet. Phase 1's map is ready for the first one (scenario: Phase 1 row above); it needs the physical machines.* | | | | |

### 7.4 Figures from the Claude Code container

Software rendering (SwiftShader, 4 vCPU Xeon @ 2.1 GHz) with no GPU, so frame *rates* are not representative. Our own CPU cost and the scene's size are.

**Phase 0 test scene:** frame cost about 0.5–1.3 ms; 14 draw calls, 146 triangles, 3 shader programs; frame-probe overhead about 130 ns per frame when on and 0 when off.

**Phase 1 baseline (2026-09-25, development build, sprinting and turning around the yard for 5 s):**

| Resolution | Preset | FPS (SwiftShader) | Our frame cost avg / p95 / max (ms) | Steps per frame | Draw calls | Triangles | Programs |
|---|---|---|---|---|---|---|---|
| 1920×1080 | High (default) | 7.1 | 0.97 / 1.7 / 2.8 | 4.3 | 11 | 1,124 | 4 |
| 1920×1080 | Low | 8.4 | 1.14 / 2.6 / 3.1 | 4.2 | 11 | 1,124 | 4 |
| 1366×768 | High | 12.0 | 0.93 / 2.0 / 3.3 | 4.4 | 11 | 1,124 | 4 |
| 1280×720 | Ultra | 10.1 | 0.94 / 1.7 / 3.8 | 4.2 | 11 | 1,124 | 4 |

- **Player simulation (Node, headless):** 5.0 µs per step standing, 6.0 µs sprinting in the open, 10.3 µs pushing into a wall. At 60 steps/s that is under 0.1 % of a frame. Level collision: 480 triangles; world build ≈ 50 ms once at startup (including JIT warm-up).
- **Reading:** our CPU work is ~1 ms per frame. SwiftShader's CPU rasteriser is the entire bottleneck (7 FPS at 1080p), so these rates say nothing about the GTX 750. The blockout is far inside every budget (draw calls 11 of 250).
- **Dropped time:** below ~12 FPS a frame needs more than 5 steps, so simulated time runs slower than real time by design (ARCHITECTURE §3). This is why e2e movement checks read simulated state instead of wall-clock distances.
- **Not optimised.** Nothing in Phase 1 was tuned for speed; there is no evidence it needs to be (D-037 §3).

---

## 8. Known gaps

- **No CI yet.** Recommended next infrastructure step: a GitHub Actions workflow running `npm ci`, `npm run check`, `npm run build` and `npm run test:e2e` on every PR. That would make "green" objective for every change.
- **Vercel preview not reachable from the Claude Code container.** Its network policy denies `*.vercel.app`; allowing it would let the e2e suite run against each preview (`E2E_BASE_URL`).
- **Manual QA (§6) pending** in real Chrome, Edge and Firefox.
- **Phase 1 feel is verified by numbers, not by hands.** Acceleration, speeds, jump height and camera behaviour are asserted, but "feels like a real FPS" needs the manual checklist (§6) on real hardware and monitors.
- **Future test targets (plan §27).** Unit tests for damage, wave generation, difficulty scaling, upgrade and mutation selection, economy and save/load. Headless integration scenarios for shooting, killing, wave completion, upgrades, boss spawning, game over and restart. Each lands with its phase.
