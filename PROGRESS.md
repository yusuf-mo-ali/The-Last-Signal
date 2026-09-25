# Progress — THE LAST SIGNAL

> The working state of the project. Every session reads this file first and updates it last, so
> work can be resumed safely (plan §36).
>
> **Last updated:** 2026-09-25 · **Branch:** `claude/bold-mayer-n66vhb`

---

## Current Phase

**Pre-Phase 0: Planning and architecture.** Complete, **awaiting approval** before Phase 0 starts.

- No source code, dependencies or build configuration exist yet. This is intentional.
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

## Active Task

None. Waiting for approval to start **Phase 0.1**.

## Known Bugs

None; no code exists yet.

## Next Task

**Phase 0.1: Toolchain scaffold.** Details are in the Phase 0 plan below.

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
| **0.1 Toolchain scaffold** | `package.json` (npm; Node ≥22.12 engines). Dependencies: `three@0.186.1`; dev dependencies from D-002. `tsconfig.json` (strict, `noUncheckedIndexedAccess`, `noImplicitOverride`, `verbatimModuleSyntax`, `erasableSyntaxOnly`). ESLint flat config (typescript-eslint type-checked plus the layer import rules from ARCHITECTURE §2). Prettier, Vitest, `.gitignore`, `.nvmrc`, `.editorconfig`. `index.html` and a minimal `src/main.ts`. Scripts: `dev`, `build`, `preview`, `typecheck`, `lint`, `format`, `test`. | `npm ci`, `typecheck`, `lint`, `test` and `build` all pass. `npm run dev` serves a page with no console errors |
| **0.2 Core primitives** | `EventBus` (typed), `Time` (fixed-step clock, time scale), `GameState` (12 states, hierarchy, pause stack, transition table), `utils/Rng` (seeded), `utils/Pool` | Unit tests cover every legal and illegal transition, pause/resume restoring the child state, and event ordering and re-entrancy |
| **0.3 Render foundation** | `render/Renderer` (WebGL2 check, DPR cap, resize), `core/Game` bootstrap and fixed-step loop (ARCHITECTURE §3), test scene (floor, boxes, light), camera | Stable loop; resize correct at 1366×768–1920×1080 and smaller; no console errors |
| **0.4 Input** | `input/InputManager` (key `code`s, mouse buttons, wheel), pointer lock wrapper (D-017), `config/input.ts` default bindings, blur/visibility → pause hook | Input verified with the debug overlay; pointer lock acquire, lose and re-acquire works |
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
