# Game Design — THE LAST SIGNAL

> **Status:** Design baseline derived from `IMPLEMENTATION_PLAN.md`. Implemented so far: movement
> (Phase 1), weapons (Phase 2) and combat against training dummies (Phase 3); each section notes
> what exists.
>
> - Numbers in this document are **design intents**: roles, time-to-kill goals, ranges.
>   - Exact tunable values will live in `src/config/*`.
>   - Every tuning change will be logged in `BALANCING.md`.
> - Items marked **[Proposed]** interpret or extend the plan. Items marked **[Open O-n]** need a
>   decision; see `DECISIONS.md`. Everything else restates the plan.

---

## 1. Pitch

**THE LAST SIGNAL** is a browser first-person shooter. The player is trapped in a failing communications facility, survives escalating zombie waves, and restores a mysterious signal tower.

Two systems make it different:

1. **The horde adapts to how you play.**
2. **Every wave carries a Signal Mutation** that bends the rules of combat.

> Core principle (plan §40): **The next wave is a new tactical problem, never just "more zombies."**
>
> Target feeling at the end of a run: *"The game actually reacted to the way I played."*

## 2. Design pillars

1. **Feel first.** Responsive movement and aim, punchy weapons, clear hit feedback.
2. **Readable pressure.** The player understands the situation within one second of glancing at the HUD, and always knows why they died.
3. **The game reacts, fairly.** Adaptation is gradual, bounded, and communicated. It never feels like punishment.
4. **Short, distinct runs.** Mutations, adaptation, upgrades and environment changes combine so that two runs feel meaningfully different.

---

## 3. Run structure

A run is 20 waves in one compact facility. It ends in victory (wave 20 cleared and the signal transmitted) or in death.

| Waves | Difficulty tier (§13) | Signal phase (§19) | New threats introduced [Proposed] |
|---|---|---|---|
| 1–3 | Introduction | Collect components | Walker; Runner from wave 3 |
| 4–5 | More variety | Collect components | Screamer; first mutations |
| 6–7 | More variety | Restore power | Tank |
| 8–10 | Higher pressure | Restore power | First adaptations (Armored / Helmeted modifiers) |
| 11–12 | Higher pressure | Repair transmitter | Climber (if in the v1 roster, O-3) |
| 13–15 | Complex combinations | Repair transmitter | Elite modifier |
| 16–19 | Complex combinations | Charge transmitter | Mixed compositions; strongest mutations |
| 20 | Boss / major event | Transmit final signal | The Siren (boss) |

**Pacing target [Proposed].**
- Waves last about 45 s early, rising to about 90 s late.
- Each wave ends with a short breather (about 10–15 s), the upgrade screen and the Supply Terminal (§5.3).
- A full run is therefore roughly 25–35 minutes.

This maps onto the plan's first-session curve (§33):

| Plan timestamp | Run moment |
|---|---|
| 0:00–2:00 Learn controls | Pre-wave free movement + wave 1 |
| 2:00–5:00 First meaningful pressure | Waves 2–4 |
| 5:00–10:00 First build choices | Upgrade screens after waves 1–7 |
| 10:00–15:00 Mutations noticeable | Mutations from wave 4, stronger ones from ~wave 8 |
| 15:00–20:00 Adaptation apparent | First adaptation earliest after wave 5, typically noticed ~wave 8–12 |
| 20:00+ Recognisable build, major milestone | Waves 13–20, boss at wave 20 |

---

## 4. Player

### 4.1 Controls

Plan §3 controls are kept. Controls must be rebindable later, so bindings live in `config/input.ts`.

| Action | Default | Notes |
|---|---|---|
| Move | W A S D | Read by physical key position (`KeyboardEvent.code`), so AZERTY and other layouts work |
| Look | Mouse | Pointer lock; sensitivity, vertical clamp, invert-Y setting |
| Fire | Left click | |
| Aim / alternate action | Right click | Aim down sights for Pistol and AR. Shotgun alternate action: to be decided |
| Reload | R | |
| Sprint | Shift | Hold. A toggle option can come later |
| Crouch | **C** | Ctrl is available as an opt-in rebind. As a default, **Ctrl+W (crouch while moving forward) closes the browser tab**, and pages cannot block it (D-017) |
| Jump | Space | |
| Equip Primary | 1 | Loadout §5.1 (D-039) |
| Equip Secondary | 2 | Does nothing (brief "locked" feedback) until the Secondary slot is unlocked |
| Equip melee weapon | 3 | Holds the melee weapon as the active weapon: Fire then attacks with it |
| Cycle weapons | Mouse wheel | Cycles the available **firearms** (Primary ↔ Secondary; a locked or empty one is skipped); from melee it returns to a firearm |
| Pause | Esc | The game pauses when pointer lock is lost; the browser consumes this Esc press |
| **Interact** | **E** [Proposed, O-6] | Signal objectives (hold to repair or activate) |
| **Quick melee** | **V** (proposed default key) | **Always available** (D-039): a melee attack from whatever weapon is held, without switching away from it. Needed by Heavy Hands, the `meleeUsage` metric and the "Shotgun + Melee" build |

### 4.2 Core stats (intent)

- **Health:** 100. No armor in v1; the plan says "armor if implemented".
- **No passive health regeneration [Proposed].** Healing comes from upgrades (Vampire, Second Wind), rare pickups, and a partial heal at wave completion. This keeps the Survival build meaningful.
- **Movement intents** (Phase 1 values in `src/config/player.ts`, D-038; feel still to be confirmed by hand):
  - Walking is brisk: 5 m/s, full speed in 0.1 s, a stop in about 0.13 s.
  - Sprint is 1.5× walk speed (7.5 m/s), forward only; any shot or swing cancels it for 0.35 s (Phase 2). Lowering the weapon while sprinting is a later visual.
  - Crouch is 0.5× walk speed, held on C; it lowers the eyes from 1.62 m to 0.95 m, fits under 1.25 m, and tightens weapon spread (× 0.6 for the Pistol, Phase 2).
  - A jump reaches 1.15 m: it clears low cover (up to ~1 m) and the loading dock, not a 1.6 m crate. Small forgiveness windows: 0.1 s coyote time, 0.12 s jump buffer.
  - Mouse look: 60° vertical FOV (about 90° horizontal at 16:9), pitch limited to ±89°, subtle head bob (3 cm) while moving on the ground only.
- **Damage window [Proposed, D-029].** The player can only take damage during `WAVE_ACTIVE` and `BOSS`. This removes a whole class of edge cases, such as dying on the upgrade screen.
- **Phase 4 implementation (D-042).** Health 100 (`src/config/player.ts`). Enemy hits lower it only inside the damage window; at 0 the player dies once, the run ends (`GAME_OVER`, "You died"), and a click starts a new run at full health with the enemies reset. Until the wave system exists, a run goes straight into one open-ended wave (`WAVE_ACTIVE`), so the player can be hurt during play. No healing yet (upgrades and pickups later).

---

## 5. Weapons

All weapons share one framework, and each is a config entry (D-011). The player carries them in an explicit three-part **loadout** (D-039, resolves O-2).

### 5.1 Loadout: Melee, Primary, Secondary

The loadout is modelled around **three named categories**, never as "weapon slots 1–3":

| Category | At run start | Later | Rules |
|---|---|---|---|
| **Melee** | **Bare Hands** (fists) | Melee weapons bought or unlocked, e.g. a **Knife** | **Always available**, whatever firearm is held: quick melee (V) attacks without switching away. Never empty: Bare Hands is the fallback |
| **Primary** | **Pistol** | Assault Rifle, Shotgun; later e.g. an SMG | Holds one firearm. The Pistol is the initial firearm |
| **Secondary** | **Locked** | Unlocked through progression / a milestone (O-13); then holds one firearm such as a secondary pistol, machine pistol or revolver | Exists in the data from the first run, but cannot be equipped while locked |

- **Switching:** 1 equips the Primary, 2 the Secondary (once unlocked and filled), 3 holds the melee weapon; the mouse wheel cycles the available firearms. Quick melee (V) works from any of them.
- **Each weapon declares the categories it fits.** Assault Rifle and Shotgun fit Primary; secondary pistols fit Secondary; a Knife fits Melee. The starter Pistol fits Primary *and* Secondary [Proposed], so once the Secondary slot unlocks the player can keep it as a sidearm.
- **One weapon per category.** Acquiring a weapon for a category that is already filled replaces the weapon there [Proposed: no refund in v1; the Pistol stays cheap to buy back].
- **No soft-locks.** Melee is always usable, so the player can always deal damage; the Pistol keeps unlimited reserve ammo [Proposed], and the Supply Terminal sells ammunition [Proposed].

**Initial run:** Bare Hands · Pistol (Primary) · Secondary locked.

### 5.2 Weapons

| Weapon | Category | Role | Fire mode | Design intent |
|---|---|---|---|---|
| **Bare Hands** | Melee | Always-available fallback | Melee swing | Weak but reliable; pushes back or finishes a weakened enemy. The baseline every melee weapon improves on |
| **Pistol** | Primary (also fits Secondary [Proposed]) | Reliable starter; precision | Semi-automatic | The initial firearm. **Unlimited reserve ammo [Proposed]**: the magazine still needs reloading |
| **Assault Rifle** | Primary | Sustained damage at mid range | Automatic | High fire rate, medium damage, recoil that climbs with sustained fire |
| **Shotgun** | Primary | Close-range burst | Pump action, N pellets | Damage is spread across pellets. Devastating up close, but **weak against armor** (see §6) |
| *Knife* (later) | Melee | Melee build | Melee swing | Bought or unlocked; faster and stronger than fists |
| *SMG, secondary pistol, machine pistol, revolver* (later) | Primary / Secondary | Future content | — | Added as config entries; no new weapon code (D-011) |

**Phase 2 (D-040):** the Pistol and Bare Hands are implemented; their values are in BALANCING.md. Bare Hands is a placeholder swing (a 1.6 m reach check with a 0.5 s cooldown); since Phase 3 its swings (held or quick melee) deal damage through the same combat path as bullets. The Assault Rifle and Shotgun are future Primary purchases; the framework already supports automatic fire and pellets.

**Time-to-kill intents**, wave 1 Walker:
- Pistol: 1–2 headshots or 4–5 body shots.
- Assault Rifle: about 6–8 body hits.
- Shotgun: one point-blank shot.
- Bare Hands: a last resort (several hits), not a primary damage source.

### 5.3 Acquisition (resolves O-2, D-039)

- **Where:** the **Supply Terminal**, a shop available **between waves**.
- **Currency:** **Scrap** is the primary purchase currency.
- **What it sells:** firearms for Primary (and Secondary once unlocked), melee weapons, and ammunition [Proposed]. The stock and prices are balance data (BALANCING.md, from the progression / economy phases).
- **When and how it is presented** (a screen in the between-wave flow, or a terminal in the facility) is open question O-13; the default is a screen right after the upgrade choice, so the between-wave breather never becomes a walking section (§12, plan §19).
- **Unlocks:** the Secondary slot, and weapons that must be unlocked before they can be bought, come from progression / milestones (O-13).
- The earlier recommendation (weapon cards on the upgrade screens after waves 2 and 4) is withdrawn.

---

## 6. Damage model

**Body-part zones and multipliers (§10):**

| Zone | Multiplier |
|---|---|
| HEAD | 2.5× |
| TORSO | 1.0× |
| ARM_LEFT / ARM_RIGHT | 0.65× |
| LEG_LEFT / LEG_RIGHT | 0.5× |

Multipliers are configurable, and archetypes can override them (a Tank's body resists damage; its head does not).

- **Headshots use the weapon's own headshot multiplier** (Phase 3, D-041). The Pistol's 2.5× is the plan's HEAD value; Bare Hands hits the head for 1.5×. A target's HEAD override scales every weapon's headshot in proportion (a head twice as vulnerable doubles each weapon's value).
- **Critical damage.** A crit is a headshot or a boss weak-point hit. There are **no random crits**, which would blur skill feedback in an FPS. Implemented for headshots (Phase 3); boss weak points come with bosses.
- **Armor is a flat reduction per hit,** with a minimum-damage floor.
  - This naturally punishes many small hits (shotgun pellets, AR spray) more than a few large ones.
  - That is the mechanical meaning of "shotgun use → more armored enemies" (§15). It creates a real problem the player can solve by switching weapon or aiming better.
- **Helmets (the "protected-head" counter)** absorb head damage until they break. Headshot-focused players are slowed down, not shut out, and knocking the helmet off feels good.
- **Distance falloff** is configured per weapon.
- **Hit reactions.** Enough damage within a short window triggers `STAGGER`. Tanks resist stagger except from headshots. Phase 3 implements the rule and the `staggered` event (damage within 1 s of the previous hit adds up; each target has a threshold, or none to be immune). Phase 4: a staggered enemy stops for its stagger duration and loses the attack it was winding up (§7.1).
- **Feedback:**
  - hit marker, with a distinct marker and sound for headshots
  - kill confirmation
  - optional damage numbers (settings toggle)
  - directional damage indicator when the player is hit
- **Phase 3 placeholder feedback (D-041):** a hit marker on the crosshair (white for a hit, gold for a headshot, red and larger for a kill), floating damage numbers (gold for headshots; on by default until the settings toggle exists), a short spark where a bullet hits a body, and the target flashing and rocking away from the hit. Blood, gore and hit sounds come with the VFX and audio phases.

### 6.1 Health and death (Phase 3, D-041)

- **One health model for everything that can be hurt:** training dummies now; zombies, bosses and the player later. Health stays between 0 and the maximum; reaching 0 is death; death happens once, and a dead target ignores further damage and healing.
- **A dead target is no longer hit:** shots pass through it to whatever is behind.
- **Healing** never goes above the maximum; a maximum can change (upgrades such as Thick Skin), keeping the current fraction or clamping.

### 6.2 Ammo drops (Phase 3 foundation, D-041)

- A death can leave pickups, rolled from a **drop table** (each entry has its own chance; the Scavenger upgrade will raise them).
- **Ammo pickups** give whole magazines to every carried firearm whose reserve is limited. The starter Pistol's reserve is unlimited (D-039), so it takes nothing, and a pickup that nobody needs stays on the ground until it expires (30 s).
- Enemy drop tables, other pickup kinds (health, components) and the ammo economy come with the phases that need them.

### 6.3 Training dummies (temporary, Phase 3)

- **Validation targets, not a gameplay feature.** Three dummies stand in the yard facing the spawn until real enemies exist: a *standard* dummy straight ahead (100 health, standing in for a wave-1 Walker; it can drop ammo), another standard dummy, and a *zone* dummy with each body part painted (400 health, for checking where hits land).
- They use exactly what zombies will: a hitbox rig with the six zones, health, stagger and a drop table. They never move or attack and do not block the player.
- A killed dummy falls, stays down for 3 s and stands up again. Every new run restores the range.
- The range is removed from normal play when waves arrive; the debug tools can still place dummies.

---

## 7. Enemies

| Archetype | Gameplay purpose | Behaviour | Counter-play | v1 roster |
|---|---|---|---|---|
| **Walker** | Baseline; teaches headshots | Slow, high health, melee | Headshots, positioning | Yes |
| **Runner** | Punishes standing still; dangerous in groups | Fast, low health, lunges | Crowd control, retreat paths | Yes |
| **Tank** | Forces focus fire; blocks chokepoints | Very slow, very high health, body-shot resistant, stagger-immune | Aim for the head weak point; kite | Yes |
| **Screamer** | Forces target prioritisation | Keeps its distance; screams to alert and hasten nearby zombies; the scream triggers a screen/audio effect | Kill it first; interrupt the scream | Yes |
| **Climber** | Counters camping on high ground | Scales walls using climb links; medium health | Move; watch the climb points | **Deferred [Open O-3]** |

**Why defer the Climber.** The plan lists 5 archetypes (§12) but the initial build targets 4 (§42). The Climber is the most expensive technically: it needs climb links, vertical navigation and climb animations. Until it exists, the "elevated position" adaptation rule falls back to Runners with spawns biased toward flanking routes.

**Modifiers** (overlays on any archetype, D-012):
- **Armored:** flat armor on torso and limbs.
- **Helmeted:** breakable head armor.
- **Elite:** stat boost, a visual tell, and bonus rewards.

**AI states (§11):** `IDLE, PATROL, DETECT, CHASE, ATTACK, STAGGER, DEAD`.
- During a wave, the horde is drawn to the signal, so spawned zombies know roughly where the player is.
- `IDLE` and `PATROL` serve ambient placements, ambushes and the future Hunter boss.
- `DETECT` is a short, readable "noticed you" tell before `CHASE`.

**Fairness rules:**
- Every attack has a wind-up tell (animation and sound).
- Zombies never spawn in the player's view or within a minimum distance of them.

### 7.1 The Walker (Phase 4, D-042)

The first zombie, and the baseline the others are measured against. Values are in `src/config/enemies.ts`; the reasoning is in BALANCING.md §2.6.

- **Slow and durable:** it walks at 1.6 m/s (the player walks at 5) and has 120 health, so it takes two Pistol headshots or five body shots. It never runs, lunges or attacks from range.
- **Senses:** it notices the player within 12 m if it can see them, turns toward them for a moment (0.6 s, the "noticed you" tell), then walks at them. It keeps chasing while it can see the player, or for 5 s after losing sight of them, up to 24 m away. A shot that hits it tells it where the shooter is, whatever the range.
- **Finds its way:** straight at the player when nothing is in the way; otherwise along the facility's routes (through doorways, up the stairs and the ramp to the catwalk, onto the dock), never through walls.
- **Attack (the telegraph):** within 1.5 m it stops, raises its arms forward and glows orange for 0.7 s, then strikes once for 15. The strike is committed: it lands only if the player is still within 1.9 m, in front of it and not behind a wall, so stepping back or aside during the wind-up dodges it. It attacks again at most every 1.6 s. Seven hits kill a player at full health.
- **Stagger:** 35 damage within 1 s (any headshot does it) stops it for 0.7 s and cancels a wind-up in progress.
- **Death:** it falls, lies there for 5 s, sinks and is gone. It sometimes drops ammo (20%).
- **Idle:** without a target it stands, or wanders a few metres around where it was placed.
- **Placeholder look:** a grey-box humanoid built from its own hit volumes (pale green head and arms, dark shirt and trousers, yellow eyes), so what you see is exactly what you can hit. Final models and animation come later (D-030).

### 7.2 The test encounter (temporary, Phase 4)

Until waves exist (Phase 6), every new run places three Walkers: two standing guard to either side of the yard (8 m off the path north from the spawn, 14–15 m from the spawn, so a player who stays at the spawn is left alone) and one wandering the north-east yard. A Walker whose body has gone comes back 10 s later. It is on in every build, like the training dummies, so the Walker can be played in production; the wave system replaces it.

---

## 8. Waves and difficulty

- **Each wave defines** (§13): `waveNumber, enemyBudget, spawnRate, enemyComposition, mutation, specialEvent, bossFlag`, plus `maxAlive`.
- **The budget is in threat points,** and each archetype and modifier has a threat cost.
  - Difficulty rises mainly through **composition complexity and modifiers**.
  - Enemy health scaling is gentle and **capped**, as the plan asks for a controlled curve instead of multiplying HP forever.
- **Variety guarantees:**
  - Waves rotate through composition themes: swarm, heavy, mixed, ambush.
  - The same mutation never appears twice in a row.
  - Special events are spaced out.
- **Mutation-free introduction [Proposed, O-7].**
  - Waves 1–3 have no mutation, so the player learns the basics first (§33).
  - Waves 4–19 each have exactly one mutation.
  - Wave 20 (the boss) has its own rules.
- **Unlimited waves (§13) vs the 20-wave target (§42) [Proposed, O-5].**
  - The generator and difficulty curve support any wave number.
  - A standard run ends in victory at wave 20.
  - Endless play after victory is a later nice-to-have.

---

## 9. Signal Mutations

Each mutation is pure data made from effect kinds (D-009). The plan lists 8 mutations (§14) and the initial build targets 6 (§42).

| Mutation | Rule change | Tactical problem | Counter-play | Effect kind | v1 |
|---|---|---|---|---|---|
| **BLACKOUT** | Lights drop sharply; emergency lights stay on | Visibility | Hold lit zones; muzzle flash lights the area | environment | Yes |
| **HUNGER** | Enemy movement speed up | Less time per target | Positioning, retreat routes | stat | Yes |
| **STATIC** | Periodic visual interference | Information denial | Rely on audio cues | screen | Yes |
| **SCREAM** | Enemy deaths alert nearby enemies | Every kill pulls more attention | Fight at range; isolate targets | trigger | Yes |
| **HIVE** | Extra spawn events | Surprise flanks | Map awareness | spawnRule | Yes |
| **BLOOD MOON** | Higher chance of Elite enemies | High-value targets | Prioritise; earn bonus rewards | spawnRule | Yes |
| **LOW GRAVITY** | Player and enemy physics change | Movement and aim relearned | Vertical play | stat (`world.gravity`) | **Deferred [Open O-4]** |
| **OVERLOAD** | Weapon fire causes environmental effects; recoil increases | Risk vs reward | Burst discipline | trigger + stat | **Deferred [Open O-4]** |

**Why defer these two:**
- LOW GRAVITY affects player physics, enemy navigation (airborne time vs the nav grid) and animation.
- OVERLOAD's "additional environmental effects" is not yet defined.
- Either can be added later without changing the architecture.

**Presentation.**
- At `WAVE_START`, show the mutation name, a one-line rule and an icon.
- The icon stays on the HUD for the whole wave.
- **[Proposed]** Mutated waves pay a small reward bonus, so they read as a challenge rather than just a nerf.

**BLACKOUT visibility [Open O-10].** Should the player have a flashlight? It would make BLACKOUT a positioning problem instead of pure frustration, but it adds a control and a shadow-casting light.

---

## 10. Adaptive horde (signature mechanic)

The game builds a lightweight behaviour profile from the plan §15 metrics:

`shotgunUsage, rifleUsage, headshotRate, averageDistance, timeSpentInOneArea, elevatedPositionUsage, sprintUsage, meleeUsage, accuracy, damageTaken, kiteFrequency`

### 10.1 Rules

The first four rules come from the plan. Exact thresholds go in `config/adaptation.ts`.

| Observed behaviour | Response |
|---|---|
| High shotgun usage | Higher chance of the **Armored** modifier |
| Frequent high-ground use | More **Climbers** (fallback while the Climber is deferred: Runners plus flank-biased spawns) |
| High mobility (sprint and kite frequency) | More **Runners** |
| Extreme headshot rate | Higher chance of the **Helmeted** modifier |
| Camping in one area **[Proposed]** | Spawns biased toward that area's flanks; more Screamers |
| Struggling (low accuracy, heavy damage taken) **[Proposed]** | A subtle, silent easing of composition. Adaptation should feel like natural difficulty, not punishment |

### 10.2 Guardrails [Proposed, D-026]

1. **Evaluated only between waves,** never mid-fight.
2. **Minimum evidence.** At least 2 waves and enough relevant events before a rule can fire.
3. **Hysteresis and cooldown.** Separate enter and exit thresholds; a rule cannot re-fire for several waves.
4. **Bounded influence.** Each weight multiplier is capped, and at most 2 adaptations are active at once.
5. **Changes the mix, never the total.** Adaptation changes *which* enemies appear, never the total threat budget.
6. **Decay.** Responses fade when the player changes behaviour, which rewards adapting back.
7. **Never before wave 5.**
8. **Always communicated.** After the wave, a "SIGNAL ANALYSIS" line appears on the upgrade screen, for example: *"The horde has noticed your perch. Climbers are coming."*

**Why communication is essential.** An invisible adaptive system looks exactly like randomness. Unexplained counters feel like punishment, and both outcomes defeat the pillar "the game reacts, fairly".

---

## 11. Progression and builds

**Currencies (§21):** XP and SCRAP only.
- Sources: kills, headshots, wave completion, boss kills, optional objectives and rare events.
- **Scrap is spent at the Supply Terminal between waves** on weapons, melee weapons and ammunition (§5.3, D-039).

**Upgrade selection** happens after every completed wave:
- Three random cards, with no duplicates within one offer.
- Upgrades can stack, up to a cap per upgrade.

**How builds emerge [Proposed].**
- Each upgrade has tags: `PRECISION`, `CLOSE_QUARTERS`, `MOBILITY`, `SURVIVAL`, `UTILITY`.
- Offers lean slightly toward tags the player already owns.
- Every offer keeps at least one card outside the player's current build.
- Builds therefore form on their own (§17), without hard-coded classes.

### 11.1 Upgrade pool (target 12+)

| Upgrade | Effect | Tags | Source |
|---|---|---|---|
| Gunner | + fire rate | MOBILITY | Plan |
| Executioner | + headshot damage | PRECISION | Plan |
| Adrenaline | + movement speed | MOBILITY | Plan |
| Scavenger | + ammo drop chance | UTILITY | Plan |
| Vampire | Heal a little on each kill | SURVIVAL | Plan |
| Heavy Hands | + melee damage (melee is always available, D-039) | CLOSE_QUARTERS | Plan |
| Technician | Faster trap/utility cooldown. **Blocked:** the plan defines no trap or utility system (O-6) | UTILITY | Plan |
| Quick Hands | + reload speed | MOBILITY | [Proposed] |
| Deep Pockets | + magazine size | UTILITY | [Proposed] |
| Thick Skin | + max health | SURVIVAL | [Proposed] |
| Steady Aim | − recoil and spread | PRECISION | [Proposed] |
| Point Blank | + close-range damage | CLOSE_QUARTERS | [Proposed] |
| Long Shot | − damage falloff | PRECISION | [Proposed] |
| Second Wind | Heal a percentage when a wave completes | SURVIVAL | [Proposed] |
| Scrapper | + Scrap gained | UTILITY | [Proposed] |

That makes 14 usable upgrades and 1 blocked.

### 11.2 Target builds from plan §17

| Build | Key upgrades |
|---|---|
| Shotgun + Melee | Point Blank, Heavy Hands, Thick Skin |
| Headshot + Precision | Executioner, Steady Aim, Long Shot |
| Mobility + SMG/Rifle | Adrenaline, Gunner, Quick Hands (the AR fills the SMG role in v1) |
| Survival + Healing | Vampire, Second Wind, Thick Skin |

### 11.3 What XP and Scrap buy [Partly open, O-1]

The plan says Scrap is for "persistent purchases" and XP "unlocks progression", but defines no screen or content for either.

**Decided (D-039):** Scrap is the primary purchase currency at the **Supply Terminal between waves** (weapons, melee weapons, ammunition). The terminal is the Scrap sink during a run.

**Still open (O-1), recommendation:**
- **XP** raises a persistent profile level. Levels add new upgrade cards, variants and purchasable weapons to the pool, so first runs stay simple.
- **Unspent Scrap** at the end of a run: whether any of it carries over to modest permanent purchases (the plan's "persistent purchases") is not decided. Default: it does not; the run's Scrap is spent at the terminal.

---

## 12. Signal progression and environment

The long-term objective must happen **during** waves, never as a walking section between them (§19).

| Waves | Phase | In-wave objective [Proposed] | Base environment |
|---|---|---|---|
| 1–5 | Collect components | Components drop from Elites and caches; picked up on touch | POWER_FAILURE → EMERGENCY_LIGHTING |
| 6–10 | Restore power | Hold E at generator switches while under pressure; each restored switch relights a zone | EMERGENCY_LIGHTING → NORMAL |
| 11–15 | Repair transmitter | Hold E at repair points; taking damage interrupts the repair | NORMAL, with STRUCTURAL_DAMAGE events |
| 16–19 | Charge transmitter | Stand inside the charge ring; charge builds while the player survives there | SIGNAL_OVERLOAD (flicker, interference) |
| 20 | Transmit final signal | Survive The Siren while the transmission uploads | SIGNAL_OVERLOAD + NIGHT_MODE |

**Objective rule [Proposed, O-12].**
- The signal phase always advances with wave number, so reaching wave 20 is always possible.
- Completing objectives adds **signal strength** and rewards.
- Signal strength later drives the "multiple endings" should-have.

This rules out soft-locks and keeps objectives optional but valuable.

**Environment states (§18):** `NORMAL, POWER_FAILURE, EMERGENCY_LIGHTING, STRUCTURAL_DAMAGE, HEAVY_SMOKE, NIGHT_MODE, SIGNAL_OVERLOAD`.
- The plan writes "NIGHT MODE"; the identifier is `NIGHT_MODE`.
- **Events** can disable lights, open doors, close routes, open new spawn paths, move safe areas, trigger alarms and change visibility.
- **Layering (D-028):** signal progression sets the base state; events and mutations add temporary overlays.

### 12.1 Map: one compact facility [Proposed layout]

The facility is about 60 × 60 m and has these areas:
- **Central yard and signal tower:** the objective hub, with open sightlines.
- **Control room:** indoors; holds the transmitter terminal.
- **Generator hall:** power switches, with machinery for cover.
- **Loading bay:** the main spawn entrance; parked vehicles give cover.
- **Catwalks and rooftops:** elevated positions. They are risk/reward and are what the Climber counters.
- **Service corridors:** tight routes that events can open or close.

**Layout rules:**
- 3–4 connected loops and no dead ends, so kiting is possible (`kiteFrequency`).
- Spawns come from perimeter fences, vents and bay doors.

---

## 13. Boss — The Siren (v1)

| Phase | Health | Behaviour |
|---|---|---|
| 1 | 100–66% | Stalks at range. Sonic scream on a cooldown, telegraphed by a rising audio wind-up. The scream distorts the screen and muffles audio for a few seconds, and summons Runners |
| 2 | 66–33% | Moves between elevated points. Screams also cut the lights briefly (a mini-BLACKOUT) and summon Screamers |
| 3 | 33–0% | Enraged: shorter cooldown; charges the player. After each scream a glowing weak point is exposed, opening a critical-damage window |

- **Counter-play:** headshots during the wind-up interrupt the scream (stagger), and killing the summons first matters.
- **The Hunter** (stealth, ambush, repositioning) comes after v1; it needs a cloaking effect and flanking AI.
- **Boss placement [Open O-5]:** the Siren is the wave 20 finale in v1. The Hunter could later become a wave 10 mid-boss.

---

## 14. HUD

Minimal. The player must understand the situation within one second (§22).

```text
┌──────────────────────────────────────────────────────────────────┐
│ WAVE 7 · 12 LEFT           ◆ BLACKOUT          SIGNAL ▓▓▓▓▓░░ 62% │
│                                                                  │
│                                  +                               │
│                                                                  │
│ ♥ 84                                             AR   24 / 120   │
│                                                         ⚙ 340    │
└──────────────────────────────────────────────────────────────────┘
```

- **Largest elements:** health (bottom left) and ammo with the current weapon (bottom right).
- **Loadout strip** (small, beside the ammo): Primary, Secondary (a lock icon while locked) and Melee, with the active one highlighted (D-039). Not built yet.
- **Phase 2 placeholder:** a centre dot crosshair and the held weapon's name and ammunition (`12 / ∞`, `RELOADING`) until the UI phase.
- **Phase 3 placeholder:** a hit marker around the crosshair (hit, headshot, kill) and floating damage numbers (§6).
- **Phase 4 placeholder:** health bottom left (`HEALTH 85` and a bar) and a brief red flash at the screen edges when the player is hit; "You died / Click to start a new run" at game over.
- **Secondary:** wave and enemies remaining (top left), the active mutation (top centre), signal progress (top right) and Scrap (small).
- **Optional (§22):** crosshair, damage direction indicator, kill feed, mutation announcement banner.
- **Low health:** vignette plus a heartbeat sound (§23).

---

## 15. Audio cues

Audio should warn the player of danger before they see it (§23).

| Cue | Intent |
|---|---|
| Wave start | Rising siren sting; mutation name voiced or stung |
| Elite spawn | Distinct distorted roar, positioned in space |
| Boss spawn | Music transition plus a unique sting |
| Mutation | Short "signal corruption" sound per mutation |
| Runner approaching | Fast footsteps, spatialised, audible before the Runner is in view |
| Screamer charging | Rising shriek wind-up, so the player can interrupt it |
| Tank | Heavy thuds with a low-frequency rumble |
| Reload / empty magazine | Crisp mechanical clicks; a dry-fire click when empty |
| Low health | Heartbeat, with other sounds muffled |

**Dynamic music** raises its intensity with pressure: enemies alive and nearby, low health, boss phase.

---

## 16. Win, lose and restart

- **Lose:** health reaches 0, then `GAME_OVER`. The screen shows:
  - the wave reached
  - what killed the player (archetype + mutation)
  - key stats
  - which adaptations the player faced

  This fulfils the plan's rule that the player always understands why they died. Restart is one click and should take about 2 s.
- **Win:** clear wave 20 and transmit the signal, then `VICTORY`, showing run stats and signal strength.

---

## 17. Graphics quality and fairness (D-037)

- **Scaled visuals.** The game runs on a wide range of hardware. The minimum is an Intel i5-4440 with a GTX 750 at ~30 FPS, 1080p, Low. Capable GPUs such as an RTX 4050 class card get much richer visuals at High and Ultra.
- **The art direction targets High.** Low is a faithful, readable reduction of it, never the other way round.
- **Every tier plays the same game.** Enemies, rules and hitboxes are identical, and so is **gameplay-relevant visibility**:
  - fog distance;
  - BLACKOUT darkness;
  - sight-blocking smoke;
  - muzzle-flash light;
  - attack and boss telegraphs.
- **No advantage from settings.** Lower settings may never make it easier to see; higher settings may never hide information.
- **Tells are never scaled away.** Effects that carry a gameplay tell (Screamer charge-up, Siren scream wind-up, elite markers) render on every preset. Only cosmetic density scales.

---

## 18. Out of scope for v1

Per plan §39 and §42:
- multiplayer
- a second map
- weapon customisation
- daily challenge
- leaderboards (local or online)
- the Hunter boss
- LOW GRAVITY and OVERLOAD
- multiple endings (the data hooks exist, but only one ending ships)
