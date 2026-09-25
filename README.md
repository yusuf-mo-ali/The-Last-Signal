# THE LAST SIGNAL

**Browser zombie FPS, Waves Edition.** Fast FPS combat, roguelite progression, wave survival, adaptive enemies and dynamic world events, running in the browser with no install.

> **Status: Phase 0 (project foundation) in progress.** The toolchain, core primitives, render foundation and input layer are in place (Phases 0.1–0.4); there is **no playable build yet**.
> See [`PROGRESS.md`](PROGRESS.md) for live status.

---

## The game

You are trapped in a failing communications facility. Survive escalating zombie waves while restoring a mysterious signal tower.

- **The horde adapts to how you play.** Camp on high ground and they learn to climb. Rely on the shotgun and they come armored.
- **Every wave carries a Signal Mutation** that bends the rules: blackouts, frenzied hunger, static interference, screaming deaths.
- **Build as you survive.** Choose one of three upgrades after each wave, and let a playstyle emerge.
- **Restore the signal.** Collect components, restore power, repair and charge the transmitter, then transmit, all while the waves keep coming.

## Documentation

| Document | Purpose |
|---|---|
| [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md) | **Source of truth** for scope, phases and requirements |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | Technical architecture: layers, loop, state machine, subsystems, budgets |
| [`GAME_DESIGN.md`](GAME_DESIGN.md) | Game rules, content and design intents |
| [`DECISIONS.md`](DECISIONS.md) | Decision log and open questions |
| [`PROGRESS.md`](PROGRESS.md) | Current phase, completed and next tasks, blockers |
| `TESTING.md` | Test strategy and QA checklist (created in Phase 0) |
| `BALANCING.md` | Tuning log (created in Phase 2) |

## Tech stack (planned)

| Area | Choice |
|---|---|
| Rendering | [Three.js](https://threejs.org/) on WebGL2 |
| Language | TypeScript (strict) |
| Build | Vite |
| UI | HTML/CSS + TypeScript (no UI framework) |
| Audio | Web Audio API |
| Collision | three.js `Octree` + `Capsule` addons (no physics engine) |
| Tests | Vitest (unit + headless integration), Playwright (smoke) |
| Lint / format | ESLint + typescript-eslint, Prettier |
| Hosting | Vercel (static) |

Exact versions and reasoning are in [`DECISIONS.md`](DECISIONS.md) (D-001, D-002).

## Getting started

**Prerequisites:** Node.js 22 LTS (≥ 22.12) and npm 10+.

```bash
npm ci               # install the exact locked dependencies
npm run dev          # start the dev server with hot reload
npm run build        # typecheck + production build to dist/
npm run preview      # serve the production build locally
npm test             # unit + integration tests (Vitest)
npm run lint         # ESLint (type-aware, plus layer-boundary rules)
npm run typecheck    # TypeScript, no emit
npm run format       # Prettier (code and config; Markdown is hand-maintained)
npm run check        # typecheck + lint + format check + tests; run before every commit
```

The dev server currently shows the Phase 0 test scene: a spinning signal beacon driven by the fixed-step simulation. Click to capture the mouse; Esc releases it. Keys and mouse are read, but nothing moves yet: the player controller and gameplay come in Phase 1.

**Target browsers:** desktop Chrome, Edge and Firefox. Keyboard and mouse required.

## Controls (planned)

| Action | Key |
|---|---|
| Move | W A S D |
| Look | Mouse |
| Fire / Aim | Left click / Right click |
| Reload | R |
| Sprint | Shift |
| Crouch | C (Ctrl available as a rebind) |
| Jump | Space |
| Weapons | 1 / 2 / 3 |
| Interact / Melee | E / V (proposed) |
| Pause | Esc |

Controls will be rebindable. Crouch defaults to C rather than Ctrl because browsers do not let pages block Ctrl+W, so crouch-walking with Ctrl would close the tab.

## Development workflow

Development follows the loop in plan §35, one small, safe step at a time:

```text
READ → PLAN → IMPLEMENT → TEST → RUN → INSPECT → FIX → DOCUMENT → COMMIT → NEXT
```

- Read `PROGRESS.md` and the relevant section of `ARCHITECTURE.md` before changing a system.
- Keep tunable gameplay values in `src/config/`, never in logic.
- Commits are small and conventional: `feat:`, `fix:`, `perf:`, `docs:`, `test:`, `chore:`.
- Never commit intentionally broken code to the main branch.
- Update `PROGRESS.md` (and `DECISIONS.md` for any new decision) as part of each change.

## Deployment

The production build is a static site deployed to Vercel. Deployment setup is part of Milestone 5.

## License

Not yet chosen (see `DECISIONS.md`, O-11).
