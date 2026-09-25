# THE LAST SIGNAL

**Browser zombie FPS, Waves Edition.** Fast FPS combat, roguelite progression, wave survival, adaptive enemies and dynamic world events, running in the browser with no install.

> **Status: Phase 1 (first-person foundation) complete.** You can enter a grey-box prototype map and walk, strafe, sprint, crouch, jump and look around with full collision. There are no weapons or zombies yet: Phase 2 (weapon framework) is next.
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
| [`TESTING.md`](TESTING.md) | Test levels, how to run them, coverage, manual QA checklist |
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
npm run test:e2e     # browser tests against the dev server and a production build (see TESTING.md)
```

The game currently opens on the Phase 1 blockout map: a compact facility with a yard, a control room, a crawl duct, a corridor, a generator hall, a catwalk and a loading dock. Click to capture the mouse and start; Esc releases it and pauses. Add `?quality=low|medium|high|ultra` to the URL to pick a graphics preset (default High).

**Target browsers:** desktop Chrome, Edge and Firefox. Keyboard and mouse required.

### Development tools

Development builds (`npm run dev`) include a debug overlay and console commands. Production builds contain none of it.

- **Backquote** (`` ` ``) toggles the stats overlay: FPS, frame cost, draw calls, game state.
- **`tls.help()`** in the browser console lists every command. Examples:
  - `tls.state()` and `tls.stats()` report the current state and frame statistics.
  - `tls.player()` reports position, speed and movement state; `tls.teleportPlayer(x, y, z, yaw?)` and `tls.look(yaw, pitch?)` move and turn the player.
  - `tls.view({ fov: 75, sensitivity: 1.5, invertY: false, headBob: true })` changes view settings live.
  - `tls.transition('LOADING')` requests a game state change.
  - `tls.loseContext()` and `tls.restoreContext()` simulate a GPU reset.
  - `tls.throwError()` shows the error screen.
- The plan's other gameplay commands (`giveAmmo`, `spawnEnemy`, `startWave`, …) are listed already. They report which phase will implement them.

## Controls

| Action | Key | Status |
|---|---|---|
| Move | W A S D | Working |
| Look | Mouse | Working |
| Sprint | Shift (forward) | Working |
| Crouch | C, held (Ctrl available as a rebind) | Working |
| Jump | Space | Working |
| Pause | Esc | Working |
| Fire / Aim | Left click / Right click | Phase 2 |
| Reload | R | Phase 2 |
| Weapons | 1 / 2 / 3 | Phase 2 |
| Interact / Melee | E / V (proposed) | Later phases |

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
