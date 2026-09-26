# Balancing — THE LAST SIGNAL

The tuning log (plan §32, §36): every gameplay number that affects feel or difficulty, where it lives, why it has its value, and how it changed. Values live in `src/config/` only (plan §31); logic never hard-codes them.

> **Status (Phase 4):** Pass 1 (functional). Player movement, the first weapons (Pistol, Bare Hands), the combat rules, the first zombie (the Walker) and the player's health have starting values. Nothing has been play-tested by hand yet, and there are no waves, so how many Walkers a player can handle is unknown until Pass 2.

---

## 1. Process (plan §32)

Balance is never tuned from assumptions alone. Three passes:

| Pass | Goal | Adjusts | Status |
|---|---|---|---|
| **1 — Functional** | Everything works; balance may be ugly | Starting values chosen from design intents (GAME_DESIGN) | **Current** |
| **2 — Playability** | The game is fun to play | Enemy count, spawn pacing, ammo economy, damage, health, upgrade strength | From Phase 6 (waves), with play sessions |
| **3 — Polish** | The game feels finished | Difficulty curve, build diversity | Milestone 5 |

**Rules.**
- Change values in `src/config/*.ts`, then log the change here (date, old → new, reason, evidence).
- Numbers checked by tests (e.g. "the Pistol's kick settles within one shot interval", "4–5 body shots per Walker") express design intents. If a tuning change breaks one, either the change or the intent is wrong: decide which and record it.
- Graphics quality presets never change gameplay numbers (D-037).

---

## 2. Current values

### 2.1 Player movement (`src/config/player.ts`, Phase 1, D-038)

| Value | Setting | Intent |
|---|---|---|
| Walk speed | 5 m/s | Brisk (GAME_DESIGN §4.2) |
| Sprint | × 1.5 (7.5 m/s), forward only | Clearly faster; firing cancels it for 0.35 s |
| Crouch | × 0.5 (2.5 m/s) | Slower, lower (eyes 1.62 → 0.95 m), tighter spread |
| Ground acceleration / braking | 50 / 40 m/s² | Full speed in 0.1–0.15 s, stop in ~0.13 s |
| Air acceleration | 12 m/s² | Limited air control, momentum kept |
| Gravity / jump height | 22 m/s² / 1.15 m | Snappy arc; clears low cover (≤ 1 m) and the 0.9 m dock |
| Coyote time / jump buffer | 0.1 s / 0.12 s | Forgiveness |
| Capsule | radius 0.35 m, height 1.8 m (1.1 m crouched) | Fits the blockout's doors (3 m) and duct (1.25 m) |

### 2.2 Weapons (`src/config/weapons.ts`, Phase 2, D-040)

**Pistol** — Primary at the start (fits Secondary too), semi-automatic.

| Value | Setting | Intent / reasoning |
|---|---|---|
| Damage | 26 per shot | 4 body shots against a 100-health Walker (GAME_DESIGN §5.2: 4–5) |
| Headshot multiplier | × 2.5 | 65 per headshot: 2 headshots kill (intent: 1–2). Matches the HEAD zone multiplier (GAME_DESIGN §6) |
| Fire rate | 6 shots/s (semi) | Fast enough to feel responsive, slow enough that each shot is a decision |
| Magazine | 12 | Two Walkers per magazine at best; reloads are part of the rhythm |
| Reserve | Unlimited | D-039: the starter can never leave the player without a gun |
| Reload | 1.3 s | Punishing if mistimed in a crowd, never long |
| Range | 120 m | Longer than any sight line in the 48 m blockout |
| Falloff | full to 20 m, × 0.6 from 60 m | Precision weapon; stays useful across the map |
| Spread | 0.6° cone; × 0.6 crouched, up to × 1.8 moving, × 3 airborne | Accurate standing or crouched; punishes jump-shooting |
| Recoil | 1.1° ± 0.25° up, ± 0.35° sideways, settles at 9°/s | The kick settles within one shot interval (1.35° / 9°/s = 0.15 s < 0.167 s), so aimed follow-up shots stay precise |
| Equip time | 0.35 s | Switching is quick but not free |

**Bare Hands** — Melee, always available (quick melee V, or held with 3).

| Value | Setting | Intent |
|---|---|---|
| Damage | 15 | A last resort: several hits per Walker (GAME_DESIGN §5.2) |
| Headshot multiplier | × 1.5 | |
| Reach | 1.6 m | Just beyond the capsule radius plus arm length |
| Cooldown | 0.5 s (also the length of a quick melee) | Cannot replace a gun |
| Equip time | 0.2 s | |

**Rules shared by weapons** (`WEAPON_RULES`).

| Rule | Setting | Why |
|---|---|---|
| Trigger buffer | 0.12 s | A click just before the weapon is ready still fires |
| Auto reload on empty | On | Pressing fire on an empty magazine clicks, then reloads |
| Sprint lockout after an attack | 0.35 s | "Firing cancels sprint" (GAME_DESIGN §4.2) |
| Secondary unlock | After wave 5 | D-039 / O-13 default; applied by the wave system (Phase 6) |

**Assumptions to confirm in Pass 2.** Walker health (100) is not defined yet (Phase 4); the time-to-kill checks and the standard training dummy use it as a placeholder. Enemy damage, Supply Terminal prices and ammunition amounts do not exist yet.

### 2.3 Combat (`src/config/enemies.ts`, `src/config/combat.ts`, Phase 3, D-041)

**Zone multipliers** (plan §10, unchanged from the plan's example; archetypes may override).

| Zone | Multiplier | Pistol (26) | Bare Hands (15) |
|---|---|---|---|
| HEAD | the weapon's headshot multiplier (Pistol 2.5, Bare Hands 1.5) | 65 | 22.5 |
| TORSO | 1.0 | 26 | 15 |
| ARM_LEFT / ARM_RIGHT | 0.65 | 16.9 | 9.75 |
| LEG_LEFT / LEG_RIGHT | 0.5 | 13 | 7.5 |

- **Headshot rule:** HEAD uses the attacking weapon's headshot multiplier, scaled by the target's HEAD entry ÷ 2.5 (1 for every current target). A weapon-specific headshot value lets melee and future pellet weapons reward headshots less than the Pistol.
- **Critical = headshot.** No random crits.
- **Pistol time-to-kill against 100 health:** 4 body shots and 2 headshots (both checked by tests), 6 arm shots, 8 leg shots; at the falloff floor (≥ 60 m, × 0.6) a headshot is 39, so 3 are needed.
- **Bare Hands:** 7 body punches, 5 headshot punches: a last resort.

| Rule | Setting | Why |
|---|---|---|
| Minimum damage after armor | 1 per hit | GAME_DESIGN §6: armor is flat with a floor. No target has armor yet |
| Stagger window | 1 s | Damage within 1 s of the previous hit adds up towards a stagger |
| Attacker multiplier | 1 | Hook for damage upgrades (Phase 9) |

**Hitbox rig (`HUMANOID_RIG`)**: head sphere r 0.13 m at 1.63 m (generous, D-007); torso capsule r 0.20 m from 0.98 to 1.30 m; arms r 0.07 m, shoulders at ±0.29 m; legs r 0.095 m at ±0.11 m. About 1.8 m tall, like the player. The head is the zone most worth tuning when real models arrive: it decides how forgiving headshots feel.

### 2.4 Drops and pickups (`src/config/drops.ts`, Phase 3)

| Value | Setting | Intent |
|---|---|---|
| Ammo pickup | 1 whole magazine per carried limited-reserve firearm | Meaningful but small; the Pistol (unlimited) takes nothing |
| Pickup radius / vertical reach | 1.1 m / 1.5 m | Walking over it is enough; no pixel hunting |
| Pickup lifetime | 30 s | Rewards moving to collect, without clutter |
| Pickups on the ground at once | 16 (oldest removed) | Bounded cost |
| Training dummy drop table | ammo, 50 % | Test value, not an enemy drop rate |
| Walker drop table | ammo, 20 % | Phase 4 placeholder: a trickle, not an economy. The starter Pistol's reserve is unlimited, so it only matters once a limited-reserve weapon exists |

The Scavenger bonus and the ammo economy are Pass-2 work (waves and progression phases).

### 2.5 Training dummies (`src/config/training.ts`, Phase 3, temporary)

| Kind | Health | Stagger threshold | Respawn | Drops | Notes |
|---|---|---|---|---|---|
| standard | 100 | 40 | 3 s | trainingDummy | Stands in for a wave-1 Walker: 2 headshots or 4 body shots |
| zoned | 400 | 60 | 3 s | none | Zones painted; tough enough to place many hits |

These are validation values, not balance: dummies are removed from normal play when waves arrive.

### 2.6 The Walker (`src/config/enemies.ts`, Phase 4, D-042)

The baseline zombie (GAME_DESIGN §7.1): slow, durable, melee only. Every other archetype will be tuned relative to it.

| Value | Setting | Why |
|---|---|---|
| Health | 120 | More durable than the basic target (the 100-health standard dummy) without losing the skill reward: still 2 Pistol headshots, but 5 body shots instead of 4 (intent "4–5 body shots", tested). 8 arm or 10 leg shots |
| Move speed | 1.6 m/s | About a third of the player's walk (5 m/s): a lone Walker never catches a moving player; it threatens by numbers and corners |
| Turn rate / acceleration | 3.5 rad/s / 6 m/s² | Turning round takes ~0.9 s, so circling one at close range works (a skill, not an exploit, while hordes are small); it reaches full speed in ~0.3 s |
| Detection range | 12 m | About a third of the yard: the player sees it before it notices them. Needs line of sight |
| Lose range / memory | 24 m / 5 s | Twice the detection range, so a chase is not dropped at the edge; after losing sight it keeps coming for 5 s to where the player was. A hit tells it where the shooter is for the same 5 s, at any range |
| Reaction (DETECT) | 0.6 s | The readable "noticed you" tell before it moves |
| Attack damage | 15 | 7 hits kill a player at full health (100) |
| Attack range / reach | 1.5 m / 1.9 m | It stops at 1.3 m (0.85 × range) and starts the wind-up within 1.5 m; the strike still lands within 1.9 m, so stepping back about half a metre during the wind-up dodges it |
| Wind-up / recovery | 0.7 s / 0.5 s | The telegraph (arms up, orange glow): enough to react (~0.25 s) and step out of reach (~0.2 s at walking speed). Recovery is the window to punish |
| Cooldown | 1.6 s (from the start of an attack) | At most 9.4 damage per second per Walker: a lone Walker kills a player who stands still in ~10 s, two in ~5 s |
| Arc / vertical reach | 120° / 1.2 m | Committed: a player who gets behind it during the wind-up is missed. Reaches a player on a crate or the dock edge, not on the catwalk |
| Stagger threshold / duration | 35 in 1 s / 0.7 s | Any headshot (65) staggers; two quick body shots (52) do. The stagger lasts as long as a wind-up and cancels one in progress: a well-timed headshot stops an attack |
| Armor / resistance | 0 / 0 | Armored enemies are Phase 5 modifiers |
| Patrol | 4 m around its post, pauses 2–4 s, at 0.45 × speed | Only when placed with patrol on; ambience, not threat |
| Corpse time | 5 s, then sinks | Readable kills without clutter |
| Threat cost | 1 | The unit of the wave budget (Phase 6); other archetypes cost relative to it |

### 2.7 Player health (`src/config/player.ts`, Phase 4)

| Value | Setting | Why |
|---|---|---|
| Maximum health | 100 | GAME_DESIGN §4.2 |
| Damage window | `WAVE_ACTIVE` and `BOSS` only | D-029; a run is one open-ended wave until the wave system (Phase 6) |
| Regeneration | none | GAME_DESIGN §4.2 [Proposed]; healing arrives with upgrades and pickups |

### 2.8 Shared enemy rules (`ENEMY_RULES`, Phase 4)

| Value | Setting | Why |
|---|---|---|
| Think interval | 0.1 s (10 Hz), spread over the steps | Decisions within the plan's 5–10 Hz; timing stays exact every step |
| Living enemies, hard cap | 64 | Above the planned wave default (24) and the stress test (60); waves set their own lower cap |
| Separation | within 0.8 m, up to 2.5 m/s of push | A little more than two body radii (0.7 m): a crowd spreads out instead of stacking |
| Route: arrival / re-plan | 0.6 m / every 1 s (or when the goal changes) | Smooth corners without overshooting doorways |
| Stuck | < 0.2 m of progress in 0.8 s | Short enough to recover before it looks broken |
| Straight-line test | within 0.5 m of height; rays at 0.4 m (knee) and 1.3 m (chest) | Crates, walls, jambs and low ducts block it; steps and ramps do not |

### 2.9 Test encounter (`src/config/training.ts`, Phase 4, temporary)

Three Walkers (two sentries 14–15 m from the spawn, beyond detection; one patrolling the north-east yard), each back 10 s after its body is removed. Validation values, not balance: the wave system replaces them.

---

## 3. Change log

| Date | Value | Change | Reason / evidence |
|---|---|---|---|
| 2026-09-25 | Player movement | Initial Pass-1 values | Phase 1 (D-038); verified by automated tests only |
| 2026-09-26 | Pistol, Bare Hands, weapon rules | Initial Pass-1 values | Phase 2 (D-040) |
| 2026-09-26 | Pistol recoil recovery | 7 → 9 °/s (before release) | The design intent "the kick settles within one shot interval" failed at 7 °/s (0.19 s > 0.167 s) |
| 2026-09-26 | Combat rules, zone multipliers in use, humanoid rig, drops, training dummies | Initial Pass-1 values | Phase 3 (D-041). Zone multipliers are the plan's example; HEAD follows each weapon's headshot multiplier |
| 2026-09-26 | Walker, player health, shared enemy rules, Walker drops, test encounter | Initial Pass-1 values | Phase 4 (D-042). Verified by automated tests only (time-to-kill both ways, attack timing, dodging the wind-up, stagger); not play-tested by hand |
