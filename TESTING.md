# Testing — THE LAST SIGNAL

How the project is tested, how to run each level, what is covered, and what still needs a human in a real browser. Required by plan §36; strategy from plan §27 and ARCHITECTURE.md §9 (D-021, D-036).

> **Status (end of Phase 0):** 420 unit tests; 40 end-to-end tests (20 specs × `dev` and `prod`: 33 run, 7 skipped by design); manual QA checklist not yet run in a real browser (see §6).

---

## 1. Test levels

| Level | Tool | Where | Runs in | Purpose |
|---|---|---|---|---|
| **Unit** | Vitest | `src/**/*.test.ts` (next to the code) | Node | Every module's rules and edge cases, deterministic |
| **Integration** | Vitest + headless `Game` | `src/**/*.test.ts`, `tests/*.test.ts` | Node | Systems working together through the real loop (e.g. `Game` + `TestScene` + input readers), driven by a manual frame queue |
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

## 3. What is covered (Phase 0)

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
| **Debug tools** | `debug/DebugCommands.test.ts`, `debug/FrameStats.test.ts` | `debug.spec`: `tls`, plan §29 stubs, overlay (dev); nothing in production |

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
| **GPU rendering and frame rates** | Software rendering (SwiftShader) | Performance is measured manually (§7) |

---

## 6. Manual QA checklist

Run it in **Chrome, Edge and Firefox** on real hardware:
- against `npm run dev` (dev tools available: open the console and use `tls.help()`);
- against a production build: `npm run build && npm run preview`, or the Vercel preview.

Record the date, browser version and results in PROGRESS.md.

**Status: not yet run.** The Claude Code container has only headless Chromium, and its network policy blocks the Vercel preview.

### Load and rendering
- [ ] **Load and render:** the page loads with no console errors, the test scene renders (floor, crates, red spinning beacon), and "Click to play" is shown.
- [ ] **Resolution:** 1920×1080, 1600×900, 1366×768 and a small window are sharp, not stretched, and the aspect ratio stays correct while resizing.
- [ ] **Browser zoom:** Ctrl/Cmd +/−, and moving the window to a monitor with a different scaling, re-render sharp (pixel ratio capped at 2).

### Pointer lock and input
- [ ] **Capture:** clicking "Click to play" hides the cursor and the prompt.
- [ ] **Esc:** releases the cursor and shows the prompt again. In a run (dev: `tls.transition('LOADING'); tls.transition('PLAYING')`) it shows "Paused" and `tls.state()` reports `PAUSED`.
- [ ] **Chrome, re-lock cooldown:** click again immediately (under 1 s) after Esc. Expect "Mouse not captured … Click again"; a click a second later captures.
- [ ] **Focus loss:** Alt+Tab / Cmd+Tab and switching browser tabs while captured pause the run. A key held during the switch is no longer held on return: `tls.inspect().input.isKeyDown('KeyW')` is `false`.
- [ ] **Raw input:** the overlay's `lock` line shows `on raw` in Chrome/Edge where supported, and `on accel` in Firefox.
- [ ] **Browser defaults:**
  - right-click on the canvas opens no context menu;
  - mouse side buttons do not navigate back or forward;
  - Space does not scroll;
  - Ctrl+R / Cmd+R still reload.
- [ ] **Keyboard layout:** with an AZERTY (or other) OS layout, the physical W key reports `moveForward`: `tls.inspect().frameActions.isDown('moveForward')` is true while held.

### Resilience
- [ ] **Context loss** (dev, real GPU): `tls.loseContext()` shows "Graphics paused"; `tls.restoreContext()` restores the scene and "Paused" → click resumes.
- [ ] **Error screen:** `tls.throwError()` shows "Something went wrong" with a stack in dev; production shows no stack. Reload works.
- [ ] **WebGL disabled:** hardware acceleration off (Chrome) or `webgl.disabled = true` (Firefox `about:config`) shows the "WebGL 2 is not available" screen with steps.

### Debug tools and performance
- [ ] **Overlay:** the Backquote key toggles the stats overlay in dev, and the overlay is absent in production builds.
- [ ] **Performance:** on the reference hardware (O-9), the overlay shows a steady 60 FPS at 1366×768 and 1920×1080 with our frame cost well under 4 ms.

---

## 7. Performance testing

- **Budgets:** ARCHITECTURE.md §8.
- **Measurement:** the dev overlay (`FPS`, `cost avg/p95/max`, draw calls) and `tls.stats()`.
- **Phase 0 figures,** from software rendering in the container, so not representative of GPUs:
  - our frame cost is about 0.5–1.3 ms;
  - 14 draw calls, 146 triangles, 3 shader programs;
  - frame-probe overhead is about 130 ns per frame when on and 0 when off.
- **Real baselines need the reference hardware** (open question O-9) and start in Phase 1, when the prototype map exists.

---

## 8. Known gaps

- **No CI yet.** Recommended next infrastructure step: a GitHub Actions workflow running `npm ci`, `npm run check`, `npm run build` and `npm run test:e2e` on every PR. That would make "green" objective for every change.
- **Vercel preview not reachable from the Claude Code container.** Its network policy denies `*.vercel.app`; allowing it would let the e2e suite run against each preview (`E2E_BASE_URL`).
- **Manual QA (§6) pending** in real Chrome, Edge and Firefox.
- **Future test targets (plan §27).** Unit tests for damage, wave generation, difficulty scaling, upgrade and mutation selection, economy and save/load. Headless integration scenarios for shooting, killing, wave completion, upgrades, boss spawning, game over and restart. Each lands with its phase.
