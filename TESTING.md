# Testing — THE LAST SIGNAL

How the project is tested, how to run each level, what is covered, and what still needs a human in a real browser. Required by plan §36; strategy from plan §27 and ARCHITECTURE.md §9 (D-021, D-036).

> **Status (end of Phase 4):** 934 unit and integration tests; 114 end-to-end tests (57 tests × `dev` and `prod`: 77 run, 37 skipped by design); manual QA checklist not yet run in a real browser (see §6). On the final, slower container host (about half the frame rate of earlier runs), 4 development-build tests from Phases 1–3 that hold keys for a fixed wall-clock time fail; they fail identically on the Phase 3 commit on that host (§8).

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
| `npm test` | Unit + integration tests (Vitest, ~7 s) | Constantly |
| `npm run test:watch` | Vitest in watch mode | While developing |
| `npm run check` | Typecheck (app + e2e) → lint → format check → unit/integration tests | **Before every commit** |
| `npm run build` | Typecheck + production build | Before every commit |
| `npm run test:e2e` | Playwright against the dev server and a production preview (~8 min in software rendering) | Before committing changes to rendering, input, UI, error handling or the build; before merging |

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

## 3. What is covered (Phases 0–8)

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
| **Debug tools** | `debug/DebugCommands.test.ts`, `debug/FrameStats.test.ts` | `debug.spec`: `tls`, the remaining plan §29 stubs (with their phases), player, weapon, combat, enemy and player-health commands, overlay with the weapon, combat and enemy lines (dev); nothing in production |
| **Player config** (Phase 1) | `config/player.test.ts`: body proportions, speed order, responsiveness, `jumpSpeed`, fit with the blockout (dock jumpable, duct crouch-only) | — |
| **Level geometry** | `world/levels/geometry.test.ts`: outward normals for boxes, ramps in all 4 directions and stairs; stairs render as steps and collide as a ramp; grouping by surface | — |
| **Blockout map** | `world/levels/facility.test.ts`: brushes well-formed and in bounds, triangle budget, walkable slopes, clear spawn, clear ground at every route waypoint, duct fits crouched not standing, beacon clear | `smoke.spec`: map renders, beacon visible from the spawn |
| **Collision** | `physics/CollisionWorld.test.ts`: floor / wall contacts reported separately, deepest first; one-sided faces; raycast range and back faces | `player.spec`: walls, desk, duct |
| **Movement** | `player/PlayerMotor.test.ts` (37 tests): direction per key and yaw, acceleration, braking without backslide, diagonal speed, sprint rules, crouch speed / eye ease / headroom / tunnel, jump apex and air time, no repeat, no air jump, jump buffer on/off, coyote time on/off, gravity and terminal speed, ledges, ramp up / sprint down (snap), no sliding standing or landing on a ramp, steep slopes, wall stop and slide, no tunnelling through thin floors and walls, never below the floor, kill-plane respawn | `player.spec`: WASD, turned-view movement, sprint 1.5×, crouch, jump height, no bunny-hop, never below the floor |
| **Look and camera** | `player/PlayerLook.test.ts`: direction, invert-Y, sensitivity scaling, pitch clamp and recovery, yaw wrap, validation. `player/HeadBob.test.ts`: none when still, subtle amplitude, sprint cap, distance-based rhythm, eased fade, paused, disabled | `player.spec`: real mouse → yaw/pitch, sensitivity 2×, clamp at ±89°, invert-Y, FOV, camera follows look; head bob visible when walking, none when still or disabled |
| **Controller and loop** | `player/PlayerController.test.ts` (with the real `InputState`/`ActionMap`); `core/Game.test.ts`: frame systems before steps, while frozen, removal; `player/traversal.test.ts`: player only moves while playing, respawn per run, **identical positions at 30/60/75/144/240 Hz**, **headless walk of the whole map** | `player.spec`: click to play starts the run; **walk of the whole map with real keys** (W/Shift held, C through the duct, Space at the dock); `prod`: strafing and turning move the beacon on screen |
| **Weapon data** (Phase 2) | `config/gameplayConfig.test.ts`: implemented and planned weapons, definitions match ids, kinds and categories, starting loadout, Pistol Pass-1 intents (unlimited reserve, spread and recoil ordering, kick settles within a shot interval, 4 body shots / 2 headshots vs 100 health) | — |
| **Firearm** | `weapons/Firearm.test.ts`: exact fire interval, fractional remainder (4.5 steps per shot averages exactly), no burst after idle, magazine, reload timing, unlimited and finite reserve, reload refusals, no firing while reloading, cancel, refill, infinite ammo, level hits as plain data, misses to range, falloff, pellets split damage, spread cone and stance multipliers, recoil ranges, seed reproducibility | `weapons.spec`: magazine counts down, reload, dry fire + auto reload (dev); HUD ammo (dev and prod) |
| **Hitscan** | `weapons/hitscan.test.ts`: wall and floor hits (distance, point, normal), range, sky, the blockout desk, targets (nearest wins, walls block, removal), spread sampling (inside the cone, fills it, straight up, reproducible), aim conventions | `weapons.spec`: shots hit the desk face |
| **Bare Hands** | `weapons/melee/MeleeWeapon.test.ts`: no ammo, no reload, reach, cooldown | `weapons.spec`: V quick melee, Fire with melee held |
| **Loadout and rules** | `weapons/WeaponManager.test.ts` (42 tests): starting loadout, reset, equip 1/2/3, locked and empty Secondary refused, raise time blocks firing, switching cancels reload, wheel cycles firearms only, semi trigger (one per press, rate cap, buffer, stale press), auto trigger, dry fire and auto reload, no fire during reload, unlimited reserve over many reloads, quick melee (stays on the Pistol, blocks firing, cooldown, cancels reload, always available), melee held + Fire, sprint lockout, acquire (locked, replace with no refund, empty category first, does not fit, melee never empty, future Knife as data, unknown ids), unlock once, determinism | `weapons.spec`: start loadout, 1/3, 2 refused while locked, wheel, V, pointer lock and resume click |
| **Recoil** | `player/PlayerLook.test.ts`: kick, recovery never past the aim, pulling down counts, looking up does not, pitch clamp, reset | `weapons.spec`: recoil settles after firing |
| **Weapons in the loop** | `weapons/WeaponController.test.ts`; `weapons/weapons.integration.test.ts`: nothing outside a run, shots from the eye hit the tower, recoil through the look, magazine/R/dry fire with real mouse and keys, 1/2/3/wheel/V, firing cancels sprint, fresh loadout per run, reproducible shots | `weapons.spec`: all of the above with real input; muzzle flash and impact markers |
| **Combat data** (Phase 3) | `config/gameplayConfig.test.ts`: combat rules, the humanoid rig covers all six zones, feedback timings ordered, drop tables and pickups valid, dummy kinds (standard = 100 health), the range has both kinds on the floor facing the spawn | — |
| **Hitbox rigs** | `combat/hitbox.test.ts` (33): ray–sphere and ray–capsule (sides, caps, along the axis, range, from inside, oblique ray checked against marching), zone resolution for all six zones including the rig's own left and right, facing ±90° and 180°, aiming at every shape's centre from any facing, position, from above, range cap, tie order, pose swap, bounds | `combat.spec`: hitbox visualiser draws 6 volumes per dummy |
| **Damage calculation** | `combat/damage.test.ts` (18): plan multipliers per zone, HEAD from the weapon, target overrides (Tank body, head scaling), crit = headshot only (independent of multiplier size), falloff (and never above 1), falloff × zone, Bare Hands, attacker multiplier, armor floor, resistance, bad inputs → 0 never NaN, purity and determinism, Pass-1 time-to-kill | `combat.spec`: 65 head, 26 body, 16.9 arms, 13 legs |
| **Health** | `combat/Health.test.ts` (12): start value and clamping, non-lethal, lethal with overkill, exactly lethal, floating-point dust, damage after death ignored, bad amounts ignored, heal cap and never while dead, revive, `setMax` | — |
| **Combat system** | `combat/CombatSystem.test.ts` (22): registered with the hitscan, headshot, every zone, 2-headshot and 4-body kills, one `killed` and one `onKilled`, event order, shots after death ignored and passing through to the wall, walls block, nearest target in line (either registration order), falloff at 40 m, overrides/armor/resistance, attacker multiplier, stagger (window, threshold, immune, not on the kill), revive, remove, living count, multi-pellet shots (one kill), Bare Hands in and out of reach, driven by a `WeaponManager` (shot + quick melee; dispose), determinism | — |
| **Training range, drops, pickups** | `combat/training/TrainingRange.test.ts` (9): configured range, headshot from the spawn, death → down → respawn at full health, zoned toughness, sure drop at the feet / failed roll, spawn/remove, reset, revive all. `world/PickupManager.test.ts` (10): spawn, collect in reach only when needed, vertical reach, stays then expires, no collector, cap; `rollDrops` reproducible, matches its chance, clamps and multiplier, one draw per entry. `WeaponManager.addAmmo` | `combat.spec`: pickup collected by walking onto it |
| **Enemy data** (Phase 4) | `config/gameplayConfig.test.ts`: every implemented archetype is consistent (known behaviour and drop table, reach ≥ attack range, wind-up + recovery within the cooldown, lose range > detection range, eyes below the top of the body, patrol pauses ordered); the Walker's intents (under half the player's walking speed, tougher than the basic target, melee; 5 body shots or 2 headshots; a headshot or two quick body shots stagger it, one body shot does not; 7 hits kill the player; backing off during the wind-up escapes it); decisions at 5–10 Hz; the reach pose moves only the arms; the test encounter stands on the floor | — |
| **AI state machine** | `enemies/ai/EnemyStateMachine.test.ts`: the seven plan states; all 49 pairs against an independently written table; DEAD terminal and reachable from every living state; no self-transitions; strict mode throws and changes nothing; listener and time in state; reset for reuse | `enemies.spec`: forced states through `tls.setEnemyState` (illegal refused) |
| **Navigation** | `navigation/RouteGraph.test.ts`: shortest route by distance, exact (not greedy) A*, one-way links, deterministic ties, nearest nodes preferring the same level, broken definitions rejected. `navigation/LineTester.test.ts`: walkable lines (walls, low crates, low openings, the body's width, height difference, ramps), sight, ground, ray counts. `navigation/clearance.test.ts`: bodies against boxes (round footprint), steps, roofs, ramps and stairs in all four directions, the facility (every node fits, tower / crates / walls / duct / under the stairs refused). `navigation/facilityRoutes.test.ts`: the facility graph is connected, every node on the floor, **every link walked both ways by a Walker body** through the real collision | — |
| **Walker behaviour** | `enemies/ai/meleeBrain.test.ts` (25): detection (range, walls, reaction tell, alert from a hit); chase and attack (stops short, one strike per attack at exactly the wind-up, cooldown cadence, dodging by stepping out of reach, committed arc, a wall stepped behind during the wind-up blocks the strike, reach pose for the attack and back to rest, never through a wall, height); stagger (cancels the wind-up, restart, recovery), death during the wind-up; losing the target (dead, range, memory); idle and patrol (near home, no patrol, seeded); think rate (once per interval, spread, configurable) | `enemies.spec`: detect → chase → wind-up (glow) → hit through the player's Health |
| **Enemy manager** | `enemies/EnemyManager.test.ts` (16): combat registration (a headshot from the front), hit volumes follow the body, living cap, unimplemented archetypes refused, `canStand` (room and ground), death once and removal once after the corpse time, double despawn, falling out of the level, pool reuse with fresh state, clear for a new run, drops, inactive / frozen, `forceState`, alert; test encounter (placement, respawn only after its delay, far enough from the spawn) | `enemies.spec`: spawn, cleanup exactly once (view and combat) |
| **Movement** | `enemies/movement.test.ts` (15): a Walker reaches a target in **every area of the facility** (open yard, behind the desk, annex, catwalk, under it, dock, bay, generator, corridor, container) with no wall penetration, no teleport, never below the floor; determinism; turn rate never exceeded, and per second at a 120 Hz step; a crowd spreads out and still arrives; an obstacle the straight-line test cannot see (a low kerb) is bypassed along the route | `enemies.spec`: 16 Walkers stay on the floor and apart |
| **Player health** | `player/PlayerHealth.test.ts` (8): start at 100, damage with source and direction, death once (no damage or vulnerability after), D-029 window, god mode, bad amounts, healing, reset | `enemies.spec`: HUD health, death → game over → new run at 100 |
| **Enemies in the loop** | `enemies/enemies.integration.test.ts` (13): a run goes into `WAVE_ACTIVE`; pause; Pistol vs Walker (headshot 65 + stagger, zones, two headshots / five body shots kill, the body is not hit and is removed, V quick melee); Walker vs player (15 per hit a cooldown apart, one GAME_OVER, no damage after death, restart resets everything, walls block, **identical at 30, 60 and 144 Hz rendering**); Phase 2–3 shots unchanged | `enemies.spec`: body shot, headshot + stagger, recovery, kill, corpse, removal; player death by a Walker; new run; AI and hitbox debug views; production: walk into the yard, get hit and killed, click for a new run (DOM only) |
| **Enemy cost** | `enemies/performance.test.ts`: 1, 4, 8, 16, 32 and 64 Walkers, and 1, 8, 16, 32 and 64 of the mixed roster (Phase 5), chasing: decisions once per think interval and never more than their share in any step, rays per decision bounded, step time within the 4 ms budget, Screamers screaming in the mixed crowd (`PERF_REPORT=1` prints the tables in §7.4) | — |
| **Combat in the loop** | `combat/combat.integration.test.ts` (15): nothing outside a run; from the spawn a click is a headshot, two kill; later shots pass through to the tower; body/arm/leg from the spawn; respawn; reload mid-fight; V quick melee in reach and out of reach; walls block; nearest in line; kill → ammo drop → walk over it (limited reserve) and not taken with the unlimited Pistol; new run restores the range; pause freezes respawns; identical events for the same seed | `combat.spec`: headshot / body / arms and legs with markers and damage numbers; kill, fall, ignored shots, stand-up; reload in combat; V; pickups; hitboxes; numbers off. Production: headshot → kill → ignored → reload → hit again, read from the DOM |

| **Archetype data** (Phase 5) | `config/gameplayConfig.test.ts`: O-3 (the default roster is Walker, Runner, Tank, Screamer; the Climber is neither implemented nor in v1); the Runner's intents (over 3× a Walker's speed, faster than a walk and slower than a sprint, 3 body shots / 1 headshot, any body shot staggers, lighter and lower DPS than a Walker, leaps and weaves); the Tank's (slower than a Walker, 360 health, 6 headshots or ≥ 25 body shots, head-only stagger that a headshot reaches, 3 hits kill the player, a longer telegraph, no ability, a bigger body); the Screamer's (no damage, a scream, wind-up ≥ 1 s, alarm radius beyond its range, preferred band inside its range, cooldown well beyond its cycle, haste between 1 and 1.5, fragile, a body shot interrupts it); threat costs ordered; every rig and pose covers each zone once; the lean is in the Runner's rig (head ahead of the hips, legs upright, within the body; the pose leans the same way); the encounter holds the whole roster and every trait; leaps are counted in the reach and cycle consistency checks | — |
| **Traits** | `config/traits.test.ts` (13): one definition per modifier id; sane multipliers, armor and plates; every trait costs more threat; canonical order and duplicates; unknown traits refused; each trait's effect; composition (multipliers multiply, any input order gives the same result; with test overlays, per-zone armor adds up, plates and bonus drops collect); any archetype, only the traited fields change; purity (the archetype untouched, no shared trait data) | `archetypes.spec`: attachments per trait, applied and removed live |
| **Mitigation** | `combat/armor.test.ts` (14): `ArmorPlate` (absorb, break, stop covering, bad inputs, reset); per-zone armor on top of flat armor, only on its zones, with the damage floor; a helmet absorbs up to its durability then headshots land in full, `armorBroken` once, stagger on breaking (or not, per plate), only its own zones, a killing blow does not also stagger, direct damage ignores plates and armor; stagger zones (body damage never staggers a head-only target; no list = every zone); `configure` changes a live target's profile and back, refuses unknown targets | `archetypes.spec`: armored body shot 16, helmet absorbs and breaks |
| **Runner and Tank** | `enemies/archetypes.test.ts` (18). Runner: ~3× a Walker's top speed and never above its own; closes 20 m far sooner than a Walker, which beats a Tank; notices beyond a Walker's range; weaves in the open (well off the straight line, switching sides) where a Walker does not; never weaves toward a wall, still arrives; the leap (starts beyond its reach, brakes to a stop for the wind-up then stands still, exact wind-up, leaps > 1.2 m well above its running speed, lands one hit for its damage, then recovers); a 1.5 m side-step during the wind-up makes it miss, and the leap stays on its locked line; attacks every cooldown; a hit during the leap staggers it, cancels the attack and nothing lands; body-shot stagger and its duration; death and removal. Tank: its health and slow top speed; torso ½, limbs 0.35, body hits never stagger; a headshot does 65 and staggers for its duration; six headshots or ⌈360 ÷ 13⌉ body shots; heavy hits at exactly its wind-up, a cooldown apart; no ranged attack; its big body gets through the doorway | `archetypes.spec`: Runner chase, wind-up → leap → recovery with the glow, a hit through the player's Health, body-shot stagger, one-headshot kill; Tank wind-up → recovery (no leap), a 35-point hit, soaked torso, headshot stagger |
| **Screamer and the alarm** | `enemies/ai/screamerBrain.test.ts` (20): notices beyond a Walker's range and screams after its reaction time (`kind: 'scream'`); no scream through a wall, even when told where the target is; the telegraph (raised-arms pose for the whole wind-up, alarm exactly at its end, recovery, pose reset); the alarm payload (field by field, nothing Screamer-specific); never deals damage however close; exact cooldown between screams; a hit ≥ its threshold during the wind-up staggers it, no alarm, cooldown still spent; a weaker hit does not interrupt; killed during the wind-up: cancelled, never an alarm; `forceAttack` ignores the cooldown and refuses mid-scream; backs away from a close target, holds inside its band, closes in from beyond it. The manager's response: enemies within the radius alerted and hastened (payload of `hasted`), those beyond untouched, not the source; hastened speed above normal and within the multiplier, back to normal after; the alert lasts its duration, then a distant listener drops the target; repeated alarms refresh, never stack; any source can raise an alarm; the dead do not respond | `archetypes.spec`: scream → alarm (r18, player), wind-up → recovery with the violet glow, shockwave ring, the player's alarm pulse, a distant Walker hastened and alerted, no damage; a forced scream interrupted by a body shot |
| **Traits on enemies** | `enemies/enemyTraits.test.ts` (12): Armored Walker (torso 16, arm 10.9, head 65), Helmeted Walker (first headshot 15 + helmet off + stagger, then 65), Elite Walker (health, stagger threshold, a hit a Walker would stagger from does not, 1.3× damage), Elite bonus drops always pay, unknown traits refused, any archetype takes any trait; at run time health keeps its fraction and combat updates at once (`traitsChanged`), speed changes straight away, a broken helmet stays broken and a re-added one is whole, dead or unknown enemies refused; the pool (a reused enemy starts with only its new traits, whole plates, a clean combat profile; haste does not survive) | `archetypes.spec`: traits on each archetype, live changes redrawn |
| **Mixed groups** | `enemies/mixed.test.ts` (11): 12 of the roster in the facility for 20 s (same navigation, no wall penetration, no pair stacked for more than 0.2 s, everyone on the player, every melee enemy lands hits, Screamers scream and never hit); Runners arrive first and Tanks last; hits land only on the enemy hit, with its own profile; traits, plates and haste stay on their own enemy; pools per archetype; deterministic; a sprinting Runner steers round an oncoming Walker (on its line and 0.25 m off it), Screamer and Tank, never closer than both radii; two Tanks side by side keep both radii plus a margin | `archetypes.spec`: 8 of the roster: every melee kind hits, a scream, the AI view per archetype (ability rings on the Screamers only) |
| **Archetypes in the loop** | `enemies/enemies.integration.test.ts` (+6): the Pistol against every archetype through the real game (headshot outcomes per archetype; body and limb shots land on the zone aimed at with each archetype's multipliers; the Runner's lean is where it is hit; a helmet absorbs, breaks and staggers; an Armored Tank takes 3 per torso shot; each archetype dies once). `navigation/facilityRoutes.test.ts`: **every link walked both ways by each archetype's body** | `enemies.spec` (updated): the five-enemy encounter on a new run; production real-keys run against the new encounter |
| **Wave curves** (Phase 6) | `waves/WaveDifficulty.test.ts` (12): the exact budget table for waves 1–20 (written independently of the formula), max alive, spawn rate, group size, tiers, unlocks, caps, trait chances and Elite limits; the endless tail; monotonic and finite to wave 10 000; bad inputs clamp to wave 1 | `waves.spec`: `tls.waveTable(1, 20)` matches the table |
| **Wave generator** | `waves/WaveGenerator.test.ts` (18): property tests over 30 seeds × waves 1–40 and 50–200: spend within 1 of the budget; roster archetypes only (**never the Climber**, from any modifier source); unlocks, caps, first-appearance = 1, Walkers ≥ 30%, the finale's heavies, trait schedule and Elite limit, heavies out of the opening, mutation and boss slots empty. Determinism by seed and wave; themes never back to back; heavy vs swarm mixes; ambush groups; the modifier channel (adaptation never changes the budget, a mutation's scale is clamped to ×1.5, weights and trait chances clamped, extras only from adaptive modifiers, spawn bias carried) | `waves.spec`: `tls.previewWave` never lists a Climber |
| **Spawn points** | `waves/SpawnDirector.test.ts` (12): too close, in view, behind a wall (eligible), relaxed view, reserved (elevated); over 300 random viewers a pick is never close or visible; every group member fits and can walk from the point; spread (few repeats); bias; determinism; null when nothing is eligible. Level data: every facility point fits every roster body and reaches the route graph; ≥ 12 m from the player spawn; unique ids | `waves.spec`: every wave-1 spawn was eligible for the player's view when it happened; `tls.spawnPoints()` and `tls.showSpawns()` rings |
| **Wave runtime** | `waves/WaveManager.test.ts` (16), headless with the real state machine, facility and enemy manager: intro and first-group timing to the step; every queued enemy spawns exactly once; spawns out of view and ≥ 12 m; `maxAlive` held (wave 12: 17) and refilled as enemies die; completion only when the wave's own enemies are gone; breather → wave 2 (budget 8); debug spawns never block completion; victory after wave 20, endless → 21; death stops spawning and a new run resets; pause freezes everything; an alarm pulls the next group forward with no extra budget; a stalled straggler is moved; no fair point → wait, then the relaxed fallback; run stats (kills per archetype, headshots); determinism; debug jumps from every wave phase | `waves.spec`: banner → active → cleared → breather → wave 2; wave 20 → "Signal transmitted" → new run; `?endless=1` → wave 21; death → "You died · Wave 2" and nothing spawns after |
| **Waves in the loop** | `waves/waves.integration.test.ts` (4), wired as `main.ts`: waves 1–3 announced, spawned fairly, cleared, rested and handed over; damage only while a wave is active (D-029: not in the intro or the breather); death on wave 2 → `GAME_OVER` with the wave reached, nothing spawns after, a new run starts at wave 1; the same seed spawns the same enemies at the same steps at 30, 60 and 144 Hz | `waves.spec` (any build): the HUD reads "WAVE 1", then "WAVE 1 · 6 LEFT" from the DOM alone |
| **Mutation data** (Phase 7) | `config/mutations.test.ts` (11): O-4 (six enabled, LOW GRAVITY and OVERLOAD deferred); SCREAM named Death Cry; deferred mutations stay data with unregistered targets; each mutation's effect kinds; O-7 (none before wave 4, none on 20, each v1 one can appear); BLACKOUT and STATIC share the `vision` group; every effect inside the clamps; every mutation has a rule and a hint; the blackout above the visibility floors with eyeshine, the blood moon only tints, the base look unchanged. `world/levels`: the three emergency lamps sit inside the level | `mutations.spec`: `tls.mutations()` lists six enabled and two deferred |
| **Effect runtime** | `modifiers/modifiers.test.ts` (14): `StatRegistry` ((base + Σadd) × Πmul, the latest override, removal by source, unknown stats and non-finite values refused, version); `TriggerRegistry` (dispatch with params, removal, unregistered actions refused); `ScreenEffects` (no burst before `firstAfter`, lengths and spacing, deterministic per seed, stop, clamps); `EffectRouter` (every v1 mutation applied and removed without a trace, routing per kind, all-or-nothing refusal of a deferred mutation, apply and remove by kind, clamping, a screen effect needs its stream). `world/Environment.test.ts` (6): the base look; fade in, hold, fade out in simulated time; frozen with no steps; priority per channel; floors; restart continues from the current weight, immediate removal | — |
| **Mutation selection** | `waves/WaveMutation.test.ts` (7, + the BLOOD MOON rows below), properties over 50 runs × waves 1–60: none on 1–3 or 20 and exactly one elsewhere; never the same twice, never two `vision` in a row; only enabled mutations from their first wave; every v1 mutation appears, none above 35 %; recent ones come back less often; seeded; a pool of only the previous mutation yields none | `mutations.spec`: `tls.mutationSchedule(1, 20, seed)` has none on 1–3 and 20 |
| **Mutations in the generator** | `waves/mutationWaves.test.ts` (8): for every v1 mutation over many seeds and waves, `maxAlive`, spawn rate, roster (no Climber) and spend unchanged, the budget changed only by HIVE (its data multiplier, ×1.15 since D-046); mutations without spawn rules leave the wave identical; HIVE's surge halfway with a group ≤ 6; surge and Elite fields from other sources ignored, the mutation's clamped; BLOOD MOON ≥ 1 Elite within the raised limit and the same budget, Elites before wave 13, the bonus growing to its clamp; determinism | `mutations.spec`: BLOOD MOON's badge counts the definition's Elites |
| **Enemy hooks** | `enemies/mutationHooks.test.ts` (8): the HUNGER cap is 6.75 m/s; Walker, Runner and Tank cruise faster by the multiplier and an Elite Runner stops at the cap; a hasted enemy already past the cap gains nothing; top speed and acceleration change while running, the leap does not; acceleration follows its own stat (a different multiplier from speed) and a leap keeps its own; no change without the mutation. DEATH CRY alerts and hastens within its reach only with no reinforcements; haste takes the larger boost (never stacked on a scream) | `mutations.spec`: a kill → one `deathCry` alarm (8 m, no reinforcements), a red ring, the other Walkers hasted, no `reinforcementsPulled`, no screen pulse |
| **Mutation lifecycle** | `signal/SignalMutationSystem.test.ts` (11), headless with the real waves and enemies: announced in the intro (lighting only), applied when active, lifted on the clear; HUNGER only while active; DEATH CRY hastens around a kill, no reinforcements, stops with the wave; STATIC seeded, only while active; HIVE's surges arrive from their region under the cap; BLOOD MOON's Elites and red sky; death keeps the lighting and removes the rest, a new run resets it; every v1 mutation leaves nothing after a clear, a death and a new run; debug jumps and forced mutations replace cleanly; deferred refused, mutations switchable off; a run straight through meets exactly `mutationSchedule`, recorded in its stats | `mutations.spec`: each v1 mutation's card → badge → `LIFTED`, sources removed; pause freezes the blackout fade and the next burst; death → "Wave 7 · Blackout", a new run with no mutation and normal light |
| **Mutations in the loop** | `signal/mutations.integration.test.ts` (6), wired as `main.ts` with a scripted defender: waves 4–8 each mutated, announced, applied, lifted, cleared, with nothing left behind; D-029 under a mutation; pause freezes fades and bursts; death then a clean new run; HIVE, DEATH CRY and STATIC give identical timelines at 30, 60 and 144 Hz; **the survival tripwire**: a scripted defender (since D-046 it shoots a melee enemy within 5 m first, then visible non-melee enemies, then the nearest) that clears the unmutated waves 6, 9 and 12 unhurt (10 seeds each, no healing) clears every mutated one without dying, and is hurt somewhere (not vacuous); BLACKOUT and STATIC take exactly the unmutated damage | — |
| **Mutation presentation** | — | `mutations.spec`: BLACKOUT at least 40 % darker, a Walker 12 m away still changes the picture, the emergency pools lit, lighting restored after the clear, **no new shader programs** across all six; STATIC's opacity ≤ 0.35, the badge flickering, crosshair / health / ammo / wave / badge stacked above the layer (hit-tested), the burst ending; HIVE's "HIVE SURGE · <REGION>" before a surge, alive never above `maxAlive`; any build: no badge, card or cue on wave 1, the layer after the canvas and before the HUD, no pointer events |
| **Phase 7.1 data** (D-046) | `config/mutations.test.ts` (+3): STATIC shown as Signal Glitch with glitch params; DEATH CRY's frenzy inside the clamps; BLOOD MOON the only mutation with a guarantee (9–12); the blackout at most 0.15 ambient with eyes, proximity and silhouette inside the floors. `world/Environment.test.ts` (+2): the eye and proximity floors only in the dark, in proportion; a blackout gives silhouettes and fades back to all-zero channels. `modifiers.test.ts` (+3): glitch clamps (6 bands, 4 %, 0.6 %, 50 %, 0.25 s, 3 Hz); a burst carries its glitch params; frenzy params clamped by the router | `mutations.spec`: the card reads SIGNAL GLITCH |
| **BLOOD MOON guarantee** | `waves/WaveMutation.test.ts` (+9): the window is 9–12; the exact rule with a scripted rng per wave (just under 1 / waves-left selects, at it does not); a failed roll is final (the weighted draw never offers it, whatever the next draws); wave 12 always brings it; afterwards the normal rules (no forced roll, no repeat, it comes back); a debug pool without it has no guarantee; over 2000 runs: always first on 9–12, 22–28 % on each wave, conditional rates ≈ 1/4, 1/3, 1/2, 1, reappears later, never twice in a row. `SignalMutationSystem.test`: a played run meets it on 9–12 and matches `mutationSchedule` | `mutations.spec`: over 40 run seeds the first BLOOD MOON is on 9–12 (at least 3 different waves), none on 20 |
| **Frenzy and last-known alerts** | `enemies/frenzy.test.ts` (16): data within the clamps; a completed scream frenzies those within reach (not itself, not the far ones, a `frenzied` event); an interrupted scream frenzies nobody; a frenzied Walker winds up ×0.85 and attacks sooner, back to normal after; turns ×1.6; stagger resistance (a Pistol body shot staggers a Runner, not a frenzied one; the threshold returns after); never stacked (strongest scales, never past one duration from the latest); clamped whoever asks; a pooled enemy comes back clean. Last-known: the listener rushes the kill-time spot and does not track a moving player; a live alert does; it reaches the spot through the doorway and finds the player only by sight; one that never finds the player gives up; one that already sees the player ignores the spot. DEATH CRY end to end: one kill in a crowd of 20 → exactly one cry, no further deaths, never reinforcements; listeners hastened and frenzied, marked `deathCry` | `mutations.spec`: DEATH CRY `lastKnown` at 8 m, every listener frenzied with red eyes; `archetypes.spec`: a scream frenzies the Walker (violet eyes) |
| **The Spitter** (D-046) | `enemies/ai/rangedBrain.test.ts` (19): the wind-up to the step, the acid at its end; a spit every cooldown; standing still costs 14 (never melee); about a second of flight at 14 m, and strafing at walking speed dodges it; a stagger spoils the spit; two headshots / three body shots; closes in from beyond its band and spits only within 18 m; holds inside its band; backs away from a close target and spits only once clear; cornered, spits where it stands; never spits without sight. The acid: the flatter arc at the projectile speed (45° out of reach); splash within its radius only; never through a wall; a wall stops it; D-029 (a target that cannot be hurt takes nothing); expiry, the 32-slot pool, `clear()`; held while paused; deterministic. `WaveGenerator.test` (+2): none before 10, exactly one on 10, capped, never in the opening, a regular after; waves 1–9 identical to a roster without it. `facilityRoutes.test`: every link walkable by its body. `mutations.integration.test` (+2): acid in flight never outlives its wave, the run, or survives into a new run; a Spitter volley, death-cry frenzies and last-known rushes identical at 30, 60 and 144 Hz. `mixed.test`: Spitters spit, every hit is a strike or acid | `archetypes.spec`: a Spitter 12 m away telegraphs (glow, phases), its acid is drawn in flight, standing still costs 14, moving during the flight costs nothing, rushed it backs off past 7 m, two headshots kill it; the mixed group of 10 needs a spit |
| **Enemy presentation** (no GPU) | `enemies/EnemyView.test.ts` (9): every enemy material shares one patched program, eyes marked in the geometry (eyes only); the patch's exact eye-glow, silhouette and proximity lines; the environment drives every enemy's eye and body shading, none on a body on the ground; frenzied eyes red / violet, calm after; the Signal Glitch lag (drawn speed × desync behind, hit volumes unmoved, back in place after); a scream's three rings and tall column, a death cry's two rings and short flare, never more than 8 rings; acid blobs per projectile and splats | — |
| **Signal Glitch** | `render/glitch.test.ts` (6): idle outside a burst (or one without glitch params); the envelope; at most 3 tear patterns a second, the same bands within a step; seeded bands within range; the clear-centre mask (0 at the crosshair, 1 beyond 22 vmin); reduced motion (no steps, tears, afterimage or lag; colour split only) | `mutations.spec`: during a forced burst a moving Walker is drawn behind its real position (> 5 cm) and in place after; ≤ 3 patterns; held mid-burst, a still frame with a Walker at the crosshair tears away from the centre (outer diff > 3) but not at it (< 4, under half the outer); program ids constant. BLACKOUT: ≥ 60 % darker; the view's shading gets eye glow 1.4, silhouette 0.75, proximity 0.6; at 12 m the eye peak > 100 and > 3× the torso, the torso ≤ 30 % of the wall; at 3 m the torso lifted by > 10 |
| **Adaptation data** (Phase 8) | `config/adaptation.test.ts` (10): every plan §15 metric maps to a measured signal; adaptations keyed, in known families, on real signals; hysteresis (every exit below its enter, signal and confidence); one wave of perfect evidence never reaches an enter confidence; timers (rests, the forced fade, never before wave 5); every response inside the adaptive caps and the generator's clamps; level 2 never asks for less than level 1; mutation discounts only shrink and name enabled mutations; WEAPON_FOCUS dormant; every analysis line written | — |
| **Adaptive core** | `adaptive/adaptive.test.ts` (32), pure functions: measuring a wave (elevation, the dwell area, sprint and kite, range, headshots gated by accuracy, priority and neglect, strain, attribution ×0.25, mutation discounts); the profile's exact maths (fold, decay, confidence 0.5 after one extreme wave, 0.85 after two, a high and a low wave never 0.6, `normalizeProfile`); the director (no entry before wave 5 or 2 waves, enter, escalate after 2 waves, fade on the exit thresholds, a forced `rest` after 4 waves, cooldowns, one per family, 2 at most, the governor holding and dropping level 2, nothing for the finale, deterministic ties); composition (levels, the Climber's fallback before wave 8, the dwell regions); properties over many seeded behaviour sequences (never more than 2, never past level 2, never two of a family, constant extreme behaviour fades and rests); an import boundary (no adaptive module imports the mutation system, its selector or its effects) | — |
| **Adaptive waves** | `waves/adaptiveWaves.test.ts` (6): 23 allowed pairs at level 2 × 500 seeded waves (5–30): only the mix changes (budget, concurrency, pacing, tier, theme, mutation, groups, surges identical; caps hold; Climbers only from wave 8, ≤ 2, trait-free, not in the opening); never more bodies (mean ×0.85–1.1, max ×1.1, over 150 seeds × 8 waves); the adaptive source cannot reach mutation-only fields, Elites or traits before their schedule; its own clamp is exact; the finale ignores it; mutation selection never depends on it | — |
| **The Climber** | `enemies/climber.test.ts` (6): only a climbing body's routes use climb links, every other route identical over every pair of nodes; every climb clear for its body and landing on the top; it comes up onto the catwalk sooner than a Walker takes the stairs; it never attacks from the wall; a body shot knocks it off; killed on the wall it lies at the foot; elevated spawn points only for an all-Climber group and never while the player is up there. `WaveGenerator.test.ts`, `EnemyManager.test.ts`, `gameplayConfig.test.ts`: implemented, not in the roster | `adaptation.spec`: a Climber comes up the wall at the perch, a hit knocks it off, no new program |
| **Adaptation in the loop** | `adaptive/adaptive.integration.test.ts` (5), wired as `main.ts`: a catwalk camper gets HIGH_GROUND on wave 5, level 2 on 7, 2 Climbers on wave 8 and a rest on 9, while a roamer gets nothing; nothing decided during a wave; counting only in WAVE_ACTIVE (not paused, not in the breather); a new run forgets everything; identical decisions and waves at 30, 60 and 144 Hz; the mutation schedule identical with and without adaptation. `adaptive/adaptive.tripwire.test.ts`: the survival tripwire (BALANCING §2.17) | `adaptation.spec` (5): SIGNAL ANALYSIS only between waves and the next wave carries the answer, mutations unchanged; a real camp on the catwalk is what the telemetry sees; the end screen names the adaptations and a new run forgets them; any build: the card sits under the HUD, hidden, never taking the mouse |
| **Sandbox mode** | — | The Phase 2–5 specs open `?sandbox=1` (training range, test encounter, one open-ended wave) through `openGame`; `waves.spec` opens the real wave-driven run |

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
  - Phase 7: 32 of 32 Signal Mutation bugs caught, across:
    - selection: mutations on waves 2–3 or on wave 20, the same one twice, two sight mutations in a row, `minWave` ignored, deferred mutations selectable, the recent-use penalty ignored;
    - the generator: adaptive budget changes, BLOOD MOON's guaranteed Elite, the Elite bonus unclamped or not growing with the wave, surge size and count unclamped, the mutation's composition dropped;
    - the wave runtime: a surge above `maxAlive`, a surge without its warning, every alarm (or a death cry) pulling reinforcements, a regenerated wave keeping its old history entry;
    - the lifecycle: HUNGER live during the announcement, a stat left after the clear, an overlay left after a new run, effects kept after death, the STATIC stream not seeded per wave;
    - enemies: the speed cap ignored, the acceleration stat never read;
    - the effect runtime and environment: speed, death-cry radius and STATIC opacity unclamped, bursts closer than the photosensitivity limit, the blackout below its visibility floor, overlays blended out of priority order.
  - Phase 7 first run: 31 of 32. The survivor (the acceleration multiplier never read) had no direct test; a new one gives the two stats different multipliers and checks the enemy's ground acceleration and a leap's. Every file was restored byte-identically (hash-checked), in a separate git worktree.
  - Phase 8: 28 of 28 unit-level bugs caught (23 of 29 on the first run), each applied alone with the adaptive, wave, navigation and Climber tests run and the file restored byte-identically (hash-checked):
    - the profile: one wave enough (full mass 1), no decay, persistence ignored in confidence, a mutation discount ignored, attribution off;
    - the director: hysteresis inverted, the rest ignored, a third adaptation, two from one family, the governor never on, escalation without waiting, no forced fade;
    - the generator: an adaptive budget change accepted, extras from any source, the Climber before wave 8, the adaptive weights not clamped on their own, adaptive traits before their schedule, an adaptive Elite chance, adaptation reaching the finale, the Climber in the opening;
    - the Climber: spawning on the player's perch, every body climbing, attacking from the wall, a stagger not knocking it off, a body killed on the wall floating there;
    - the lifecycle: decisions taken when a wave starts, no reset on a new run, debug-kill damage counted as the player's hits.

    The first run missed five, all fixed by stronger tests:
    - **Hysteresis inverted:** the old test's "between the bands" mean was not between them. A handmade profile (mean 0.4, confidence 0.75) now stays active, does not enter, and fades at 0.29.
    - **The adaptive weight clamp and an adaptive Elite chance:** the old checks used bounds the global clamps also satisfy. Waves are now compared exactly: an over-weight gives the same wave as the clamp, and ignored fields (Elite chance, budget, Elite limits) give the plain wave.
    - **Every body climbing:** a Walker's route must never take a climb and must still reach the catwalk; every route is compared with a graph without climbs.
    - **Attacking from the wall:** the target now stands at the top of the climb, in reach halfway up.

    The sixth, "telemetry counts outside the wave", is an equivalent mutant: wave enemies exist only while a wave is fought, the player cannot be hurt outside it (D-029), and a wave's evidence is measured when it ends and reset when the next starts. A test checks that counting stops while paused and in the breather.
  - Phase 8, end-to-end: 6 of 6 planted bugs caught by `adaptation.spec`, in a separate git worktree: SIGNAL ANALYSIS shown during a wave, never shown, the end screen not naming the adaptations, adaptation never reaching the waves (`main.ts`), the telemetry never seeing the player, and the card taking the mouse. Two first plants removed code outright and broke the production typecheck; they were re-planted as bugs that compile.
  - Phase 7.1: 36 of 36 unit-level bugs caught (33 of 34 on the first run; two more were added afterwards):
    - BLACKOUT: eyes glowing the whole body again; the blackout below its floor; no eye or proximity floor; the view ignoring the eye glow; frenzied eyes in their normal colour; the silhouette or proximity line removed from the shader;
    - Signal Glitch: active outside the burst envelope; tear steps 4× faster; the step rate unclamped; reduced motion keeping the tears; no clear centre; the enemy lag measured from now;
    - HUNGER past its clamp; DEATH CRY tracking live, pulling reinforcements, or losing its frenzy; frenzy stacking, never expiring, its wind-up below the clamp, its stagger resistance never applied; the last-known spot tracked live; a scream going off at the start of its wind-up;
    - BLOOD MOON: the guarantee roll off by one, forcing repeats after its first appearance, the weighted pool offering it as a second path;
    - the Spitter: no wind-up, spitting without sight, spitting point-blank instead of backing off, splash through walls, acid surviving the wave end, acid ignoring the level, allowed in the opening, before wave 10, uncapped.

    The first run missed "acid survives the wave end": the test's acid landed on its own before the wave ended. It now hangs in the air, so only the run's clears can remove it. Every file was restored byte-identically (hash-checked).
  - Phase 7.1, end-to-end: 10 of 10 planted bugs caught by `mutations.spec` / `archetypes.spec`, in a separate git worktree:
    - the silhouette channel never reaching the view; no proximity lift; the view's dark channels never set;
    - no clear centre in the glitch shader; the glitch never drawn; the glitch quad not prewarmed (compiled mid-fight); the enemy lag left on outside bursts;
    - the acid never drawn; a scream's sonic wave a single ring; a death cry's echo a single ring.

    The runs found two weak checks, both fixed:
    - **The silhouette:** under blackout light a body is near-black with or without the darkening (it matters in the pools and the muzzle flash). The screen could not tell, so the exact shader lines are checked in the unit test and the shading uniforms in the browser test.
    - **The clear centre:** it was measured on a flat wall, where a tear shows nothing. A frozen Walker now stands at the crosshair.

    After the glitch pass was rebuilt (it renders into a target, §8), the two glitch plants were re-run:
    - "the glitch never drawn" was caught;
    - "no clear centre" **passed**: the tear pattern is random per burst, and a band seldom crosses the crosshair row.
    The test now holds bursts until a strongly shifted band (|shift| > 0.5) crosses the centre row (the bands are in `GlitchState`). With the plant the centre difference is 17–26, against 0 without it: caught 3 of 3.
  - Phase 7, end-to-end: 14 of 14 planted presentation and wiring bugs were caught by `mutations.spec`, run in a separate git worktree (after a clean baseline run):
    - the STATIC layer above the HUD or blocking the mouse;
    - the badge, the intro card or the surge cue never shown;
    - BLOOD MOON's badge counting the wrong trait;
    - the badge not flickering with STATIC;
    - the game-over prompt without the mutation;
    - mutations never attached in normal play;
    - the lighting not following the environment;
    - a light added when a blackout starts (every lit shader recompiles);
    - the death-cry and scream rings swapped;
    - a screen pulse on death cries;
    - the STATIC layer showing behind the pause prompt.

    The runs found five gaps, each now fixed:
    - A recompile can release old shader programs, so their count may not change; the check now compares program ids.
    - The DEATH CRY Walkers stood outside the cry's 8 m, so a wrong pulse could never show.
    - A STATIC burst could fall between two polls at software-rendering frame rates; the page now samples every frame.
    - The pause check forced a burst and paused in the same call, freezing the burst before its fade-in, so a layer showing behind the pause prompt could not be seen; it now pauses on the first frame the layer shows.
    - The layer clearing after a burst was only awaited; it is now required at once when simulated time passes the burst's end.

    Five plants first left an unused variable and failed the production build's type check (caught by the toolchain, not by the spec); they were rewritten to compile. One plant (the floor pools skipped by the start-up compile) was equivalent: `compile()` covers hidden objects anyway. It was replaced by the runtime light. So was a plant making the layer linger after its burst: the screen-effect schedule already reports no burst then.
  - Phase 6: 45 of 45 wave-system mutations caught, across:
    - the curves: budget terms, the endless tail, max alive (and its endless cap), unlocks, caps, the trait ramp;
    - the generator: the Elite limit, extras from any source (the Climber path), adaptive budget changes, unclamped budget scale and weights, introductions, the Walker floor, the remainder, heavies in the opening, repeated themes, the finale's heavies, trait costs, the ambush bonus;
    - the runtime: max alive, completion counting debug spawns, victory and endless, the alarm pull-forward adding enemies, stats reset, breather, intro, first-group delay, relaxing the view rule, stragglers, alarms, spawning after death, headshots, spawned enemies not alerted;
    - spawn points: the view rule, line of sight, the view-cone margin, minimum distance, the reserved point, repeat penalty, bias, walkable group slots, body fit;
    - deaths reporting traits.
  - Phase 6 first run: 37 of 45 were caught. One survivor was equivalent (the trait gate one wave early, where the ramp already gives 0) and was replaced by a real ramp off-by-one. The other seven led to new tests: each spawn's cost against `applyTraits` (the cost was only checked against itself), a roster without Walkers still spending its budget, weights past the clamp giving the same wave, the view cone's margin, group slots cut off from their point, spawned enemies alerted the moment they spawn, deaths reporting traits (and Elite kills in the run stats). Every file was restored byte-identically (hash-checked).
  - Phase 6, end-to-end: 8 of 8 planted HUD and wiring bugs were caught by `waves.spec`, run in a separate git worktree so the working tree stayed clean: the LEFT count showing only living enemies, no announcement banner, no breather countdown, victory showing the game-over prompt, end prompts without the wave reached, waves never attached in normal play, damage allowed between waves (D-029), and the `?endless=1` flag ignored.
  - Phase 5: 49 of 49 archetype and trait mutations caught, across:
    - the Runner: the weave never switching sides, weaving into walls, never weaving, the side never steered, no leap, a leap that never ends, a leap that tracks the target, a leap at running speed, no landing brake, a stagger not cancelling a leap;
    - the Tank: stagger zones ignored or not registered, body resistance lost;
    - the Screamer: an interrupted scream costing no cooldown, screaming without sight, no wind-up, never backing away, always approaching, a scream that hurts;
    - the alarm: payload radius or target missing, heard at any distance, the source hastening itself, haste stacking, never expiring or not reaching the motor, an alert lasting forever;
    - traits: non-canonical order, multipliers overwriting, per-zone armor overwriting, no Elite bonus drops, a trait change refilling health, restoring a broken helmet or not reaching combat, pooled enemies keeping plates or haste;
    - combat mitigation: per-zone armor ignored or applied everywhere, a helmet covering every zone, still absorbing when broken, never wearing out, no stagger on breaking, `armorBroken` on every hit, `configure` keeping old plates;
    - movement, rigs and data: separation ignoring body size, not anticipating closing bodies, ignoring the closing speed; the lean reversed; the Climber in the roster.
  - Phase 5 first run: 40 of 48 were caught. The eight survivors led to new or stronger tests:
    - the weave: switching sides, and never toward a wall;
    - the leap: its speed, and a side-step small enough that a tracking leap would land, with the leap checked against its locked line;
    - a Screamer told where a target is behind a wall does not scream;
    - trait overlays of the same kind composing;
    - two Tanks' room.
  - The survivors also exposed a real weakness: the planned speed-scaled separation push did not stop a sprinting Runner running through an oncoming enemy head-on. Separation now anticipates closing bodies (D-043), with head-on tests for every archetype. Every file was restored byte-identically (hash-checked).
  - Phase 5, end-to-end: 4 of 4 planted presentation and wiring bugs, which no unit test loads, were caught by `archetypes.spec` and `enemies.spec`:
    - the alarm pulse never updated;
    - the scream's shockwave ring never started;
    - a broken helmet still drawn;
    - the test encounter dropping its traits.

    A first attempt at three of them removed code outright and left an unused method or variable. The typecheck in the build caught those before any browser test ran, so they were re-planted as bugs that compile.
  - Phase 4: 46 of 46 enemy mutations caught, across the state machine (a dead enemy chasing again, ATTACK straight from IDLE), perception (seeing through walls, detection range ignored, targets never forgotten, a dead target kept, alerts forgotten beyond the lose range, no reaction tell), the attack (a strike every step, no wind-up, no cooldown, attack range = detection range, a strike through a wall stepped behind during the wind-up, the reach ignored, the committed arc ignored, the facing tracking the target, the attack pose never reset), stagger (not cancelling the wind-up, never recovering), movement (unlimited turn rate, turning per step instead of per second, separation pulling together, re-plans restarting from the nearest node, a straight-line test ignoring the body's width, a greedy A*, never giving up a blocked straight walk, cutting corners back into the obstacle, never lifting the block, hit volumes not following the body), limited-rate AI (thinking every step, everyone thinking on the same step), lifecycle (bodies never removed, ghost hit volumes after removal, pooled enemies keeping their health or AI state, fallen enemies never removed, dead enemies still acting, the encounter respawning at once), combat and player (direct damage to the dead, hits not alerting, damage after death, damage outside the D-029 window, death announced on every hit, a new run not restoring the player) and spawn clearance (ramps ignored, square footprint). The first run caught 34 of 44. The survivors exposed eight missing tests, one equivalent mutant (a pooled enemy's target is already cleared on release; replaced), and a real weakness: after a straight walk failed on an obstacle the rays cannot see (a low kerb), the enemy cut corners straight back into it and retried after a fixed 2 s, so it never got round. It now follows the route link by link until the route ends or it reaches its target (D-042), with a test. Every file was restored byte-identically (hash-checked).
  - Phase 4, end-to-end: 4 of 4 planted wiring bugs in the composition root (`main.ts`, which no unit test loads) were caught by `enemies.spec`: a new run keeping the dead player's health (the dev new-run test, and the real-keys test in dev and production), a new run keeping the old enemies (the dev new-run test: wrong ids and positions), the player's death never ending the run, and runs staying in `WAVE_START` so the player can never be hurt (both also caught in production).
  - Phase 3: 21 of 21 combat mutations caught: wrong headshot multiplier, damage applied twice, damage after death, death event fired twice, rig rotation sign flipped (wrong zone), last shape winning instead of the nearest (wrong zone), falloff ignored, walls not blocking targets, dead targets still hittable, nearest target not preferred, arm multiplier wrong in config, armor ignoring the damage floor, stagger window never expiring, dummies never standing up, drop chance inverted, pickups taken when not needed, ammo added to unlimited reserves, quick melee never damaging, healing above the maximum, broad phase ignoring shape radii, crit flag on every strong zone. The first run caught 17; the 4 survivors exposed missing tests (rigs only tested facing 0° and 180°, crit only tested with default multipliers) and two equivalent mutants (a redundant stagger reset was removed; the wall mutant was re-planted as the real two-part bug). Every file was restored byte-identically (hash-checked).
  - Phase 2: 17 of 17 weapon mutations caught (shots not spending ammo, fire-rate remainder dropped, firing while reloading, reload ignoring a finite reserve, no falloff, crouch spread inverted, locked Secondary reported as empty, semi-auto firing while held, switching keeping the reload, quick melee switching to melee, wheel cycling into melee, acquiring into a locked Secondary, no auto reload, firing during quick melee, recoil never applied, recovery overshooting the aim, walls not blocking targets).
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

### Weapons (Phase 2)
- [ ] **Start:** a run starts holding the Pistol (`12 / ∞`), with Bare Hands and a locked Secondary (dev: `tls.weapons()`).
- [ ] **Pistol feel:** one shot per click, no faster than ~6/s however fast you click; a click just before the Pistol is ready still fires; the kick is visible but settles before the next aimed shot.
- [ ] **Reload:** R reloads (≈1.3 s, the gun dips, the HUD says RELOADING); clicking during a reload does nothing; an empty magazine clicks and reloads by itself.
- [ ] **Switching:** 3 holds the fists (left click punches), 1 returns to the Pistol, 2 does nothing (Secondary locked), the wheel returns from fists to the Pistol.
- [ ] **Quick melee:** V punches without putting the Pistol away, from any state (also mid-reload, which cancels it).
- [ ] **Shots:** impact marks appear where shots hit walls, floors and crates; the muzzle flash is visible at 60 Hz and above.
- [ ] **Sprint:** shooting while sprinting stops the sprint briefly.
- [ ] **Resume:** after Esc, the click that resumes does not fire.

### Combat (Phase 3)
- [ ] **Range:** three dummies in the yard face you at the start; the left one has painted zones (yellow head, white torso, blue arms, green legs).
- [ ] **Headshot:** from the spawn, one click hits the dummy ahead in the head: gold hit marker, gold "65", a spark, the dummy flashes and rocks back.
- [ ] **Body, arms, legs:** on the zone dummy, body shots show a white marker and "26"; arms "17"; legs "13". The zone hit matches the colour you aimed at (dev: `tls.showHitboxes()` draws the volumes).
- [ ] **Kill:** the second headshot shows the red kill marker; the dummy falls; shots at it now hit the tower behind; after 3 s it stands up again.
- [ ] **Melee:** walk up to a dummy and press V: "15", the Pistol stays in hand. With fists held (3), left click punches for 15.
- [ ] **Walls:** a dummy behind a wall or the tower cannot be hit.
- [ ] **Feedback feel:** markers are readable but not distracting; damage numbers can be turned off (dev: `tls.damageNumbers(false)`).
- [ ] **Performance:** firing continuously at the dummies causes no hitch, including the very first shot of a session.

### Enemies (Phase 4)
- [ ] **Encounter:** at the start, standing at the spawn, nothing attacks. Two Walkers stand guard to either side of the yard ahead; a third wanders the north-east yard. Health reads `HEALTH 100` bottom left.
- [ ] **Detection:** walk north into the yard: a guard notices you (it turns to face you for a moment), then walks straight at you. It never passes through walls, crates or the tower.
- [ ] **Telegraph and dodge:** when it reaches you it stops, raises its arms and glows orange; step back or to the side before the glow peaks and it misses. Stay and you lose 15 health, with a red flash at the screen edges. It swings again at most every ~1.6 s.
- [ ] **Shooting it:** body shots take 5 to kill, headshots 2. A headshot makes it rock back and interrupts a wind-up. A killed Walker falls, lies for 5 s, sinks and is gone; about 10 s later it is back at its post.
- [ ] **Chase everywhere:** lead one into the control room (through the door), up the stairs or ramp onto the catwalk, onto the dock and into the generator hall: it follows without getting stuck (dev: `tls.showAI()` shows its route in cyan).
- [ ] **Death and restart:** let the Walkers kill you: "YOU DIED / Click to start a new run", the mouse is released and nothing moves. Clicking starts a new run at full health with the three Walkers back at their posts.
- [ ] **Crowd** (dev): `tls.setGodMode(true)`, then `tls.spawnWalkers(24)` and `tls.alertEnemies()`: they surround you without stacking inside each other; the frame rate stays smooth (§7).
- [ ] **Debug views** (dev): `tls.showAI()` labels each Walker with its state and health and draws its detection (yellow) and attack (orange) range; `tls.showHitboxes()` matches the drawn bodies, including the arms raised in the wind-up.

### Archetypes and traits (Phase 5)
- [ ] **Encounter:** at the start, standing at the spawn, nothing attacks. A Walker with a steel helmet and a huge dark Tank with steel plates stand guard to either side of the yard; a lean, red-eyed Runner wanders the north-east yard; a tall, pale Screamer with a gaping mouth stands by the north wall; a Walker with bone spikes (Elite) wanders the north-west yard.
- [ ] **Runner:** it is on you fast, zig-zagging in the open; walking away does not escape it, sprinting does. When close it crouches with an amber glow, then leaps: side-step during the crouch and it misses. One body shot knocks it back (and out of a leap); a headshot kills it.
- [ ] **Tank:** slow; body shots barely hurt it (the hit marker is a normal hit, damage numbers 13); a headshot rocks it back. Its red wind-up is long; if it lands you lose 35.
- [ ] **Screamer:** it keeps 6–11 m away and backs off if you rush it. It raises its arms and glows violet, then screams: a violet ring spreads from it, the screen edges pulse violet and shake, and nearby zombies come for you faster. Shooting it during the wind-up stops the scream.
- [ ] **Traits:** the helmet takes the first headshot (small damage number, a steel-blue hit marker), falls off and the zombie rocks back; the next headshot does full damage. Body shots on an Armored enemy show the steel-blue marker and lower numbers. An Elite takes clearly longer to kill and always drops ammo.
- [ ] **Mixed group** (dev): `tls.setGodMode(true)`, `tls.spawnMixed(16)`, `tls.alertEnemies()`: they arrive in waves (Runners first, Tanks last), nobody stands inside anybody, the frame rate stays smooth.
- [ ] **Debug** (dev): `tls.spawnEnemy('tank', 6, 'armored,elite')`, `tls.applyTrait(id, 'helmeted')`, `tls.removeTrait(id, 'elite')` change the body at once; `tls.forceAbility(screamerId)` screams now; `tls.showAI()` labels show traits and HASTE, and Screamers get a violet ring (the scream's reach); `tls.showHitboxes()` matches the drawn bodies, including the Runner's lean and the Screamer's raised arms.

### Waves (Phase 6)
- [ ] **Run start:** click to play: "WAVE 1" in the middle of the screen for about 3 s, then "WAVE 1 · 6 LEFT" top left. Nothing attacks during the announcement.
- [ ] **Fair spawns:** zombies never appear in plain sight or right next to you; turn around slowly and they come from behind walls, doorways and the far edges. `tls.showSpawns()` (dev): the rings in front of you are red, the ones behind you or behind walls green, those within 12 m orange, the catwalk violet.
- [ ] **Clear and breather:** kill the last zombie: "WAVE 1 CLEARED · NEXT WAVE IN 10" counts down; you cannot be hurt; then "WAVE 2". Health does not refill.
- [ ] **Introductions:** a single Runner on wave 3, a single Screamer on wave 4, a single Tank on wave 6 (`tls.startWave(n)` to jump). Later waves feel different from each other (swarms of Runners, heavy Tank waves, ambushes of bigger groups).
- [ ] **Scream:** during a wave, when a Screamer screams, the next group arrives at once from its side of the map.
- [ ] **Victory:** `tls.startWave(20)`, `tls.skipWaveTimer()`, `tls.completeWave()`: "Signal transmitted · Wave 20 cleared"; click starts a new run at wave 1. With `?endless=1` the run continues to wave 21.
- [ ] **Death:** dying shows "You died · Wave N"; a click starts again at wave 1 with a fresh HUD.
- [ ] **Sandbox:** `?sandbox=1` still shows the training range and the test encounter, with no wave HUD.

### Signal Mutations (Phase 7)
- [ ] **None early:** waves 1–3 have no badge or card. From wave 4 every wave shows a card under "WAVE N" (name, rule, hint) and a badge top centre for the whole wave; the breather shows "… LIFTED". `tls.startWave(n, 'BLACKOUT')` etc. (dev) jumps to one.
- [ ] **BLACKOUT:** the lights fade during the announcement; the red emergency lamps (control room, generator hall, yard tower) glow and throw a pool of red light on the floor; each shot lights the area; zombies are still visible as dark shapes with glowing eyes at 15 m; the HUD is unchanged. The light returns in the breather. Is it tense rather than frustrating? (O-10: note whether a flashlight is missed.)
- [ ] **HUNGER:** zombies are clearly faster, but sprinting still gets away from every one of them; the Runner's leap looks the same.
- [ ] **STATIC:** short bursts of interference every few seconds; the crosshair, hit markers, health, ammo and badge stay readable; no fast flashing; with reduced motion enabled in the OS the grain does not move.
- [ ] **DEATH CRY:** each kill shows a small red ring; zombies inside it speed up for a moment; no violet pulse at the screen edges and no extra zombies. A Screamer's scream still looks different (violet, bigger, the screen pulses).
- [ ] **HIVE:** halfway through the wave "HIVE SURGE · <direction>" and an arrow; about 2 s later a bigger group comes from there. The wave is longer, not more crowded.
- [ ] **BLOOD MOON:** a red sky; the badge counts the Elites (≥ 1); Elites are recognisable (spikes, pale eyes).
- [ ] **Death and restart:** dying during a mutation shows "You died · Wave N · <Mutation>"; the new run has normal light and no badge.
- [ ] **Pause:** Esc during a blackout fade or between STATIC bursts: everything holds; resume continues where it was.

### Phase 7.1 (D-046)
- [ ] **BLACKOUT silhouettes:** zombies are dark shapes with glowing eyes, darker than the walls behind them; one walking into an emergency pool or lit by your muzzle flash is a black shape against the light; one within 2–3 m is clearly readable (its body, not only its eyes). Telegraph glows still show at full strength. Is it tense rather than unfair? Is a flashlight still wanted (O-10)?
- [ ] **Signal Glitch:** the card says SIGNAL GLITCH. During a burst the 3D image tears into slipping bands with a slight colour split and an afterimage; zombies flicker a little behind where they are (shots aimed slightly ahead hit); the crosshair area and the HUD stay clean; no fast flashing (at most 3 changes a second). With OS reduced motion: only a slight colour split. Comfortable?
- [ ] **DEATH CRY:** each kill shows a red echo (two rings, a short flare); nearby zombies' eyes flare red and they rush where you stood; moving away right after a kill makes them overshoot; no extra zombies, no screen pulse.
- [ ] **Screamer:** a completed scream sends a violet wave (three rings and a column); the pack's eyes flare violet and they attack noticeably more often for a few seconds; killing or interrupting the Screamer first clearly pays.
- [ ] **BLOOD MOON:** in a run played straight through, it appears on one of waves 9–12.
- [ ] **Spitter (wave 10+):** its wind-up (rearing back, a green glow) is readable from across the yard; the acid glob is visible in flight and dodgeable by strafing; standing still costs 14; rushing it makes it back off; two headshots kill it. Does it feel fair?
- [ ] **HUNGER:** still ×1.15 (the tripwire limit): judge whether it needs to be faster (PROGRESS "Needed from you").

### Adaptive System and the Climber (Phase 8, D-047)
- [ ] **Camping the catwalk:** stay on it for waves 1–4. After wave 4 the breather shows SIGNAL ANALYSIS: "The horde has noticed your perch. Climbers are coming." Waves 5–7 bring Runners and spawns from your side (Climbers come from wave 8). Does the card read clearly, and is it absent during waves?
- [ ] **The Climber (wave 8+):** pale grey-blue and crouched; it walks to the foot of the catwalk and climbs with its arms up, about two seconds; one body shot knocks it off; two headshots kill it; it never hits you from the wall. Does it feel like a fair answer to the perch, not a punishment?
- [ ] **Changing style:** come down and roam for two waves: the card says the signal lost your perch (or the horde regroups after four waves). Does the horde feel like it learned, rather than random?
- [ ] **Other styles:** kiting at a sprint (Runners), staying in one room (spawns around it, Spitters), letting Screamers scream (more Screamers), headshots only (helmets from wave 8). Each change is told between waves.
- [ ] **Bleeding:** take heavy damage two waves running: "You are bleeding. The horde hesitates, for now." Nothing new comes.
- [ ] **End screens** name what the horde adapted to; a new run starts clean (`tls.adaptation()` empty).

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

**Phase 2 baseline (2026-09-26, weapons, no enemies):**

| Resolution | Preset | Firing | FPS (SwiftShader) | Our frame cost avg / p95 / max (ms) | Draw calls | Triangles | Programs |
|---|---|---|---|---|---|---|---|
| 1920×1080 | High | no | 5.7 | 1.18 / 2.5 / 2.8 | 13 | 1,148 | 6 |
| 1920×1080 | High | yes, ~6 shots/s, 27 impact markers | 5.6 | 1.31 / 3.3 / 4.6 | 41 | 1,204 | 6 |
| 1920×1080 | Low | yes, 32 markers | 7.0 | 1.07 / 2.0 / 2.5 | 46 | 1,214 | 6 |
| 1366×768 | High | yes, 32 markers | 10.2 | 0.98 / 1.5 / 3.7 | 46 | 1,214 | 6 |

- **Weapon simulation (Node, headless):** 0.45 µs per step idle, 2.7 µs per step firing every step, 0.34 µs quick melee; one hitscan ray against the blockout ≈ 1 µs.
- **Reading:** firing adds ~0.1 ms to our frame cost. The view model adds 2 draw calls; each impact marker adds one (32 at most). All far inside the budgets; nothing was optimised.

**Phase 3 baseline (2026-09-26, combat against training dummies, development build, firing ~6 shots/s at the dummies for 5 s):**

| Resolution | Preset | Dummies | Firing | FPS (SwiftShader) | Our frame cost avg / p95 / max (ms) | Draw calls | Triangles | Programs |
|---|---|---|---|---|---|---|---|---|
| 1920×1080 | High | 3 (the range) | no | 6.4 | 1.29 / 2.3 / 3.3 | 22 | 9,812 | 8 |
| 1920×1080 | High | 3 | yes | 6.4 | 1.98 / 4.7 / 8.2 | 21 | 9,800 | 8 |
| 1920×1080 | High | 24 | yes | 5.0 | 2.51 / 5.6 / 10.8 | 58 | 58,494 | 8 |
| 1920×1080 | Low | 24 | yes | 6.9 | 2.56 / 6.0 / 6.4 | 59 | 62,796 | 8 |
| 1366×768 | High | 24 | yes | 8.1 | 2.18 / 3.8 / 9.6 | 60 | 62,798 | 8 |
| 1920×1080 | Low | 60 (stress) | yes | 5.9 | 2.85 / 5.5 / 6.5 | 113 | 141,532 | 8 |

- **Combat simulation (Node, headless):** `computeDamage` 0.05 µs; one ray against a rig 0.22 µs (0.03 µs rejected by the broad phase); a hitscan cast (level + rigs) 2.9 µs with 3 dummies, 3.5 µs with 24, 5.7 µs with 60; a full shot fired and applied (events, damage, health) 4.2 / 5.6 / 7.0 µs; combat and range timers 0.01 / 0.08 / 0.17 µs per step.
- **Two findings, both fixed with evidence:**
  - **Draw calls over budget with many dummies.** With one mesh per hit volume, 24 dummies measured 280–285 draw calls (6 meshes + 6 shadow draws each), over the Low budget of 250. Each dummy is now one merged, vertex-coloured mesh: 24 dummies ~59 draw calls, 60 dummies ~113. Enemies should follow the same rule (D-041).
  - **First-shot hitch (since Phase 2).** The first shot of a session cost ~210–226 ms: the muzzle flash and impact markers start hidden, and `renderer.compile` skips hidden objects, so their first draw paid its setup mid-play. Measured on the Phase 2 commit too (209.7 ms), so it was not a Phase 3 regression. `WorldView.prewarm` now renders hidden objects once behind the start prompt: the first shot costs ~4 ms, like any other.
- **Reading:** combat's CPU cost is negligible (microseconds per shot). Triangles grow with dummies (~2,600 per dummy including its shadow draw) and could be reduced with fewer sphere and capsule segments if a GPU measurement ever asks for it; nothing else needs optimising.

**Phase 4 baseline (2026-09-26, Walkers chasing the player, god mode):**

*Simulation, headless (Node; `PERF_REPORT=1 npx vitest run src/enemies/performance.test.ts`).* N Walkers chase a target circling the south yard (the expensive case: all steering, re-planning, colliding and pushing apart). Per 60 Hz fixed step:

| Walkers | Step (ms), avg / worst | think (µs) | update (µs) | separation (µs) | movement + collision (µs) | combat timers (µs) | One shot into the crowd (µs) | Decisions per step (max) | Rays per step |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 0.03 / 0.7 | 2 | 1 | 1 | 6 | 0.3 | 5.7 | 0.17 (1) | 0.8 |
| 4 | 0.06 / 3.0 | 7 | 1 | 1 | 14 | 0.1 | 4.7 | 0.67 (1) | 3.7 |
| 8 | 0.09 / 1.0 | 12 | 2 | 1 | 28 | 0.2 | 3.1 | 1.33 (2) | 6.9 |
| 16 | 0.14 / 0.7 | 21 | 3 | 4 | 52 | 0.2 | 4.0 | 2.67 (3) | 13.7 |
| 32 | 0.26 / 1.1 | 38 | 5 | 17 | 101 | 0.2 | 4.2 | 5.33 (6) | 25.9 |
| 64 | 0.63 / 1.5 | 96 | 11 | 79 | 251 | 0.5 | 6.4 | 10.67 (11) | 48.2 |

- **Inside the budget:** 64 Walkers cost ~0.65 ms per step, 16 % of the 4 ms simulation budget (D-037); the planned wave default of 24 about 0.2 ms. The worst single steps (≤ 3.6 ms) are isolated garbage-collection or compilation pauses, not the AI.
- **Where it goes:** movement and collision (the capsule motor against the level octree) ~4 µs per Walker per step; decisions ~9 µs each, one per Walker every 6th step (~4.5 rays each); exact timing (`update`) ~0.2 µs per Walker. Decisions are spread evenly: never more than ⌈N ÷ 6⌉ in any step.
- **The only non-linear part** is separation (every pair: 2,016 pairs at 64, ~40 ns each). It is 12 % of the step at 64 and negligible at 24; a spatial hash (ARCHITECTURE §7.4) is only worth it if the living cap grows well beyond 64.

*Browser (development build, SwiftShader, 6 s of the player strafing while the crowd chases; `tls.spawnWalkers(n)` with the test encounter and the dummies cleared):*

| Resolution | Preset | Walkers | FPS (SwiftShader) | Our frame cost avg / p95 / max (ms) | Draw calls | Triangles | JS heap (MB) |
|---|---|---|---|---|---|---|---|
| 1366×768 | High | 0 | 11.5 | 1.12 / 2.1 / 4.7 | 16 | 1,220 | 28.6 |
| 1366×768 | High | 1 | 11.0 | 1.54 / 2.4 / 4.7 | 18 | 3,668 | 33.0 |
| 1366×768 | High | 4 | 9.6 | 1.65 / 2.3 / 4.7 | 24 | 11,012 | 31.9 |
| 1366×768 | High | 8 | 8.4 | 2.13 / 5.6 / 7.8 | 32 | 20,804 | 29.6 |
| 1366×768 | High | 16 | 7.4 | 2.65 / 5.2 / 7.6 | 48 | 40,388 | 32.9 |
| 1366×768 | High | 32 | 6.4 | 3.85 / 5.7 / 5.8 | 80 | 79,556 | 32.1 |
| 1366×768 | High | 64 | 4.9 | 7.15 / 12.4 / 14.1 | 144 | 157,892 | 35.4 |
| 1920×1080 | High | 24 | 4.8 | 4.51 / 9.3 / 13.7 | 64 | 59,972 | 30.1 |
| 1920×1080 | Low | 24 | 6.5 | 3.69 / 6.0 / 15.2 | 64 | 59,972 | 29.2 |
| 1920×1080 | High | 64 | 3.6 | 8.85 / 13.4 / 16.7 | 144 | 157,892 | 29.8 |
| 1920×1080 | Low | 64 | 5.2 | 8.10 / 12.2 / 12.6 | 144 | 157,892 | 34.1 |

- **Finding, fixed with evidence: draw calls over budget at 64 Walkers.** The first version drew each Walker as two meshes (body, and arms pivoting at the shoulders), each with a shadow draw: 4 draw calls per Walker, **272 at 64 Walkers** (1920×1080 Low: 272, over the budget of 250). Each Walker is now **one skinned mesh** (two bones: body and arms), so the arms still animate and cast shadows: 2 draw calls per Walker, **144 at 64**. Frame cost and triangles are unchanged within noise (skinning adds one tiny bone-texture upload per Walker per frame, the halved draw calls take as much away).
- **Our frame cost** includes up to 5 simulation steps per frame at these low software frame rates (at 64 Walkers ~3 ms of the ~7 ms is simulation). On real hardware at 60 FPS a frame runs one step.
- **Memory:** the JS heap stays at 29–35 MB from 0 to 64 Walkers (differences are garbage-collection timing, not growth). GPU memory: one merged geometry per archetype, one small material and bone texture per visible Walker; 18 geometries in total.
- **Triangles** (~2,450 per Walker including its shadow draw) are the next thing to reduce if the reference GPU asks for it (fewer capsule and sphere segments); nothing suggests it does.


**Phase 5 baseline (2026-09-27, the mixed roster chasing the player, god mode).** This host was about half as fast as Phase 4's (an empty scene: 1.42 ms per frame against 1.12, 64 Walkers headless: 1.15 ms per step against 0.63), so each comparison below is within one session on one host.

*Simulation, headless (`PERF_REPORT=1 npx vitest run src/enemies/performance.test.ts`; Walkers and the mixed roster measured in the same run):*

| Crowd | Step (ms), avg / worst | think (µs) | update (µs) | separation (µs) | movement + collision (µs) | Decisions per step (max) | Rays per step | Screams in 10 s |
|---|---|---|---|---|---|---|---|---|
| 8 Walkers | 0.16 / 1.2 | 23 | 2 | 3 | 52 | 1.33 (2) | 6.9 | — |
| 8 mixed | 0.16 / 1.7 | 24 | 8 | 3 | 68 | 1.33 (2) | 5.7 | 2 |
| 16 Walkers | 0.31 / 2.4 | 43 | 5 | 11 | 101 | 2.67 (3) | 13.8 | — |
| 16 mixed | 0.31 / 1.3 | 86 | 16 | 18 | 211 | 2.67 (3) | 10.9 | 4 |
| 32 Walkers | 0.55 / 2.5 | 90 | 10 | 42 | 209 | 5.33 (6) | 26.1 | — |
| 32 mixed | 0.59 / 2.3 | 98 | 17 | 44 | 274 | 5.33 (6) | 20.5 | 8 |
| 64 Walkers | 1.15 / 2.4 | 178 | 20 | 158 | 435 | 10.67 (11) | 48.0 | — |
| 64 mixed | 1.27 / 5.7 | 204 | 36 | 160 | 576 | 10.67 (11) | 42.5 | 16 |

- **Mixed costs about the same as Walkers:** +10 % per step at 64, all inside the 4 ms budget (a third of it at 64 on this slower host). Decisions stay spread evenly (never more than ⌈N ÷ 6⌉ in a step); the Screamers' positioning casts fewer rays than chasing does.
- **Where the extra goes:** movement (Runners and hastened enemies move further per step, so the capsule motor does more collision work) and `update` (leaps, weaving, the scream's timers). The alarm response (a pass over the living enemies per scream) does not show.
- **Separation** grew from 79 µs (Phase 4 host) to 158 µs at 64 with the anticipation of closing bodies (D-043). A first version that bounded pairs by both bodies' speeds cost 325 µs; rejecting pairs exactly by their closing speed (no square root) halved it. Still the only quadratic part; a spatial hash is only worth it beyond 64.

*Browser (development build, SwiftShader, 6 s of the player strafing; `tls.spawnMixed(n)` with the encounter and dummies cleared; Walkers measured in the same session for comparison):*

| Resolution | Preset | Enemies | FPS (SwiftShader) | Our frame cost avg / p95 / max (ms) | Draw calls | Triangles | Geometries | JS heap (MB) |
|---|---|---|---|---|---|---|---|---|
| 1366×768 | High | 0 | 6.1 | 1.42 / 2.8 / 3.0 | 16 | 1,220 | 23 | 33.4 |
| 1366×768 | High | 1 mixed | 5.8 | 2.31 / 4.7 / 7.6 | 18 | 3,668 | 24 | 30.4 |
| 1366×768 | High | 8 mixed | 4.7 | 4.00 / 7.2 / 14.4 | 31 | 19,628 | 25 | 29.9 |
| 1366×768 | High | 16 mixed | 4.0 | 5.64 / 10.1 / 11.6 | 48 | 40,484 | 25 | 31.1 |
| 1366×768 | High | 16 Walkers | 4.3 | 4.97 / 8.4 / 11.8 | 48 | 40,388 | 24 | 33.7 |
| 1366×768 | High | 32 mixed | 3.4 | 8.98 / 13.5 / 16.2 | 80 | 79,748 | 25 | 31.7 |
| 1366×768 | High | 64 mixed | 2.8 | 15.95 / 24.5 / 24.5 | 144 | 158,276 | 25 | 31.2 |
| 1366×768 | High | 64 Walkers | 2.6 | 16.96 / 32.0 / 32.0 | 144 | 157,892 | 24 | 33.2 |
| 1366×768 | High | 64 mixed, all three traits | 2.4 | 14.84 / 22.1 / 22.1 | 144 | 206,660 | 27 | 34.5 |
| 1920×1080 | High | 24 mixed | 2.6 | 8.70 / 15.1 / 15.1 | 64 | 60,116 | 25 | 32.4 |
| 1920×1080 | Low | 24 mixed | 3.2 | 9.67 / 18.0 / 18.4 | 66 | 60,308 | 25 | 32.3 |
| 1920×1080 | High | 64 mixed | 2.2 | 15.84 / 26.4 / 26.4 | 144 | 158,276 | 25 | 30.8 |
| 1920×1080 | Low | 64 mixed | 2.8 | 16.37 / 25.7 / 25.7 | 144 | 158,276 | 25 | 37.3 |

- **Draw calls do not grow with archetypes or traits:** each enemy is still one skinned mesh (2 draw calls), whatever its archetype and attachments: 144 at 64, as in Phase 4. A scream's shockwave ring adds one while it expands (the 1080p Low row caught one).
- **Triangles:** the Tank's bigger body and the Screamer's mouth barely move the total (158k mixed vs 158k Walkers at 64). Traits add geometry (plates, helmet, spikes): every enemy with all three traits is +31 % (207k at 64), the worst case; the encounter's traits are one each.
- **Geometries:** one per archetype and set of attachments in use (25–27), shared by every enemy with that look; no per-enemy geometry.
- **Frame cost** at these frame rates includes 5 simulation steps per frame; mixed and Walker-only crowds cost the same within noise. No optimisation was needed or made beyond the separation fix above.

**Phase 6 baseline (2026-09-28, real waves, god mode).**

*Simulation, headless (the waves wired as in `main.ts`, one temporary probe; each wave held at its concurrency cap, four enemies killed every 2 s once full, so corpses pile up as in a fight):*

| Measure | Result |
|---|---|
| `generateWave` | 0.07 ms for wave 20; 0.86 ms averaged over waves 1–200 (endless waves hold 100+ enemies). Once per wave, in the intro. First version 3.1 ms: it recomputed each archetype's base cost through `applyTraits` on every draw; cached now |
| `SpawnDirector.pick` | 0.35 ms for a group of four, 0.20 ms for one (status of all 13 points: 0.13 ms). First version 1.39 ms: it placed the group around every eligible point before choosing; it now draws a point first and places the group only there |
| Wave 1 (6 alive) | step 0.07 ms average, 0.19 ms p95 |
| Wave 10 (15 alive) | step 0.26 ms average, 0.45 ms p95 |
| Wave 20 (24 alive, 12 corpses) | step 0.39 ms average, 0.71 ms p95 |
| Endless 30 (26 alive) | step 0.36 ms average, 0.73 ms p95 |
| Steps that spawn a group | 0.8–1.4 ms average, 2.9 ms worst: the pick, the spawn and its combat registration, inside the 4 ms step budget |

Occasional single steps of 11–191 ms appeared in some runs and not in others. The same seed gives an identical simulation, and three identical wave-10 runs put their spikes at different steps (one had none over 5 ms), so they are host pauses (garbage collection, scheduling), not simulation cost.

*Browser (development build, SwiftShader, `?endless=1`, `tls.startWave(n)` then play; "spawn phase" is the worst frame over the first 6 s of spawning; the rest is 6 s of strafing once the wave is at or near its cap):*

| Scenario | Spawn phase max (ms) | FPS (SwiftShader) | Our frame cost avg / p95 / max (ms) | Alive | Draw calls | Triangles | Geometries | JS heap (MB) |
|---|---|---|---|---|---|---|---|---|
| Wave 1, 1366×768 High | 9.5 | 5.8 | 2.43 / 4.2 / 6.3 | 2 / 6 | 26 | 13,460 | 20 | 30.2 |
| Wave 10, 1366×768 High | 11.2 | 5.0 | 4.38 / 8.0 / 9.5 | 15 / 15 | 46 | 37,316 | 21 | 30.4 |
| Wave 20, 1366×768 High | 17.2 | 4.5 | 6.61 / 11.1 / 15.8 | 22 / 24 | 68 | 61,976 | 27 | 34.0 |
| Endless 30, 1366×768 High | 10.1 | 4.6 | 6.28 / 9.9 / 12.0 | 25 / 26 | 70 | 70,508 | 25 | 33.6 |
| Wave 20, 1920×1080 High | 3.4 | 3.5 | 4.65 / 8.4 / 8.4 | 14 / 24 | 40 | 32,570 | 25 | 30.7 |
| Wave 20, 1920×1080 Low | 6.1 | 4.3 | 6.25 / 10.3 / 10.6 | 19 / 24 | 56 | 49,862 | 27 | 31.7 |

- **Waves cost what their crowd costs:** wave 20 at 22 alive is in line with Phase 5's 24 mixed (8.7 ms at 1080p on that host). Draw calls stay two per enemy plus the level (68 at wave 20, 70 at endless 30), far inside the 250 budget. Corpses are drawn until their corpse time ends. At 1080p on this host the simulation ran slower than real time (3.5 FPS; at most 5 steps per frame), so those waves had not reached their cap in the measuring window.
- **Prewarm pays for itself:** in the sandbox, the first spawn of four looks nobody had used yet (Tank, Runner, Screamer and Walker, all three traits) cost a 21.0 ms frame; spawning the same four again cost 6.3 ms. That ~15 ms of geometry building is what the wave intro now does before the wave starts (`EnemyView.prewarm` and the pool reserve), so the spawn-phase worst frames above (3–17 ms) include no look building.
- **No leaks across waves:** the JS heap stays at 30–34 MB, with 20–27 geometries (one per look in use).

**Phase 7 baseline (2026-09-29, Signal Mutations; Phase 6 measured again on the same host, alternating runs).**

*Simulation, headless (the mutations wired as in `main.ts`, one temporary probe; wave 19 held at its cap of 24, four enemies killed every 2 s):*

| Measure | Result |
|---|---|
| Step, wave 19 at 24 alive, each mutation | 0.19–0.23 ms average, 0.32–0.40 ms p95, the same with or without a mutation (the first row measured, 0.31 ms, was still warming up) |
| HIVE's surge steps | 0.97 and 1.06 ms (a group of up to 6: the pick, the spawns, their combat registration) |
| 24 killed in one step, then the step | 0.27 ms without a mutation; 0.42 ms under DEATH CRY (24 alarms, each answered by up to 23 enemies) |
| `Environment` step + resolve, two overlays | 7.5 µs |

*Browser (development build, SwiftShader, 1366×768 High; FPS, two runs each; our CPU cost per frame did not change):*

| Scenario | Phase 6 | Phase 7, first (4 point lights) | Phase 7, lamps and pools, muzzle light | Phase 7 final (no point lights) |
|---|---|---|---|---|
| Still view of the yard, nothing alive | 7.2–8.0 | 6.0 / 6.0 | 6.9 / 6.8 | 7.9 / 8.2 |
| Wave 20 at 24 alive, strafing | 5.0–6.1 | 4.7 / 3.8 | 5.6 / 4.7 | 6.1 / 5.3 |
| Still view, BLACKOUT | — | 6.4 / 6.0 | 7.1 / 7.1 | 7.9 / 8.0 |
| Wave 19 BLACKOUT / STATIC (a burst each second) / none | — | 4.3 / 4.0 / 4.3 | 5.0 / 4.4 / 4.9 | 5.3–5.5 / 4.8–5.0 / 5.1–5.9 |

- **Lights cost every pixel, in every wave.** Removing lights one by one from the live page (still view): all four point lights 6.0–6.2 FPS; the muzzle light only 7.35; none 7.8–8.1. The three emergency lights were ~18 % of the frame and the muzzle light ~7 %, at intensity 0, in waves without any mutation. Against the 10 % budget (plan) they were replaced: the emergency fixtures by glowing lamps with unlit additive pools of light on the floor, the muzzle light by a brief rise of the fill light while the flash shows (only in a blackout). Final: within noise of Phase 6.
- **No shader recompiles:** the program count stays at 11 (10 in Phase 6, plus the pools' material, compiled at load) through every mutation, a blackout and its fade-out.
- **Draw calls:** +3 while a blackout lights the pools (3 small discs); otherwise unchanged. STATIC is a DOM layer: no WebGL cost.

**Phase 7.1 (2026-10-01, D-046; Phase 7 measured again on the same host, alternating runs).**

*Simulation, headless (a temporary probe wired as `main.ts`, the acid included; two rounds each):*

| Measure | Phase 7 | Phase 7.1 |
|---|---|---|
| Step, wave 19 at 24 alive, per mutation | 0.29–0.48 ms average | 0.31–0.49 ms average (within noise) |
| HIVE's surge step | 1.33 / 1.66 ms | 1.92 / 1.51 ms |
| 24 killed in one step + the step, without / under DEATH CRY | 0.32–0.41 / 0.52–0.70 ms | 0.37–0.46 / 0.68–0.70 ms (frenzy and last-known included) |
| Wave 19 with 3 Spitters and 6 acid blobs always in flight | — | 0.42 / 0.53 ms average |
| A scream frenzying all 24, + the step | — | 0.54 / 0.59 ms |

*Browser (development build, SwiftShader, 1366×768 High; FPS per run; our CPU cost per frame unchanged):*

| Scenario | Phase 7 | Phase 7.1 |
|---|---|---|
| Still view of the yard | 5.2 / 5.8 / 5.2 / 5.7 | 5.6 / 6.1 / 6.1 / 6.1 |
| Still view, BLACKOUT (the new shader patch) | 5.2 / 5.6 | 5.8 / 5.9 |
| Wave 20 at its cap, strafing | 4.35 / 4.61 / 4.12 / 3.70 (mean 4.20) | 3.89 / 3.53 / 4.18 / 4.47 (mean 4.02) |
| Wave 19 BLACKOUT | 3.88 / 3.82 | 3.59 / 4.11 |
| Wave 19 Signal Glitch, a burst forced every second | 3.76 / 3.71 | 3.08 / 3.57 (~11 % lower: the glitch frames) |
| Wave 19, no mutation | 4.23 / 3.99 | 4.41 / 3.96 |

*The glitch pass after the black-frame fix (it renders the scene into a target instead of copying the screen, TESTING §8), measured in a later session on a faster host. Compare within the session only:*

| Scenario | 4× multisampled target | Single-sample target (shipped) |
|---|---|---|
| Wave 19 Signal Glitch, a burst forced every second | 3.99 / 3.79 / 3.56 / 3.94 (mean 3.82) | 4.38 / 4.26 (mean 4.32) |
| Wave 19, no mutation | 5.59 / 4.43 / 5.50 / 5.46 (mean 5.25) | 5.30 / 4.96 (mean 5.13) |
| Difference | −27 % (over budget) | −16 % |

- **Outside bursts the frame costs what Phase 7's did:** all differences are within the run-to-run spread on this host (budget ≤ 10 %). Outside bursts the fixed pass takes the same plain render path as before.
- **The glitch costs only its own frames:**
  - The shipped pass renders the scene into a single-sample target, draws one full-screen quad to the screen, and copies the target at each pattern step.
  - With a burst forced every second (glitched most of the time), frames are ~16 % slower (budget ≤ 25 % during bursts).
  - The multisampled target's resolve pushed this to 27 %, so the target is single-sample (D-046 §3).
  - The first version, which copied the screen, cost ~11 % but sometimes held a black frame.
- **No recompiles, no new lights:** 12 programs (Phase 7's 11, plus the glitch quad compiled at load), constant through every scenario, mutation and burst; the enemy patch shares one program for all enemies. Draw calls are unchanged apart from the acid blobs and splats while they show.

**Phase 8 (2026-10-01, the Adaptive System; a separate session's host, so compared within it).**

*Simulation (Node, headless, alternating runs against the Phase 7.1 commit `c0fde4e`):*

| Scenario | Phase 7.1 | Phase 8 |
|---|---|---|
| Wave 19 at 24 alive, per step | — | 0.215 ms adaptation off / 0.195 ms on (telemetry sampling) |
| The same with 2 Climbers (HIGH_GROUND level 2) | — | 0.212 ms |
| One decision (measure, fold, decide, compose) | — | 10.3 µs per wave |

*Browser (development build, SwiftShader, 1366×768 High, wave 19 with 24 alive, 4 alternating rounds; FPS per run, our CPU cost per frame):*

| Scenario | FPS | Mean FPS | Our cost avg (mean) |
|---|---|---|---|
| Phase 7.1 (`c0fde4e`) | 5.43 / 6.23 / 4.90 / 4.14 | 5.18 | 5.05 ms |
| Phase 8 | 5.93 / 4.95 / 4.67 / 4.19 | 4.94 | 4.47 ms |
| Phase 8, 2 Climbers forced | 6.66 / 4.61 / 5.28 / 5.26 | 5.45 | 4.34 ms |

- **Within noise:** the run-to-run spread (4.1–6.7 FPS) is wider than any difference between builds; our CPU cost per frame did not rise.
- **No recompiles, no new lights:** 12 programs and 2 lights in every run, 0 errors. The Climber shares the enemy program; its pose and look are per-archetype geometry.

**Phase 1 details:**
- **Player simulation (Node, headless):** 5.0 µs per step standing, 6.0 µs sprinting in the open, 10.3 µs pushing into a wall. At 60 steps/s that is under 0.1 % of a frame. Level collision: 480 triangles; world build ≈ 50 ms once at startup (including JIT warm-up).
- **Reading:** our CPU work is ~1 ms per frame. SwiftShader's CPU rasteriser is the entire bottleneck (7 FPS at 1080p), so these rates say nothing about the GTX 750. The blockout is far inside every budget (draw calls 11 of 250).
- **Dropped time:** below ~12 FPS a frame needs more than 5 steps, so simulated time runs slower than real time by design (ARCHITECTURE §3). This is why e2e movement checks read simulated state instead of wall-clock distances.
- **Not optimised.** Nothing in Phase 1 was tuned for speed; there is no evidence it needs to be (D-037 §3).

---

## 8. Known gaps

- **Wall-clock-sensitive e2e tests.** Four Phase 1–3 development-build tests (`player.spec` WASD / jump / collision, `combat.spec` body-shot marker) hold keys or watch for a marker over a fixed real time. They assume ~10 FPS of software rendering; below ~7 FPS simulated time falls behind (at most 5 steps per frame) and they fail. Seen on the slower host of the Phase 4 final run, reproduced on the unchanged Phase 3 commit on that host, and passing on the earlier host. Seen again in Phase 5 on a host at 2–6 FPS, where two more fail for the same reason (`player.spec` sprint/crouch and `smoke.spec`'s fixed-step loop check, both timed in real time). All six fail identically on the unchanged Phase 4 commit on that host (control run). The Phase 4–5 enemy specs wait on simulated state with generous timeouts, so they pass at those frame rates. In the Phase 6 run, `combat.spec`'s headshot-marker test joined them (the marker is visible for about 120 ms and the page ran at 2–5 FPS); it and the body-shot test fail identically on the unchanged Phase 5 commit on the same host (control run), and the Phase 0 fixed-step check passed. In the Phase 7 run the same four `player.spec` tests and three `combat.spec` marker tests failed on a ~5 FPS host (the marker is shown for ~120 ms, shorter than a frame there); run alone on the unchanged Phase 6 commit on that host, the body-shot test failed both times and the headshot test once of two, so they are not Phase 7's. In the final Phase 7 run only the body-shot test failed of these, and once `enemies.spec`'s Walker chase, which reads `nav` in the instant between the Walker entering CHASE and its next decision (it passed 3 of 3 alone). In the Phase 7.1 run (a ~6 FPS host) the four `player.spec` tests and both `combat.spec` marker tests failed this way again. The Walker chase race also recurred; it is fixed (below). In the Phase 8 run two `player.spec` tests (WASD, collision) and the body-shot marker failed; re-run alone, the two `player.spec` tests passed and the marker test failed again. Fix when CI arrives: drive them by simulated time (as `enemies.spec` does) or run the suite at a smaller viewport.
- **Fixed in Phase 7.1: a Signal Glitch frame could hold black.**
  - **What was seen:** two `mutations.spec` glitch tests failed in a full run and passed alone.
  - **Repro:** 12 held bursts gave one black hold (centre mean 10.6 against 121), with no GL error.
  - **Cause:** the first `GlitchPass` copied the finished screen with `copyFramebufferToTexture`. With antialiasing that copy has to resolve the multisampled default framebuffer, and it sometimes read black. Any `readPixels` before the copy hid it.
  - **Fix:** during a burst the scene renders into a target, so the pass never reads the screen (D-046 §3).
  - **Result:** 24 of 24 holds normal, no GL error, 12 programs throughout. A first try copied the afterimage with three's `copyTextureToTexture`, which raised `INVALID_VALUE` here; the copy is now the glitch quad drawn with no glitch.
- **Fixed in Phase 7.1: the DEATH CRY E2E read the echo too late.**
  - The flare column lives 0.5 s. Two headless frames at ~6 FPS can be longer, so the test failed 1 run in 5.
  - It now reads the echo on the alarm event itself, which the view handles first: 8 of 8.
- **Fixed in Phase 7.1: warnings after a WebGL context restore.**
  - **What was seen:** `resilience.spec`'s context-loss tests failed in both builds on WebGL warnings: "delete: object does not belong to this context".
  - **Cause:** the restore prewarm resized the glitch targets, and three's dispose listeners on them still belonged to the lost context.
  - **Fix:** the pass now takes fresh targets after a loss (`ContextLossMonitor.lossCount`) and drops the old ones without disposing.
  - **Result:** 13 of 13.
- **Fixed in Phase 7.1: the Walker chase race in `enemies.spec`.** In the step a Walker enters CHASE, its route reads `none` until its next decision. The test now polls state and route together: 4 of 4.
- **Phase 8: WEAPON_FOCUS is dormant.** Its measurement and responses exist and are tested as data, but nothing exercises them in play until a second firearm can be owned (Phase 9 / the Supply Terminal).
- **Phase 8: the tripwire's defender never moves,** so it cannot test the Climber's real counter-play (coming down off the perch); the integration run and the E2E spec cover the climb itself. Adaptation feel needs the manual checklist (§6).
- **No CI yet.** Recommended next infrastructure step: a GitHub Actions workflow running `npm ci`, `npm run check`, `npm run build` and `npm run test:e2e` on every PR. That would make "green" objective for every change.
- **Vercel preview not reachable from the Claude Code container.** Its network policy denies `*.vercel.app`; allowing it would let the e2e suite run against each preview (`E2E_BASE_URL`).
- **Manual QA (§6) pending** in real Chrome, Edge and Firefox.
- **Phase 1 feel is verified by numbers, not by hands.** Acceleration, speeds, jump height and camera behaviour are asserted, but "feels like a real FPS" needs the manual checklist (§6) on real hardware and monitors.
- **Future test targets (plan §27).** Unit tests for damage, wave generation, difficulty scaling, upgrade and mutation selection, economy and save/load. Headless integration scenarios for shooting, killing, wave completion, upgrades, boss spawning, game over and restart. Each lands with its phase.
