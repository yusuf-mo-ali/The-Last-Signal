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
| Frenzy (D-046) | 6 s for everyone within 18 m: cooldown ×0.6, wind-up ×0.85, turn ×1.6, stagger ×1.4 (never stacked; an interrupted scream gives none) | Makes it the priority target: a frenzied Walker attacks about every 1.1 s (its wind-up and recovery bound it) instead of 1.6, and a Pistol body shot (26) no longer staggers a frenzied Runner (20 → 28) |
| Look (D-046) | a violet sonic wave: three rings 0.16 s apart, out to 18 m, and a 6 m column; violet eyes on the frenzied | Never confused with DEATH CRY's red echo (two rings, a short flare) |
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
| Unlocks | Walker 1, Runner 3, Screamer 4, Tank 6, Spitter 10 (D-046); adaptive only: Climber 8 (D-047) | GAME_DESIGN §3 teaching order: one new threat at a time; the ranged threat once the player has the basics and the mutations are under way |
| First appearance | exactly one of the new archetype | A readable introduction |
| Caps per wave | Screamers `1 + ⌊(n−4)/5⌋`; Tanks `1 + ⌊(n−6)/4⌋`; Spitters `1 + ⌊(n−10)/5⌋` (1 at 10–14, 2 at 15–19, 3 at 20) | Two Screamers screaming together, a wall of Tanks or a firing line of Spitters before the player has seen them singly would be unreadable |
| Walker floor | ≥ 30% of the budget | The horde stays a horde; specials punctuate it |
| Finale (wave 20) | ≥ 2 Tanks and ≥ 2 Screamers; theme ×1.2 on both | "Major event" until the boss (Phase 13) |
| Tier weights (Walker / Runner / Screamer / Tank / Spitter) | intro 1 / 0.35 / – / – / –; variety 1 / 0.5 / 0.2 / 0.15 / –; pressure 1 / 0.6 / 0.25 / 0.25 / 0.15; complex and wave 20 1 / 0.7 / 0.3 / 0.35 / 0.2 | Plan §13 tiers |
| Themes (from wave 4, seeded rotation, never repeated back to back) | mixed (base); swarm Runner ×1.8, Walker ×1.2, Tank ×0.3; heavy Tank ×2, Walker ×1.2, Runner ×0.6, Spitter ×0.7; ambush Runner ×1.4, Screamer ×1.5, Spitter ×1.3 (+1 group size) | GAME_DESIGN §8 "swarm, heavy, mixed, ambush"; Spitters suit ambushes (fire from the flank), not the heavy push |
| Opening | no Tank, Screamer or Spitter in the first 15% of the spawn order | A wave opens with the familiar before the heavy |
| Armored / Helmeted chance | from wave 8: 4% per wave, at most 25% each | "Pressure" tier adds protection that rewards headshots |
| Elite chance | from wave 13: 3% per wave, at most 12%; at most 1 (13–15), 2 (16–19), 3 (20); endless `1 + ⌊n/8⌋` | Elites are events, not the norm |
| Modifier clamps | weights ×0.5–2; trait chance ±0.2; budget ×0.5–1.5 (mutations only); ≤ 2 extra (adaptive) enemies. The adaptive source first on its own (D-047): weights ×0.75–1.6, Armored + Helmeted ≤ +0.15 in total, no Elite, ≤ 2 bias regions | D-026: adaptation shapes the mix, never the size |
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
| HUNGER speed / acceleration | ×1.15 / ×1.15 (clamp ×0.5–1.25) | Walker 1.6 → 1.84 m/s, Runner 5.2 → 5.98 m/s: noticeably faster, still slower than the player's sprint (7.5 m/s). ×1.2 failed the survival tripwire (below). Phase 7.1 tried ×1.18, ×1.17 and ×1.16 (the playtest said "slightly too slow"); each lost one wave-12 seed to plain walkers, with any acceleration, so ×1.15 stays. Open for the owner (PROGRESS "Needed from you") |
| HUNGER cap | never above max(own speed, 0.9 × sprint = 6.75 m/s), hasted included | The player can always outrun a hungry enemy by sprinting; a fast enemy is never made slower by the cap |
| BLACKOUT lighting (D-046) | ambient ×0.14, sun ×0.04, cold tint 50 %, near-black fog colour; fade in 2.5 s (intro), out 2 s (breather) | Genuinely dark (the Phase 7 ×0.3 / ×0.12 still showed whole bodies); fog distance unchanged, so the view range is the same |
| BLACKOUT readability (D-046) | eyes glow 1.4 on their own; bodies darkened toward silhouettes by 0.75 (× 0.8 of the albedo); a close enemy lifted back by 0.6 (full within 2.5 m, none beyond 7 m) | Zombies read as eyes on silhouettes; one at arm's length is always readable. Measured at 12 m: eye peak ~217 against a black torso and a wall of ~12 (0–255) |
| BLACKOUT light sources | 3 red emergency lamps (glow 3) with pools of red light on the floor (radius 4.5 m, 1.4 m in front, opacity 0.6); while the muzzle flash shows, the fill light +45 % of normal and 35 % warmer | Safe zones to hold, gunfire as a light source; a silhouette shows against a pool |
| Visibility floors (D-046) | ambient ≥ 0.12; whenever ambient < 0.6, eye glow ≥ 0.9 and proximity ≥ 0.4 (scaled by how dark it is) | No mutation (or stack of overlays) can make enemies invisible: the guarantee is eyes and proximity, not light |
| Signal Glitch bursts (STATIC) | every 6–10 s, 0.4–0.7 s long, first ≥ 4 s in; grain 0.12 (clamp ≤ 0.35; bursts ≤ 0.8 s; ≥ 5 s apart) | Short, readable interruptions; the distortion is in the image now, so the grain is only a top coat |
| Signal Glitch distortion (D-046) | 4 tear bands, shift ≤ 2.5 % of the width, colour split 0.4 %, afterimage 35 %, enemies drawn 0.18 s behind; pattern steps 3 Hz (clamps: 6 bands, 4 %, 0.6 %, 50 %, 0.25 s, 3 Hz) | Aim where they are going: at a Walker's 1.6 m/s the drawn body lags ~0.3 m, a Runner's ~0.9 m: noticeable, not a miss guarantee |
| Signal Glitch safety | the HUD (DOM) never glitched; clear centre 10 vmin → full at 22 vmin; ≤ 3 Hz; reduced motion: one still pattern, no tears, no afterimage, no lag, colour split only | Aim and HUD are never covered; photosensitivity |
| DEATH CRY alarm (D-046) | radius 8 m, alert 6 s **at the kill-time position** (last-known), haste ×1.25 for 3 s, frenzy 3 s (cooldown ×0.7, wind-up ×0.85, turn ×1.4); never reinforcements | Kill, then move: the pack rushes where you stood and must see you again. 9 m failed the survival tripwire on one seed, so 8 m stays |
| Frenzy clamps (D-046) | duration ≤ 6 s; cooldown ≥ ×0.5; wind-up ≥ ×0.7; turn ≤ ×2; stagger ≤ ×1.6; never stacked (strongest wins, ends ≤ one duration after the latest) | Telegraphs stay readable; repeated alarms cannot build an unbounded buff |
| HIVE budget | ×1.15 (clamp ×0.5–1.5; mutations only) | More enemies at the same concurrency: a longer wave, not a denser one. ×1.3 with two surges (Phase 7) and then ×1.2 (once the Spitter shifted wave 12's mix, Phase 7.1) each killed the tripwire's defender on one seed |
| HIVE surge | 1, halfway through the queue; the wave's largest group + 1 (≤ 6); warning 2 s (clamp ≤ 3 surges, +2, 1–4 s) | A flank the player can see coming: the warning names the direction. Two +2 surges overwhelmed a slightly slower defender |
| BLOOD MOON | Elite chance +0.15 (the trait clamp is ±0.2); Elite limit +1, +1 more every 5 waves after 9 (≤ +3); at least 1 Elite | Elites become the wave's focus; the budget stays the same, so fewer but tougher enemies |
| BLOOD MOON guarantee (D-046) | first appearance on one of waves 9–12: while unseen, only its own roll (1/4, 1/3, 1/2, then certain), never the weighted draw; afterwards normal | Every run meets it early, 25 % on each of waves 9–12 (measured over 2000 runs: within 22–28 % each) |
| BLOOD MOON lighting | ambient ×0.9, sun ×0.85, red tint 45 %, dark red fog | Mood, not darkness |
| Survival tripwire | a scripted defender (fires every 0.33 s within 22 m, alternating head and body shots, never moves; since D-046 it picks targets like a player: a melee enemy within 5 m first, then visible non-melee enemies, then the nearest) that clears the unmutated waves 6, 9, 12 unhurt (10 seeds) must clear every mutated one without dying | Catches a mutation that silently makes a wave impossible (TESTING §3). Measured values below |

**Survival tripwire measurements** (`signal/mutations.integration.test.ts`, `BALANCE_REPORT=1`; health lost by the defender from 100, no healing, 10 seeds per wave; every other run lost 0):

| Wave 12 | Phase 7 first values | Phase 7 final | Phase 7.1 (with the Spitter and frenzies) |
|---|---|---|---|
| No mutation | 0 in all 10 | 0 in all 10 | 0 in all 10 |
| HUNGER | ×1.2: **died** in 1, 35 in 1 | ×1.15: 45 in 1 | ×1.15: 75 in 1 (×1.16–1.18: **died** in 1) |
| HIVE | ×1.3, two +2 surges: 60 and 15 | ×1.2, one +1 surge: 35 in 1 | ×1.15: 30 in 1 (×1.2: **died** in 1, 60 in 1) |
| DEATH CRY | 15 in 1 | 15 in 1 | 8 m with frenzy: 30 in 1 (9 m: **died** in 1) |
| BLOOD MOON | 0 | 0 | 15 in 1 |
| BLACKOUT, STATIC | 0 | 0 | 0 (identical to no mutation by construction) |

Waves 6 and 9: 0 in every run for every mutation. A slightly slower defender (0.35 s) already loses 60 on one unmutated wave-12 seed; there, the first values killed it in 1 (HUNGER) and 3 (HIVE) runs of 10.

- **How the check got here:** the first version (≤ 1.6× the unmutated damage + 20) never failed, because its defender was never hit.
- **Why not a damage ratio:** measured with defenders that can be hurt, the damage totals swing wildly with the seed and the defender's speed (a defender that cannot move either shrugs a wave off or is overwhelmed), so a ratio decides little.
- **Not a player's experience:** it is a regression guard against impossible waves; real players move, and HUNGER's counter-play is exactly keeping distance.

These are a regression check, not a player's experience: the defender stands still and never misses its rhythm.

### 2.16 The Spitter (`src/config/enemies.ts`, Phase 7.1, D-046)

Ranged (GAME_DESIGN §7.6): it punishes standing still at range, and every shot can be seen coming and dodged.

| Value | Setting | Why |
|---|---|---|
| Health | 70 | Two Pistol headshots (65 + 65) or three body shots (78): a priority target that dies fast once reached |
| Stagger | 25 within 1 s, 0.7 s | A Pistol body shot spoils a spit in progress |
| Move speed / turn / acceleration | 1.7 m/s / 4 rad/s / 8 m/s² | Slow: it keeps its distance by retreating early, not by outrunning the player |
| Detection / reaction | 22 m / 0.5 s | It sees the player from further than anything else |
| Preferred range | holds 10–16 m; backs away inside 8 m (to 10 m); a retreat step must gain 1.5 m | Close enough to hit, far enough to need a dodge; rushing it works, and it cannot slide along a wall forever. Cornered, it spits where it stands |
| Fire range | ≤ 18 m, in sight | No blind fire |
| Wind-up (telegraph) | 1.0 s: it rears back, its throat glows acid green | Long enough to see and react to, from across the yard |
| Recovery / cooldown | 0.8 s / 3.5 s (spent when the spit starts) | At most one spit every 3.5 s; an interrupted spit still costs the cooldown |
| Projectile | 13 m/s on the low arc, gravity 7 m/s², radius 0.18 m, lifetime 3 s; aimed at the chest where the player is at release, **no lead** | About 1.1 s of flight at 14 m: strafing at walking speed (5 m/s) moves ~5 m, far outside the 0.53 m hit radius (tested) |
| Damage | 14 direct; 6 splash within 1.6 m of a burst, never through walls | Standing still costs about a Walker hit; near misses cost little |
| Threat cost | 2.5 | Between the Screamer (2) and the Tank (4) |
| Drops | ammo, 30 % | Like the Screamer |
| Sandbox | not in the training encounter | It would shoot across the range the Phase 2–5 browser checks use |

Measured with the survival tripwire (§2.15): unmutated wave 12, with its one Spitter, stays at 0 health lost in all 10 seeds, since the defender shoots Spitters early.

### 2.17 The Adaptive System and the Climber (`src/config/adaptation.ts`, `enemies.ts`, Phase 8, D-047; quotas Phase 8.1, D-048)

The horde reacts to persistent play, never to a moment, and only by changing the mix (GAME_DESIGN §10). The numbers are set so that two consistent waves are the least that can trigger anything, and so that no response, alone or paired, takes a wave past what the scripted defender clears.

**Signals and the profile**

| Value | Setting | Why |
|---|---|---|
| Position samples | every 15 steps (4 Hz) while wave enemies are alive; a full wave = 45 s sampled | Enough to tell a perch from a pass-through, cheap, and on step counts (deterministic at any frame rate) |
| High ground | feet ≥ 1.2 m above the floor | The dock (0.9 m) is a step up, not a perch; the catwalk (2.5 m) is |
| Dwell | the best 9 × 9 m area (3 m cells) | About a room or a corner of the yard: "one area", not "one spot" |
| Mobility | ½ sprint share + ½ kiting (≥ 0.8 × walk speed away from the nearest enemy within 10 m) | Running away from contact is kiting; running across an empty yard is not |
| Close / long range | ≤ 5 m (melee 1.5 m) / ≥ 18 m; a full wave = 40 hits | Inside a Walker's lunge distance / beyond most of the yard |
| Headshot | head share of firearm hits, only when accuracy ≥ 0.4; a full wave = 30 hits | Spraying and occasionally landing headshots is not a headhunter |
| Priority / neglect | support kills before their ability; a full wave = 3 spawns | One Screamer is one data point, so it barely counts |
| Strain | damage taken ÷ 100 | One health bar lost in a wave scores 1 |
| Decay | ×0.7 per wave (half-life ≈ 2 waves) | A change of style shows within 2–3 waves; old habits do not linger |
| Confidence | min(1, mass ÷ 2) × persistence; no evidence under weight 0.15 | One extreme wave: 0.5; two: 0.85 |
| Mutation discounts | BLACKOUT long range, headshot, accuracy ×0.4; Signal Glitch headshot, accuracy ×0.5, long range ×0.7; HUNGER mobility ×0.5, close range ×0.7; DEATH CRY mobility, dwell ×0.7; HIVE strain, close range ×0.6; BLOOD MOON headshot ×0.8 | What the mutation pushes the player into counts less, never nothing |
| Attribution | ×0.25 toward an adaptation's own signal for what it brought | Runners from SKIRMISHER barely raise mobility; Climbers barely raise close range |

**Adaptations** (enter / exit; confidence enter / exit). Responses are quotas since Phase 8.1 (D-048): an archetype's share of the wave's threat budget, or a share of the wave carrying a trait on top of the scheduled rolls. They hold on every seed.

| Adaptation | Signal | Confidence | From wave | Level 1 → level 2 | Why |
|---|---|---|---|---|---|
| HIGH_GROUND | elevation 0.45 / 0.25 | 0.6 / 0.35 | 5 | 1 → 2 Climbers (before wave 8: Runners 35 % → 45 % of the budget); spawn bias to the 2 regions nearest the perch | Under half the wave on the catwalk is still "using" it; under a quarter is not |
| ENTRENCHED | dwell 0.7 / 0.5 (elevation ≤ 0.25) | 0.6 / 0.35 | 5 | bias + Runners 25 % + Spitters (to the cap) → Runners 30 % | Only when not on high ground (that is HIGH_GROUND's) |
| SKIRMISHER | mobility 0.45 / 0.3 | 0.6 / 0.35 | 5 | Runners 40 % → 45 % + bias | The plan's "high mobility → more Runners"; 40 % is about twice a normal wave's Runners |
| CLOSE_QUARTERS | close range 0.5 / 0.35 | 0.6 / 0.35 | 8 | Tanks to their cap + Armored +15 % → +25 % | Before wave 8 the Tank cap (1) and Armored's schedule left it nothing to do |
| LONG_RANGE | long range 0.45 / 0.3 | 0.6 / 0.35 | 5 | Runners 35 % → + Screamers to their cap (15 %) | Closes the gap; Screamers call the rest in |
| HEADHUNTER | headshot 0.55 / 0.4 (accuracy ≥ 0.4) | 0.65 / 0.4 | 8 | Helmeted +15 % → +25 % | The plan's "extreme headshot rate → Helmeted"; one Pistol headshot of 65 still breaks a 50 helmet; Helmeted is scheduled from 8 |
| WEAPON_FOCUS | role 0.75 / 0.55 | 0.65 / 0.4 | — | dormant (Armored +15 / 25 %, Tanks 30 / 40 %, Runners 35 / 45 %) | With only the Pistol it would always fire (D-047) |
| NEGLECT | neglect 0.6 / 0.4 | 0.6 / 0.35 | Screamer 9, Spitter 11 | that archetype at its per-wave cap (30 %); one level | Support zombies left alive bring as many as a wave may hold; it starts where the cap first allows more than a wave usually has |

**Clamps (D-048), enforced in compose and again in the generator:**
- archetype quotas: at most 45 % of the budget each and 50 % together; the larger of two asks wins, and they never stack;
- trait quotas: at most +25 % per trait and +30 % together.

**Pressure:** levels weigh 1 and 2, NEGLECT 4, with at most 4 in all. So two adaptations may both be at level 2, but NEGLECT stands alone. Paired with anything, even at level 1, the tripwire's defender died on wave 12 (seed 0, killed by frenzied Walkers).

**Before and after Phase 8.1** (mean of 300 seeds, generator only; L1 / L2 against the unadapted wave):

| Wave 8 | Unadapted | Phase 8 (weights) | Phase 8.1 (quotas) |
|---|---|---|---|
| HIGH_GROUND | Climbers 0 | 1 / 2 | 1 / 2 (unchanged) |
| SKIRMISHER | Runners 3.97 | 4.45 / 4.74 | **8.08 / 8.66** |
| CLOSE_QUARTERS | Tanks 0.63, Armored 0.82 | Tanks 0.69 / 0.67, Armored 0.82 / 2.27 | **Tanks 1.00 (cap), Armored 3.62 / 4.64** |
| LONG_RANGE | Runners 3.97, Screamers 0.74 | Runners 4.45 / 4.44, Screamers 0.70 / 0.77 | **Runners 7.59 / 7.28, Screamers 0.48 / 1.00 (cap)** |
| HEADHUNTER | Helmeted 0.77 | 2.16 / 2.94 | **3.73 / 5.46** |
| ENTRENCHED | Runners 3.97 | 3.97 / 4.38 | **6.69 / 6.92** |

| Wave 12 | Unadapted | Phase 8 | Phase 8.1 |
|---|---|---|---|
| SKIRMISHER | Runners 4.52 | 5.36 / 5.91 | **11.39 / 12.11** |
| CLOSE_QUARTERS | Tanks 1.19, Armored 5.12 | Tanks 1.32 / 1.24, Armored 5.05 / 6.85 | **Tanks 2.00 (cap), Armored 7.82 / 9.39** |
| LONG_RANGE | Runners 4.52, Screamers 1.33 | Runners 5.36 / 5.29, Screamers 1.25 / 1.40 | **Runners 10.48 / 9.93, Screamers 0.72 / 2.00 (cap)** |
| NEGLECT (Screamer) | Screamers 1.33 | 1.50 / 1.60 | **2.00 (cap)** |
| NEGLECT (Spitter) | Spitters 0.60 | 0.68 / 0.72 | **1.00 (cap)**; wave 15: 1.15 → **2.00** |
| HEADHUNTER | Helmeted 5.22 | 7.10 / 7.97 | **9.16 / 11.30** |

- **Waves left unchanged out of 300:**
  - Phase 8: many. On the probe seed, SKIRMISHER, LONG_RANGE, NEGLECT and HEADHUNTER at wave 8 gave exactly the unadapted wave.
  - Phase 8.1: 0 for every adaptation and wave above.
- **Bodies:** quotas buy dearer enemies out of the same budget, so a wave may have fewer bodies, never more. CLOSE_QUARTERS takes wave 8 from 19.3 to 15.9 / 15.4 enemies.

| Guardrail | Setting | Why |
|---|---|---|
| First wave / evidence | wave 5 (later where the answer cannot act yet, above); ≥ 2 fought waves | D-026, D-048 |
| Active | ≤ 2, from different families, pressure ≤ 4 | Bounded and never compounding; NEGLECT alone |
| Level 2 | after 2 waves at level 1, confidence ≥ 0.85, not while strained | Escalation must be earned by persistence too |
| Rest | 2 waves after a fade; forced after 4 waves active | No permanent counter; the player sees the horde pull back |
| Strain governor | strain ≥ 0.5 with confidence ≥ 0.6 | Half a health bar lost per wave, two waves running |
| Finale | no adaptation on wave 20 | Hand-tuned, like its mutation-free rule |

**The Climber**

| Value | Setting | Why |
|---|---|---|
| Health | 70 | Two Pistol headshots or three body shots: easy to drop once seen |
| Speed / climb speed | 3 m/s / 1.5 m/s | Faster than a Walker on the ground; slow and exposed on the wall (~1.7 s up the catwalk) |
| Attack | 12 damage, wind-up 0.7 s, reach 1.8 m, cooldown 1.4 s | A Walker-class hit: the threat is the angle, not the damage |
| Stagger | 25 within the window, 0.6 s | One Pistol body shot knocks it off the wall |
| Threat cost | 2 | Like the Screamer: counted within the budget, so 2 Climbers replace ~4 threat of the mix |
| Per wave | exactly 1 (level 1) or 2 (level 2), from wave 8; trait-free; not in the opening 15 % | The answer is a visible few, not a swarm |
| Drops | ammo 30 % | Like the other specials |

**Measured (Pass 1, automated):**
- **Composition only** (`waves/adaptiveWaves.test.ts`):
  - **Every family pair at level 2, 500 seeded waves (5–30):** the budget, concurrency, pacing, tier, theme and mutation are identical to the unadapted wave, and every cap holds.
  - **Bodies, over 150 seeds on each of 8 waves:** the mean enemy count is ×0.70–1.05 of the unadapted mean, and the maximum ×1.03 (the test allows ×0.7–1.1). The lowest is SKIRMISHER + CLOSE_QUARTERS on wave 10.
  - **Every adaptation, variant and level, on 40 seeds × every wave from its first wave to 30:** it changes the wave and meets its quota.
  - **Mutation selection** is identical over 30 waves.
- **Acceptance** (`adaptive/adaptive.acceptance.test.ts`, the full headless game):
  - for each tested adaptation and level, the preview = the generated wave = what actually spawned, and its signature against the same wave without adaptation holds;
  - adaptive OFF gives exactly the unadapted wave;
  - the same seed gives the same spawns;
  - the drawn mutation is the same.
- **The integration run:** a player camping the catwalk from wave 1 gets:
  - HIGH_GROUND on wave 5 (Runner-heavy waves 5–7);
  - level 2 on wave 7;
  - 2 Climbers on wave 8;
  - a forced rest from wave 9.
  One who roams gets nothing.
- **Survival tripwire** (`adaptive/adaptive.tripwire.test.ts`, `BALANCE_REPORT=1`, `ONLY=` for tuning runs):
  - **Setup:** the mutation tripwire's defender (§2.15) on waves 8 and 12, plain, then with every single adaptation and every allowed pair at its highest level, 10 seeds each (8 singles + 11 pairs).
  - **Pass condition:** the plain waves must cost at most 50 health (they cost 0); every adapted run must clear.

| Wave 12, 10 seeds each | Phase 8 (weights, pairs only) | Phase 8.1 (quotas, singles + allowed pairs) |
|---|---|---|
| Plain | 0 in all 10 | 0 in all 10 |
| HIGH_GROUND (alone) | — | 42 in 1 |
| NEGLECT (Spitter) alone | — | 15 in 1 |
| HIGH_GROUND + HEADHUNTER | 75 in 1 | 15 in 1 |
| CLOSE_QUARTERS + HEADHUNTER | 0 | 10 in 1 |
| HIGH_GROUND + NEGLECT (Screamer) | 90 in 1 | not allowed (pressure) |
| Other rows | 15–25 in 1 (4 pairs) | 0 in all 10 |

- **Wave 8:** 0 in every run.
- **Tuning on the way to these numbers:**
  - NEGLECT at its cap paired with HIGH_GROUND killed the defender (seed 0); so did HEADHUNTER + NEGLECT on a 30-seed run. NEGLECT was made exclusive (pressure 4).
  - LONG_RANGE's Screamer quota went 0.2 → 0.15, so the two quotas no longer exceed the 50 % total and shrink the Runners.
- **30 seeds** (a robustness run, not the gate): 1 death in 1,140 adapted runs, NEGLECT (Spitter) alone, wave 12, seed 21.
  - The wave already has its one Spitter, so the quota adds nothing.
  - Placing it first reshuffles the seeded fill: Runners 5 and Screamers 1, against 3 and 2, with the same 2 Tanks. The defender falls to Walkers.
  - The worst survivor lost 85 (HIGH_GROUND + CLOSE_QUARTERS).
  - Phase 8 had 0 deaths in 1,380, with responses that barely changed the waves.
  - A defender that never moves is the limit here; the counter-play to every response is movement.

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
| 2026-09-29 | HUNGER; HIVE | speed and acceleration ×1.2 → ×1.15; budget ×1.3 → ×1.2, two +2 surges (40 %, 75 %) → one +1 surge (50 %) | The survival tripwire (§2.15): HUNGER ×1.2 killed a defender that clears the same unmutated waves unhurt (1 in 10, and the tripwire fails on it); HIVE hurt it most and killed a slightly slower one in 3 of 10 |
| 2026-10-01 | BLACKOUT | ambient ×0.3 → ×0.14, sun ×0.12 → ×0.04; eyeshine (whole body) → eye glow 1.4, silhouette 0.75, proximity 0.6; floors ambient 0.25 → 0.12, eyes ≥ 0.9, proximity ≥ 0.4 | Phase 7 playtest: not dark enough and bodies glowed (D-046). Browser-measured: a 12 m Walker is a black silhouette with eyes at ~217/255; at 3 m it is lifted |
| 2026-10-01 | STATIC → Signal Glitch | grain 0.26 → 0.12; new distortion (4 bands, 2.5 % shift, 0.4 % split, 35 % afterimage, 0.18 s enemy lag, 3 Hz) | Playtest: flat screen noise (D-046) |
| 2026-10-01 | DEATH CRY | haste ×1.2 / 2.5 s → ×1.25 / 3 s; last-known alert; 3 s frenzy (×0.7 / ×0.85 / ×1.4); radius 8 m kept (9 m tried) | Playtest: too weak and ambiguous; 9 m killed the tripwire's defender on one wave-12 seed |
| 2026-10-01 | Screamer | completed scream: 6 s frenzy (×0.6 / ×0.85 / ×1.6 / stagger ×1.4) | Playtest: not a priority target (D-046) |
| 2026-10-01 | HIVE | budget ×1.2 → ×1.15 | With the Spitter in wave 12's mix, ×1.2 killed the tripwire's defender on one seed |
| 2026-10-01 | HUNGER | ×1.15 kept (×1.18, 1.17, 1.16 tried) | Playtest asked for faster; each lost one wave-12 seed to plain walkers. Open for the owner |
| 2026-10-01 | BLOOD MOON | first appearance guaranteed on waves 9–12 (exclusive roll, 25 % each) | Playtest: often not seen early (D-046) |
| 2026-10-01 | Spitter; wave rules | Initial Pass-1 values (§2.16); unlock 10, caps, weights, opening | Phase 7.1 (D-046). Verified by automated tests (timing, ranges, dodge, splash, lifecycle) and browser checks; not play-tested by hand |
| 2026-10-01 | Adaptive System (signals, profile, eight adaptations, guardrails, caps) and the Climber | Initial Pass-1 values (§2.17) | Phase 8 (D-047). Verified by automated tests (exact profile maths, the director's rules, composition invariants over 500 seeds, the integration run, the survival tripwire with every allowed pair at level 2) and browser checks; not play-tested by hand |
| 2026-10-01 | Adaptive responses → quotas; first waves; NEGLECT one level and exclusive; LONG_RANGE Screamers 0.15 | Weights (×1.25–1.5) → archetype and trait quotas (§2.17); CLOSE_QUARTERS and HEADHUNTER from wave 8, NEGLECT Screamer 9 / Spitter 11; pressure limit 4 | Phase 8.1 (D-048): the playtest found adaptations announced but not visible. Measured: weights moved the means by 12–19 % and caps cancelled whole responses; quotas double the signature archetype or trait. Tripwire (10 seeds) clear |
