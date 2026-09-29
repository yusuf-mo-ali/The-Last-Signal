# THE LAST SIGNAL

**Browser zombie FPS, Waves Edition.** Fast FPS combat, roguelite progression, wave survival, adaptive enemies and dynamic world events, running in the browser with no install.

> **Status: Phase 7 (Signal Mutations) complete.** You can enter a grey-box prototype map, move with full collision, shoot the Pistol and punch with Bare Hands, and survive **waves** of the v1 zombie roster:
> - the **Walker**: slow and durable, with a swipe you can dodge;
> - the **Runner** (from wave 3): fast and fragile; it zig-zags in the open and leaps at you;
> - the **Screamer** (from wave 4): keeps its distance and screams to call and hasten the others, and to pull the next group in early; shoot it first;
> - the **Tank** (from wave 6): a slow wall that soaks body shots and must be shot in the head.
>
> Each wave is announced, arrives from out of sight at spawn points around the facility, and is followed by a 10 s breather. Waves grow in size and mix (swarms, heavy waves, ambushes), and from wave 8 zombies can be **Armored** or **Helmeted**, from wave 13 **Elite**. Clearing wave 20 transmits the signal and wins the run; `?endless=1` keeps going. You have 100 health and no healing yet; when it runs out the run ends on the wave reached, and a click starts a new one. The Phase 3–5 training range and test encounter are still available with `?sandbox=1`.
>
> From wave 4 every wave (except the finale) carries a **Signal Mutation**, announced before the wave with its rule and a hint, and shown top centre while it lasts: **Blackout** (the lights fail; red emergency lights and your muzzle flash light the way), **Hunger** (zombies 15 % faster, never faster than your sprint), **Static** (bursts of interference, never over your HUD), **Death Cry** (every kill alerts and hurries the zombies around it), **Hive** (a bigger wave with an announced surge) and **Blood Moon** (Elites under a red sky). Upgrades, adaptation and bosses come in later phases.
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
| [`BALANCING.md`](BALANCING.md) | Tuning values, their reasoning, and the change log |

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

The game opens on the Phase 1 blockout map: a compact facility with a yard, a control room, a crawl duct, a corridor, a generator hall, a catwalk and a loading dock. Click to capture the mouse and start wave 1; Esc releases it and pauses. The wave and what is left of it show top left. URL options: `?quality=low|medium|high|ultra` picks a graphics preset (default High); `?endless=1` keeps going past wave 20; `?sandbox=1` opens the Phase 3–5 sandbox instead of waves (three training dummies facing you and one of each archetype with each trait placed around the yard).

**Target browsers:** desktop Chrome, Edge and Firefox. Keyboard and mouse required.

### Development tools

Development builds (`npm run dev`) include a debug overlay and console commands. Production builds contain none of it.

- **Backquote** (`` ` ``) toggles the stats overlay: FPS, frame cost, draw calls, game state.
- **`tls.help()`** in the browser console lists every command. Examples:
  - `tls.state()` and `tls.stats()` report the current state and frame statistics.
  - `tls.player()` reports position, speed and movement state; `tls.teleportPlayer(x, y, z, yaw?)` and `tls.look(yaw, pitch?)` move and turn the player.
  - `tls.view({ fov: 75, sensitivity: 1.5, invertY: false, headBob: true })` changes view settings live.
  - `tls.weapons()` shows the loadout and ammo; `tls.giveAmmo()`, `tls.setInfiniteAmmo(true)`, `tls.giveWeapon('pistol', 'secondary')` and `tls.unlockSecondary()` change it.
  - `tls.dummies()` and `tls.combat()` show the training dummies and the last hits; `tls.spawnDummy('zoned')`, `tls.resetDummies()`, `tls.aimAtTarget('dummy-2', 'ARM_LEFT')`, `tls.showHitboxes()`, `tls.damageNumbers(false)` and `tls.spawnPickup('ammo')` help test combat.
  - `tls.enemies()` and `tls.enemy('walker-1')` show every enemy's state, health, target and attack; `tls.spawnEnemy()`, `tls.spawnWalkers(16)`, `tls.alertEnemies()`, `tls.freezeEnemies()`, `tls.setEnemyState('walker-1', 'STAGGER')`, `tls.damageEnemy('walker-1', 25)`, `tls.killEnemy('walker-1')`, `tls.killAll()` and `tls.clearEnemies()` control them; `tls.showAI()` draws their states, ranges, targets and routes.
  - `tls.spawnEnemy('runner', 10)`, `tls.spawnEnemy('tank', 8, 'armored,elite')`, `tls.spawnMixed(8)` spawn any archetype, with traits; `tls.traits()`, `tls.applyTrait('tank-3', 'helmeted')`, `tls.removeTrait('tank-3', 'elite')` and `tls.setTraits('walker-1', ['armored'])` change traits live; `tls.forceAbility('screamer-4')` makes a Screamer scream now.
  - `tls.playerHealth()`, `tls.setGodMode(true)`, `tls.healPlayer()`, `tls.damagePlayer(10)` and `tls.killPlayer()` test the player's health and game over.
  - `tls.transition('LOADING')` requests a game state change.
  - `tls.loseContext()` and `tls.restoreContext()` simulate a GPU reset.
  - `tls.throwError()` shows the error screen.
  - `tls.wave()` shows the current wave (state, theme, budget, queued, alive, timers); `tls.startWave(12)` jumps to a wave, `tls.skipWaveTimer()` ends the announcement or breather, `tls.completeWave()` clears the wave, `tls.pauseSpawning(true)` holds spawns, `tls.setEndless(true)` goes past wave 20, and `tls.runStats()` shows the run's tallies.
  - `tls.startWave(9, 'BLOOD_MOON')` jumps to a wave with a given mutation (`'none'` for none); `tls.mutation()` shows the current one (phase, what is applied, next STATIC burst, surges); `tls.triggerMutation('HIVE')` sets the current wave's (during its announcement) or the next wave's mutation; `tls.mutationSchedule(1, 20)` lists a run's mutations; `tls.setMutations(false)` turns them off; `tls.clearMutation()` removes the current effects; `tls.staticBurst()` forces a burst; `tls.mutations()` lists the catalogue.
  - `tls.waveTable(1, 25)` prints the difficulty curve; `tls.previewWave(20)` lists what a wave will contain; `tls.spawnPoints()` and `tls.showSpawns()` show where the next group could enter (green) and why not (red: in view, orange: too close, grey: no room, violet: reserved).
- The plan's remaining gameplay commands (`triggerMutation`, `spawnBoss`) are listed already. They report which phase will implement them.

## Controls

| Action | Key | Status |
|---|---|---|
| Move | W A S D | Working |
| Look | Mouse | Working |
| Sprint | Shift (forward) | Working |
| Crouch | C, held (Ctrl available as a rebind) | Working |
| Jump | Space | Working |
| Pause | Esc | Working |
| Fire | Left click | Working |
| Aim down sights | Right click | Later phase |
| Reload | R | Working |
| Primary / Secondary / Melee weapon | 1 / 2 / 3 (Secondary starts locked) | Working |
| Cycle firearms | Mouse wheel | Working |
| Quick melee (always available) | V | Working |
| Interact | E (proposed) | Later phases |

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
