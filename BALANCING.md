# Balancing — THE LAST SIGNAL

The tuning log (plan §32, §36): every gameplay number that affects feel or difficulty, where it lives, why it has its value, and how it changed. Values live in `src/config/` only (plan §31); logic never hard-codes them.

> **Status (Phase 5):** Pass 1 (functional). Player movement, the first weapons (Pistol, Bare Hands), the combat rules, the v1 zombie roster (Walker, Runner, Tank, Screamer), the three traits (Armored, Helmeted, Elite) and the player's health have starting values. Only the Walker has been play-tested by hand (Phase 4); there are no waves, so how many zombies of each kind a player can handle is unknown until Pass 2.

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
| Minimum damage after armor | 1 per hit | GAME_DESIGN §6: armor is flat with a floor. Used by the Armored trait (Phase 5) |
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
| Runner / Screamer / Tank drop tables | ammo, 15 % / 30 % / 60 % | Phase 5 placeholders, roughly in proportion to the effort each takes to kill |
| Elite bonus table | ammo, 100 % (on top of its archetype's table) | "Bonus rewards" (GAME_DESIGN §7): an Elite always pays out |

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
| Armor / resistance | 0 / 0 | Armor comes from the Armored trait (§2.10) |
| Patrol | 4 m around its post, pauses 2–4 s, at 0.45 × speed | Only when placed with patrol on; ambience, not threat |
| Corpse time | 5 s, then sinks | Readable kills without clutter |
| Threat cost | 1 | The unit of the wave budget (Phase 6); other archetypes cost relative to it |

### 2.7 The Runner (`src/config/enemies.ts`, Phase 5, D-043)

Pressure through movement (GAME_DESIGN §7.3): it decides *when* the player must shoot, not how long.

| Value | Setting | Why |
|---|---|---|
| Health | 60 | Half a Walker: three Pistol body shots, one headshot (65 ≥ 60, tested). Punishes missing, rewards a calm first shot |
| Move speed | 5.2 m/s | Just faster than the player walks (5) and clearly slower than a sprint (7.5): walking away does not work, sprinting does (tested) |
| Turn rate / acceleration | 6 rad/s / 14 m/s² | Agile: it turns round in about half a second |
| Detection / reaction | 15 m / 0.3 s | It notices first and reacts fast: the player has little warning, so it must be dealt with on sight |
| Lose range / memory | 28 m / 6 s | Once on the player, it stays on them |
| Weave | ±35°, side changes every ~1.2 s, between 12 and 4 m, only where walkable | Harder to track in the open (it strays more than 0.6 m from the straight line, tested; up to ~1.9 m measured), while its closing speed stays ~4.3 m/s |
| Attack range / reach | 3.2 m / 1.4 m | Its attack starts out of arm's reach: the leap closes the gap |
| Wind-up (telegraph) | 0.4 s | Short but readable (a crouch, amber glow): reaction ~0.25 s, then a step aside |
| Leap | 2.2 m at 9 m/s (~0.25 s), committed; stops a body's width from the target | Lands from 3.2 m (2.2 + 1.4 reach = 3.6 ≥ 3.2); a side-step during the wind-up makes it miss (tested) |
| Attack damage / cooldown | 10 / 1.8 s | Light and not especially frequent (5.6 DPS vs the Walker's 9.4): its danger is getting to the player and in groups, not its hit |
| Recovery | 0.8 s | After a leap it is exposed |
| Stagger threshold / duration | 20 / 0.45 s | Any body shot staggers it, and cancels a leap in progress |
| Patrol | 5 m, pauses 1.5–3 s, 0.35 × speed | Restless |
| Threat cost | 1.5 | Between the Walker (1) and the Screamer (2) |
| Drops | ammo, 15 % | |

### 2.8 The Tank (`src/config/enemies.ts`, Phase 5, D-043)

A slow wall with a weak head (GAME_DESIGN §7.4): it decides *where* the player must shoot.

| Value | Setting | Why |
|---|---|---|
| Health | 360 | Three Walkers' worth: 6 Pistol headshots (tested), a whole magazine at best |
| Zone multipliers | torso × 0.5, arms and legs × 0.35, head unchanged | Body shots are soaked (13 per torso shot: 28 to kill, tested); headshots keep full value, so aim matters more than volume |
| Stagger | 60 within 1 s, **head only**, 0.6 s | A Pistol headshot staggers it; body damage never does. "Stagger-immune except from headshots" (GAME_DESIGN §6) |
| Move speed / turn / acceleration | 1.1 m/s / 1.8 rad/s / 3 m/s² | Slower than a Walker; easy to kite in the open, a problem in doorways |
| Detection / reaction | 10 m / 0.8 s | Dull senses: it can be avoided |
| Lose range / memory | 20 m / 8 s | It gives up slowly |
| Attack damage | 35 | Three hits kill a full-health player: every hit matters |
| Attack range / reach / arc | 1.9 m / 2.4 m / 150° | Big arms: harder to slip round than a Walker |
| Wind-up / recovery / cooldown | 1.1 s / 0.9 s / 2.6 s | The longest telegraph (red glow): fair warning for a heavy hit, and a long window to punish |
| Body | radius 0.5 m, 2.25 m tall | Fits every route link of the facility (tested) |
| Threat cost | 4 | The most expensive regular zombie |
| Drops | ammo, 60 % | |

### 2.9 The Screamer (`src/config/enemies.ts`, Phase 5, D-043)

Support (GAME_DESIGN §7.5): it decides *what* the player shoots first.

| Value | Setting | Why |
|---|---|---|
| Health | 80 | Four Pistol body shots or two headshots: killable quickly once targeted |
| Stagger | 25 within 1 s, 0.8 s | Any body shot interrupts a scream in progress |
| Move speed / turn / acceleration | 2.6 m/s / 4 rad/s / 8 m/s² | Faster than a Walker, so it can keep its distance |
| Detection / reaction | 16 m / 0.4 s | It spots the player from the furthest away |
| Preferred range | 6–11 m | Close enough to scream (14 m), far enough to be hard to reach |
| Scream range (attack range) | 14 m, in sight | It screams at a player it can see |
| Wind-up (telegraph) | 1.2 s, arms up, violet glow | Long enough to see from range and shoot it (the counter-play) |
| Recovery / cooldown | 1.0 s / 10 s (spent when the scream starts) | One scream per ten seconds at most; an interrupted scream still costs the full cooldown |
| Alarm radius | 18 m (half that in height) | Covers most of the yard from its post, not the whole map |
| Alert duration | 8 s | Zombies that heard it know where the player is for 8 s, whatever the range or sight |
| Haste | × 1.35 for 6 s (refreshed, not stacked) | A Walker becomes 2.2 m/s, a Tank 1.5: a real but short surge |
| Damage | 0 | It never hurts the player itself |
| Threat cost | 2 | |
| Drops | ammo, 30 % | |

### 2.10 Traits (`src/config/traits.ts`, Phase 5, D-043)

Overlays on any archetype (GAME_DESIGN §7.6). Applied in a fixed order (Armored, Helmeted, Elite); multipliers multiply, armor adds up.

| Trait | Values | Why |
|---|---|---|
| **Armored** | armor torso 10, each limb 6, head 0; speed × 0.9; threat × 1.5 | A Pistol torso shot does 16 instead of 26; a limb shot 10.9 instead of 16.9; a headshot is untouched. Punishes body spam and pellets (plan §15, "shotgun use → more armored") and rewards headshots. An Armored Tank's torso takes 3 per Pistol shot |
| **Helmeted** | helmet on the head: 50 durability, staggers when it breaks; threat × 1.3 | The first Pistol headshot is absorbed (15 gets through) and knocks it off with a stagger; the second lands in full. A Helmeted Walker takes three headshots instead of two |
| **Elite** | health × 1.6, speed × 1.1, damage × 1.3, stagger threshold × 1.5, threat × 2.5, bonus drop (ammo, 100 %) | An Elite Walker has 192 health (3 headshots), hits for 19.5 and still staggers from a headshot (65 ≥ 52.5); an Elite Tank has 576 health |

### 2.11 Player health (`src/config/player.ts`, Phase 4)

| Value | Setting | Why |
|---|---|---|
| Maximum health | 100 | GAME_DESIGN §4.2 |
| Damage window | `WAVE_ACTIVE` and `BOSS` only | D-029; no damage during a wave's intro or the breather after it (Phase 6) |
| Regeneration | none | GAME_DESIGN §4.2 [Proposed]; healing arrives with upgrades and pickups |

### 2.12 Shared enemy rules (`ENEMY_RULES`, Phases 4–5)

| Value | Setting | Why |
|---|---|---|
| Think interval | 0.1 s (10 Hz), spread over the steps | Decisions within the plan's 5–10 Hz; timing stays exact every step |
| Living enemies, hard cap | 64 | Above the planned wave default (24) and the stress test (60); waves set their own lower cap |
| Separation | within 0.8 m (or both radii + 0.1 m, if more), up to 2.5 m/s of push | A little more than two Walker radii (0.7 m): a crowd spreads out instead of stacking. Big bodies (a Tank) need more room |
| Separation vs closing speed | room + closing speed × 0.5 s; push + closing speed × 1.5 | Phase 5: with the flat push, a sprinting Runner (5.2 m/s) ran through an oncoming enemy (centres 0.2–0.34 m apart); with anticipation it keeps ≥ 0.73 m, more than both radii (0.65), from any archetype head-on (tested). Walkers in a crowd barely close on each other, so it hardly changes them |
| Route: arrival / re-plan | 0.6 m / every 1 s (or when the goal changes) | Smooth corners without overshooting doorways |
| Stuck | < 0.2 m of progress in 0.8 s | Short enough to recover before it looks broken |
| Straight-line test | within 0.5 m of height; rays at 0.4 m (knee) and 1.3 m (chest) | Crates, walls, jambs and low ducts block it; steps and ramps do not |

### 2.13 Test encounter (`src/config/training.ts`, Phases 4–5, temporary)

Five enemies: a Helmeted Walker and an Armored Tank as sentries 14–15 m from the spawn; a Runner patrolling the north-east yard; a Screamer by the north wall; an Elite Walker patrolling the north-west yard. Each stands beyond its own detection range (plus its patrol radius) from the spawn (tested) and comes back 10 s after its body is removed. Validation values, not balance. Since Phase 6 the encounter and the training range appear only in the sandbox (`?sandbox=1`); normal runs are wave-driven (§2.14).

### 2.14 Waves (`src/config/waves.ts` `WAVE_RULES`, Phase 6, D-044)

Difficulty rises through the threat budget, the mix, traits and concurrency. Enemy health never scales with the wave (waves 1–20), so the time-to-kill intents in §2.6–2.10 hold at every wave.

| Value | Setting | Why |
|---|---|---|
| Threat budget B(n) | `round(6 + 2.2(n−1) + 0.08(n−1)²)` to wave 20; then +5.2 per wave | Wave 1 = six Walkers (about 45 s at their pace, GAME_DESIGN §3); wave 20 = 77 threat, about 35–45 enemies over about 90 s. The gentle quadratic term makes the late waves feel steeper without a cliff. The endless tail continues at the wave-20 slope |
| Budget table (1–20) | 6, 8, 11, 13, 16, 19, 22, 25, 29, 32, 36, 40, 44, 48, 52, 57, 62, 67, 72, 77 | Tested exactly |
| Most wave enemies alive | `min(24, 5 + n)`; endless `min(32, 24 + ⌊(n−20)/5⌋)` | 6 at wave 1 (one screen of Walkers), 24 from wave 19 (the plan's default). Endless creeps up slowly, well under the hard cap of 64 |
| Spawn rate | `min(2, 0.5 + 0.05n)` enemies/s | A steady trickle early, a flood late; the cap on alive enemies does the rest |
| Group size | 1 … `min(4, 1 + ⌊n/6⌋)`; ambush +1 | Singles early; packs of 3–4 late; ambushes arrive in bigger groups |
| Unlocks | Walker 1, Runner 3, Screamer 4, Tank 6 | GAME_DESIGN §3 teaching order: one new threat at a time |
| First appearance | exactly one of the new archetype | A readable introduction |
| Caps per wave | Screamers `1 + ⌊(n−4)/5⌋`; Tanks `1 + ⌊(n−6)/4⌋` | Two Screamers screaming together, or a wall of Tanks, before the player has seen them singly would be unreadable |
| Walker floor | ≥ 30% of the budget | The horde stays a horde; specials punctuate it |
| Finale (wave 20) | ≥ 2 Tanks and ≥ 2 Screamers; theme ×1.2 on both | "Major event" until the boss (Phase 13) |
| Tier weights (Walker / Runner / Screamer / Tank) | intro 1 / 0.35 / – / –; variety 1 / 0.5 / 0.2 / 0.15; pressure 1 / 0.6 / 0.25 / 0.25; complex and wave 20 1 / 0.7 / 0.3 / 0.35 | Plan §13 tiers |
| Themes (from wave 4, seeded rotation, never repeated back to back) | mixed (base); swarm Runner ×1.8, Walker ×1.2, Tank ×0.3; heavy Tank ×2, Walker ×1.2, Runner ×0.6; ambush Runner ×1.4, Screamer ×1.5 (+1 group size) | GAME_DESIGN §8 "swarm, heavy, mixed, ambush" |
| Opening | no Tank or Screamer in the first 15% of the spawn order | A wave opens with the familiar before the heavy |
| Armored / Helmeted chance | from wave 8: 4% per wave, at most 25% each | "Pressure" tier adds protection that rewards headshots |
| Elite chance | from wave 13: 3% per wave, at most 12%; at most 1 (13–15), 2 (16–19), 3 (20); endless `1 + ⌊n/8⌋` | Elites are events, not the norm |
| Modifier clamps | weights ×0.5–2; trait chance ±0.2; budget ×0.5–1.5 (mutations only); ≤ 2 extra (adaptive) enemies | D-026: adaptation shapes the mix, never the size |
| Intro / first group / breather | 3 s / 2 s into the wave / 10 s | Time to read the banner, reload and reposition; the breather is also the future upgrade and Supply Terminal slot |
| Spawn distance | ≥ 12 m; full weight at 16–30 m | Far enough to react; near enough to arrive |
| "In view" | within FOV/2 + 15° **and** in line of sight to head height | Nothing appears in plain sight; points behind walls in front of the player are fine |
| Repeat penalty | ×0.3 for the last two groups' points | Pressure comes from several directions |
| Fallback | retry every 0.5 s; relax the view rule after 3 s (never the distance) | A wave cannot stall on geometry; counted in the run stats |
| Alarm pull-forward | the next queued group spawns now, favouring the alarm's region; no extra budget | The scream calls the horde in: pressure without inflation |
| Stragglers | ≤ 2 left, no progress for 40 s, farther than 25 m → moved to a fresh point | A wave never stalls on a stuck body |
| Healing between waves | none | GAME_DESIGN §4.2; if runs prove too short, Pass 2 may add a small wave-clear heal |

### 2.15 Signal Mutations (`src/config/mutations.ts`, `effects.ts`, `environment.ts`, Phase 7, D-045)

Every mutation is one wave's rule change, announced before it acts. The numbers keep each one noticeable but never decisive on its own; every value is clamped (in `EFFECT_CLAMPS` and `WAVE_RULES.modifierClamp`) in the data tests and again when applied.

| Value | Setting | Why |
|---|---|---|
| Mutation-free waves | 1–3, and 20 | O-7: learn the basics first; the finale (later the boss) has its own rules |
| Mutations per wave | exactly 1 from wave 4 (endless included) | Plan §14 "every normal wave receives one mutation" |
| First wave | HUNGER, BLACKOUT 4; DEATH CRY 5; STATIC 6; HIVE 7; BLOOD MOON 9 | The simplest (faster enemies, darkness) first; DEATH CRY after the Screamer has been met (wave 4), so the two alarms can be told apart; HIVE once waves are long enough to surge in; BLOOD MOON in the pressure tier |
| Weights (variety / pressure / complex; endless = complex) | HUNGER 1.2/1/1; BLACKOUT 1/1/1; DEATH CRY 1/1/1; STATIC 0.8/1/1; HIVE 0.6/1/1.2; BLOOD MOON –/0.8/1.2 | Simpler rules more often early; the bigger ones later |
| Repeats | never the previous; never two of BLACKOUT/STATIC in a row; ×0.35 if used in the last 3 waves | Variety; two sight-denial waves back to back is frustrating |
| HUNGER speed / acceleration | ×1.2 / ×1.2 (clamp ×0.5–1.25) | Walker 1.6 → 1.92 m/s, Runner 5.2 → 6.24 m/s: noticeably faster, still slower than the player's sprint (7.5 m/s) |
| HUNGER cap | never above max(own speed, 0.9 × sprint = 6.75 m/s), hasted included | The player can always outrun a hungry enemy by sprinting; a fast enemy is never made slower by the cap |
| BLACKOUT lighting | ambient ×0.3, sun ×0.12, cold tint 50 %, near-black fog colour; fade in 2.5 s (intro), out 2 s (breather) | Dark enough to change how the player moves; fog distance unchanged, so the view range is the same |
| BLACKOUT visibility aids | 3 red emergency lamps (glow 3) with pools of red light on the floor (radius 4.5 m, 1.4 m in front, opacity 0.6); muzzle light (intensity 9, reach 14 m) while the flash shows; eyeshine 0.14 | Safe zones to hold, gunfire as a light source, and enemies stay readable as pairs of eyes |
| Visibility floors | ambient ≥ 0.25; eyeshine ≥ 0.1 whenever ambient < 0.6 | No mutation (or stack of overlays) can make enemies invisible |
| STATIC bursts | every 6–10 s, 0.4–0.7 s long, first ≥ 4 s in; opacity 0.26 (clamp ≤ 0.35; bursts ≤ 0.8 s; ≥ 5 s apart) | Short, readable interruptions; 0.35 in the first browser pass hid too much and was lowered |
| STATIC safety | under the HUD; clear centre 10 vmin → full at 22 vmin; jitter ≤ 3 Hz; still with reduced motion | Aim and HUD are never covered; photosensitivity |
| DEATH CRY alarm | radius 8 m, alert 6 s, haste ×1.2 for 2.5 s (clamp ≤ 10 m, ×1.25, 3 s); never reinforcements | A kill in a crowd costs attention, a kill of a straggler costs nothing: rewards isolating targets. Much smaller than the Screamer's 18 m, ×1.35 for 6 s |
| HIVE budget | ×1.3 (clamp ×0.5–1.5; mutations only) | About a third more enemies at the same concurrency: a longer wave, not a denser one |
| HIVE surges | 2, at 40 % and 75 % of the queue; group + 2 (≤ 6); warning 2 s (clamp ≤ 3 surges, 1–4 s) | Flanks the player can see coming: the warning names the direction |
| BLOOD MOON | Elite chance +0.15 (the trait clamp is ±0.2); Elite limit +1, +1 more every 5 waves after 9 (≤ +3); at least 1 Elite | Elites become the wave's focus; the budget stays the same, so fewer but tougher enemies |
| BLOOD MOON lighting | ambient ×0.9, sun ×0.85, red tint 45 %, dark red fog | Mood, not darkness |
| Tripwire | a scripted defender clears waves 6, 9, 12 under each mutation and takes ≤ 1.6× (+20) the unmutated damage | Catches a mutation that silently makes a wave unfair (TESTING §6). Measured values below |

**Tripwire measurements** (the scripted defender of `signal/mutations.integration.test.ts`, seeds `tripwire-<wave>`; health points taken, `BALANCE_REPORT=1`):

TRIPWIRE_TABLE

These are a regression check, not a player's experience: the defender stands still and never misses its rhythm.

---

## 3. Change log

| Date | Value | Change | Reason / evidence |
|---|---|---|---|
| 2026-09-25 | Player movement | Initial Pass-1 values | Phase 1 (D-038); verified by automated tests only |
| 2026-09-26 | Pistol, Bare Hands, weapon rules | Initial Pass-1 values | Phase 2 (D-040) |
| 2026-09-26 | Pistol recoil recovery | 7 → 9 °/s (before release) | The design intent "the kick settles within one shot interval" failed at 7 °/s (0.19 s > 0.167 s) |
| 2026-09-26 | Combat rules, zone multipliers in use, humanoid rig, drops, training dummies | Initial Pass-1 values | Phase 3 (D-041). Zone multipliers are the plan's example; HEAD follows each weapon's headshot multiplier |
| 2026-09-26 | Walker, player health, shared enemy rules, Walker drops, test encounter | Initial Pass-1 values | Phase 4 (D-042). Verified by automated tests only (time-to-kill both ways, attack timing, dodging the wind-up, stagger); not play-tested by hand |
| 2026-09-27 | Runner, Tank, Screamer, traits, their drops, test encounter | Initial Pass-1 values | Phase 5 (D-043). Verified by automated tests only (time-to-kill, attack timing, the leap, head-only stagger, the scream and its response, trait damage); not play-tested by hand |
| 2026-09-27 | Separation | room = max(0.8 m, both radii + 0.1 m) + closing speed × 0.5 s; push + closing speed × 1.5 | Phase 5 head-on tests: a Runner ran through oncoming enemies with the flat push. A first try (push ≥ 1.5 × the faster body's speed) did not help head-on (planted-bug run) and was replaced |
| 2026-09-28 | Waves: budget curve, concurrency, pacing, unlocks, caps, themes, trait schedule, spawn rules, timings | Initial Pass-1 values | Phase 6 (D-044). Verified by automated tests only (the budget table, property tests over 200 waves × 30 seeds, spawn fairness, pacing, completion, timings); not play-tested by hand |
| 2026-09-29 | Signal Mutations: selection rules, the six v1 mutations, environment overlays, visibility floors, clamps | Initial Pass-1 values | Phase 7 (D-045). Verified by automated tests (data within clamps, selection properties over many seeds, generator per mutation, the lifecycle, determinism, the scripted-defender tripwire) and a browser check of each mutation's look; not play-tested by hand |
| 2026-09-29 | STATIC opacity | 0.35 → 0.26; no screen blend; the clear centre widened | First browser look: the interference hid too much of the view |
