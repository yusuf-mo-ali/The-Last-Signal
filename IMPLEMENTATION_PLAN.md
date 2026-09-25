\# THE LAST SIGNAL



\## Browser Zombie FPS — Waves Edition



\### Production Implementation Plan v1.0



\---



\## 1. Project Vision



\*\*THE LAST SIGNAL\*\* is a browser-based first-person zombie survival game built around wave-based combat, adaptive enemy behavior, dynamic wave mutations, player progression, and environmental changes.



The game should feel like a polished indie FPS rather than a technical demo.



\### Core fantasy



The player is trapped inside a failing communications facility and must survive increasingly dangerous zombie waves while restoring a mysterious signal tower.



The central gameplay twist is:



> \*\*The game observes how the player plays and adapts future waves accordingly.\*\*



The second major system is:



> \*\*Every wave can receive a temporary "Signal Mutation" that changes the rules of combat.\*\*



The player is therefore fighting both the zombies and the evolving rules of the world.



\---



\# 2. Primary Design Goals



\### Must Have



\* First-person movement

\* Mouse look

\* Shooting

\* Reloading

\* Weapon handling

\* Zombie enemies

\* Multiple zombie archetypes

\* Wave-based spawning

\* Increasing difficulty

\* Health and damage

\* Ammo management

\* XP / Scrap progression

\* Upgrade selection between waves

\* Signal Mutation system

\* Adaptive zombie behavior

\* Dynamic environmental states

\* Boss encounters

\* Basic game progression

\* Main menu

\* Pause menu

\* Game over

\* Restart flow

\* Performance suitable for modern desktop browsers

\* Persistent settings

\* Deployable production build



\### Should Have



\* Weapon switching

\* Headshots and body-part damage

\* Enemy hit reactions

\* Muzzle flash

\* Bullet impacts

\* Blood / hit VFX

\* Dynamic lighting

\* Ambient audio

\* Footstep audio

\* Zombie audio

\* Screen effects

\* Minimap or directional indicators

\* Multiple endings / final outcome variation

\* Analytics hooks



\### Nice to Have



\* Weapon customization

\* Daily challenge

\* Leaderboard

\* Procedural wave modifiers

\* More boss variants

\* Additional maps

\* Online leaderboard backend

\* Advanced post-processing



Nice-to-have features must never block the core game.



\---



\# 3. Target Platform



\## Primary Platform



Desktop browsers.



\### Target browsers



\* Chrome

\* Edge

\* Firefox



\### Resolution targets



Primary:



\* 1920 × 1080

\* 1600 × 900

\* 1366 × 768



The game must remain playable at lower resolutions.



\### Input



Primary:



\* Mouse

\* Keyboard



Controls:



\* W / A / S / D — movement

\* Mouse — camera

\* Left click — fire

\* Right click — aim / alternate weapon action

\* R — reload

\* Shift — sprint

\* C / Ctrl — crouch

\* Space — jump

\* 1 / 2 / 3 — weapon switch

\* Esc — pause



Controls must be configurable later.



\---



\# 4. Recommended Technology Stack



\## Rendering



\*\*Three.js + WebGL\*\*



Reason:



\* Native browser delivery

\* No install required

\* Large ecosystem

\* Good support for 3D scenes

\* Easy deployment through Vercel

\* Excellent fit for AI-assisted development



\## Language



\*\*TypeScript\*\*



Strict typing must be enabled.



\## Build



\*\*Vite\*\*



\## UI



HTML/CSS + TypeScript.



Use DOM UI for menus and HUD unless an in-engine element is specifically required.



\## Audio



Web Audio API / Three.js audio system.



\## Physics



Use a lightweight browser-compatible physics/collision solution only where necessary.



Do not introduce a heavy physics engine unless gameplay requirements justify it.



\## Deployment



Vercel.



\## Source Control



Git + GitHub.



\---



\# 5. Architecture Principles



The project must be modular.



Do NOT create one giant game file.



Use isolated systems with clear responsibilities.



Recommended architecture:



```text

src/

├── core/

│   ├── Game.ts

│   ├── GameState.ts

│   ├── EventBus.ts

│   ├── Time.ts

│   └── Config.ts

│

├── player/

│   ├── Player.ts

│   ├── PlayerController.ts

│   ├── CameraController.ts

│   ├── PlayerHealth.ts

│   └── PlayerMovement.ts

│

├── weapons/

│   ├── Weapon.ts

│   ├── WeaponManager.ts

│   ├── hitscan/

│   ├── projectile/

│   ├── recoil/

│   └── ammo/

│

├── enemies/

│   ├── Enemy.ts

│   ├── EnemyManager.ts

│   ├── EnemySpawner.ts

│   ├── zombie/

│   ├── ai/

│   └── damage/

│

├── waves/

│   ├── WaveManager.ts

│   ├── WaveGenerator.ts

│   ├── WaveDifficulty.ts

│   └── WaveMutation.ts

│

├── progression/

│   ├── XPSystem.ts

│   ├── ScrapSystem.ts

│   ├── UpgradeSystem.ts

│   └── PlayerBuild.ts

│

├── signal/

│   ├── SignalSystem.ts

│   ├── SignalMutationSystem.ts

│   └── SignalProgression.ts

│

├── world/

│   ├── World.ts

│   ├── EnvironmentState.ts

│   ├── LightingController.ts

│   └── DynamicEvents.ts

│

├── bosses/

│   ├── Boss.ts

│   └── bosses/

│

├── ui/

│   ├── HUD.ts

│   ├── MainMenu.ts

│   ├── PauseMenu.ts

│   ├── UpgradeScreen.ts

│   └── GameOverScreen.ts

│

├── audio/

│   ├── AudioManager.ts

│   ├── MusicManager.ts

│   └── SoundLibrary.ts

│

├── effects/

│   ├── VFXManager.ts

│   ├── HitEffects.ts

│   ├── MuzzleFlash.ts

│   └── ScreenEffects.ts

│

├── save/

│   ├── SaveManager.ts

│   └── SettingsManager.ts

│

└── main.ts

```



\---



\# 6. Core Game State



The game must use an explicit state machine.



States:



```text

BOOT

MAIN\_MENU

LOADING

PLAYING

WAVE\_START

WAVE\_ACTIVE

WAVE\_COMPLETE

UPGRADE\_SELECTION

BOSS

PAUSED

GAME\_OVER

VICTORY

```



Never rely on scattered boolean flags such as:



```ts

isPlaying

isPaused

isGameOver

isWaveStarting

```



when a proper state machine can express the same behavior.



\---



\# 7. Phase 0 — Project Foundation



\## Objectives



Create a clean, maintainable browser game foundation.



\### Tasks



\* Initialize Vite + TypeScript

\* Configure strict TypeScript

\* Configure ESLint

\* Configure formatting

\* Create folder architecture

\* Create Game bootstrap

\* Create rendering loop

\* Create scene

\* Create camera

\* Create resize handling

\* Create input manager

\* Create EventBus

\* Create configuration system

\* Create game state machine

\* Add debug mode

\* Add FPS counter

\* Add basic error handling



\### Acceptance Criteria



\* Project launches successfully

\* No TypeScript errors

\* No console errors

\* Rendering loop stable

\* Resize works correctly

\* Input system works

\* Game state transitions are testable



\---



\# 8. Phase 1 — First Person Foundation



\## Objectives



Create a responsive FPS controller.



\### Features



Movement:



\* Forward

\* Backward

\* Strafe

\* Sprint

\* Crouch

\* Jump



Camera:



\* Mouse look

\* Sensitivity

\* Vertical clamp

\* FOV setting

\* Head movement / subtle bob



Collision:



\* Ground detection

\* Basic environment collision

\* No falling through the map



\### Acceptance Criteria



The player must be able to walk around the complete prototype map comfortably.



Movement must feel responsive and predictable.



\---



\# 9. Phase 2 — Weapon Framework



Create a reusable weapon architecture.



Base weapon properties:



```ts

damage

fireRate

magazineSize

ammo

reloadTime

range

recoil

spread

headshotMultiplier

```



Weapon interface:



```ts

fire()

reload()

canFire()

getAmmo()

getState()

```



\## Initial Weapons



\### Pistol



Balanced starter weapon.



\### Assault Rifle



High fire rate, medium damage.



\### Shotgun



Multiple pellets and high close-range damage.



Do not duplicate weapon logic.



All weapons should inherit from the same weapon framework.



\---



\# 10. Phase 3 — Combat System



Implement:



\* Hitscan shooting

\* Raycasting

\* Hit detection

\* Damage system

\* Headshots

\* Hit reactions

\* Critical damage

\* Death

\* Damage numbers / visual feedback

\* Weapon recoil

\* Reloading

\* Ammo drops



\### Body-part system



Each zombie should expose damage zones:



```text

HEAD

TORSO

ARM\_LEFT

ARM\_RIGHT

LEG\_LEFT

LEG\_RIGHT

```



Different zones may apply different multipliers.



Example:



```text

Head = 2.5x

Torso = 1.0x

Arms = 0.65x

Legs = 0.50x

```



Numbers must remain configurable.



\---



\# 11. Phase 4 — Zombie Foundation



Create a reusable enemy framework.



Base enemy:



```text

Health

Movement speed

Attack damage

Attack range

Detection range

Attack cooldown

Target

State

```



Basic AI states:



```text

IDLE

PATROL

DETECT

CHASE

ATTACK

STAGGER

DEAD

```



The AI must not run expensive logic every render frame.



Use controlled update intervals for expensive decisions.



\---



\# 12. Phase 5 — Zombie Archetypes



Implement multiple enemy types.



\## Walker



\* Slow

\* High health

\* Basic melee attack



\## Runner



\* Fast

\* Lower health

\* Dangerous in groups



\## Tank



\* Very high health

\* Slow

\* Resistant to normal body shots



\## Climber



Designed specifically to counter elevated-position strategies.



\## Screamer



Does not focus primarily on melee combat.



It can:



\* Alert nearby zombies

\* Trigger temporary screen/audio effects

\* Create additional pressure



Each archetype must have a clear gameplay purpose.



\---



\# 13. Phase 6 — Wave System



This is one of the game's primary systems.



Each wave contains:



```ts

waveNumber

enemyBudget

spawnRate

enemyComposition

mutation

specialEvent

bossFlag

```



Difficulty should scale using a controlled curve rather than simply multiplying enemy HP forever.



Example:



```text

Wave 1–3

Basic introduction



Wave 4–7

More enemy variety



Wave 8–12

Higher pressure



Wave 13–19

Complex combinations



Wave 20

Boss / major event

```



The system should support theoretically unlimited waves.



\---



\# 14. Phase 7 — Signal Mutation System



Every normal wave receives one mutation.



Mutations modify gameplay rules.



Examples:



\### BLACKOUT



Lighting decreases significantly.



Emergency lights remain active.



\### HUNGER



Enemy movement speed increases.



\### STATIC



Occasional visual interference.



\### SCREAM



Enemy deaths can alert nearby enemies.



\### HIVE



Additional spawn events occur.



\### BLOOD MOON



Higher elite enemy probability.



\### LOW GRAVITY



Player and enemy movement physics become temporarily different.



\### OVERLOAD



Weapon fire causes additional environmental effects but increased recoil.



Mutations must be data-driven.



Do not hard-code them directly into WaveManager.



\---



\# 15. Phase 8 — Adaptive Zombie System



This is the signature mechanic.



The game tracks player behavior.



Create a lightweight player behavior profile.



Example metrics:



```ts

shotgunUsage

rifleUsage

headshotRate

averageDistance

timeSpentInOneArea

elevatedPositionUsage

sprintUsage

meleeUsage

accuracy

damageTaken

kiteFrequency

```



These values should not immediately alter the game.



Use thresholds and cooldowns to prevent obvious cheating-by-the-AI behavior.



Example:



```text

High shotgun usage

&#x20;       ↓

Increase armored enemy probability



Frequent high-ground usage

&#x20;       ↓

Increase climber probability



High mobility

&#x20;       ↓

Increase runner probability



Extreme headshot rate

&#x20;       ↓

Introduce protected-head enemies

```



The system should feel like natural difficulty adaptation, not punishment.



\---



\# 16. Phase 9 — Progression System



After each completed wave:



```text

XP

SCRAP

UPGRADE CHOICE

```



\## Scrap



Used for persistent purchases.



\## XP



Used to unlock progression.



\## Upgrade selection



Present three randomly selected upgrades.



Examples:



\### Gunner



\* Fire rate



\### Executioner



\* Headshot damage



\### Adrenaline



\* Movement speed



\### Scavenger



\* Ammo drop chance



\### Vampire



Recover a small amount of health on kill.



\### Heavy Hands



\* Melee damage



\### Technician



Faster trap / utility cooldown.



\---



\# 17. Phase 10 — Player Build System



The player should be able to naturally develop different builds.



Examples:



```text

SHOTGUN + MELEE

```



```text

HEADSHOT + PRECISION

```



```text

MOBILITY + SMG/RIFLE

```



```text

SURVIVAL + HEALING

```



Builds should emerge from combinations of upgrades instead of being hard-coded classes.



\---



\# 18. Phase 11 — Dynamic Environment



The environment evolves throughout the run.



Possible states:



```text

NORMAL

POWER\_FAILURE

EMERGENCY\_LIGHTING

STRUCTURAL\_DAMAGE

HEAVY\_SMOKE

NIGHT MODE

SIGNAL\_OVERLOAD

```



Environmental events can:



\* Disable lights

\* Open doors

\* Close routes

\* Create new spawn paths

\* Change safe areas

\* Trigger alarms

\* Modify visibility



The map should progressively feel less stable.



\---



\# 19. Phase 12 — Signal Progression



Create the main long-term objective.



The player restores the signal tower.



Example progression:



```text

Wave 1–5

Collect components



Wave 6–10

Restore power



Wave 11–15

Repair transmitter



Wave 16–19

Charge transmitter



Wave 20

Transmit final signal

```



The objective must happen naturally during the wave loop.



Do not turn the game into a separate walking simulator between waves.



\---



\# 20. Phase 13 — Boss System



Every major milestone can introduce a boss.



\## Boss 1 — THE SIREN



Core mechanic:



\* Sonic scream

\* Temporary visual/audio disruption

\* Summons additional enemies



\## Boss 2 — THE HUNTER



Core mechanic:



\* Stealth

\* Disappearance

\* Ambush

\* Repositioning



Boss behavior must be mechanically distinct.



Bosses should have phases rather than simply huge health pools.



\---



\# 21. Phase 14 — Game Economy



Keep the economy easy to understand.



Currencies:



```text

XP

SCRAP

```



Avoid introducing five different currencies.



Rewards come from:



\* Enemy kills

\* Headshots

\* Wave completion

\* Boss kills

\* Optional objectives

\* Rare events



\---



\# 22. Phase 15 — UI / HUD



HUD must remain minimal.



Display:



```text

Health

Armor if implemented

Ammo

Current weapon

Wave

Enemies remaining

Signal progress

Scrap

```



Optional:



\* Crosshair

\* Damage indicator

\* Kill feed

\* Mutation announcement



\## UX Rule



The player should understand their current situation within one second of looking at the HUD.



\---



\# 23. Phase 16 — Audio



Implement an audio manager.



Categories:



```text

Music

Weapons

Zombies

Environment

UI

Boss

Ambience

```



Dynamic music should increase intensity during high-pressure moments.



Use audio cues for:



\* Low health

\* Wave start

\* Elite spawn

\* Boss spawn

\* Mutation

\* Reload

\* Empty magazine



Audio should communicate danger before the player visually sees it.



\---



\# 24. Phase 17 — Visual Effects



Implement:



\* Muzzle flash

\* Bullet impact

\* Blood impact

\* Zombie death VFX

\* Screen damage flash

\* Low-health effect

\* Signal interference

\* Explosion effect

\* Boss effects

\* Dynamic lighting effects



Visual effects must be pooled where possible.



Avoid creating and destroying large numbers of objects every frame.



\---



\# 25. Phase 18 — Performance Optimization



Performance is a first-class requirement.



Implement:



\### Object pooling



For:



\* Zombies

\* Bullets / effects

\* Blood VFX

\* Hit effects

\* Projectiles



\### Rendering optimization



\* Frustum culling

\* Reusable materials

\* Texture reuse

\* Limited real-time lights

\* Efficient shadows

\* LOD where appropriate



\### AI optimization



Do not execute expensive pathfinding or decision logic every frame for every enemy.



Use update intervals and proximity-based AI activation.



\### Target



Aim for approximately:



```text

60 FPS target

30 FPS minimum acceptable on weaker supported hardware

```



Performance should be tested with high enemy counts.



\---



\# 26. Phase 19 — Save System



Use browser local storage initially.



Persist:



\* Settings

\* Sensitivity

\* Audio volume

\* Graphics settings

\* Best wave

\* Unlocks

\* Progression

\* Statistics



Save data must be versioned.



Example:



```ts

saveVersion: 1

```



Future schema migrations must be possible.



\---



\# 27. Phase 20 — Testing



Testing must happen continuously rather than only at the end.



\## Unit Tests



Test:



\* Damage calculations

\* Wave generation

\* Difficulty scaling

\* Upgrade generation

\* Mutation selection

\* Economy calculations

\* State transitions

\* Save/load



\## Integration Tests



Test:



\* Shooting a zombie

\* Killing an enemy

\* Completing a wave

\* Selecting an upgrade

\* Starting the next wave

\* Boss spawning

\* Game over

\* Restart



\## Manual QA



Verify:



\* Mouse capture

\* Reloading

\* Movement

\* Collision

\* UI scaling

\* Audio

\* Performance

\* Browser compatibility



\---



\# 28. Phase 21 — Anti-Bug / Stability Layer



Add defensive programming.



The game must gracefully handle:



\* Missing assets

\* Failed audio

\* Invalid save data

\* Window resizing

\* Tab switching

\* Unexpected state changes

\* Rapid input

\* Spam reload

\* Death during wave transition

\* Boss death during special event

\* Restart while paused



No uncaught runtime errors should remain in production builds.



\---



\# 29. Debug Tools



Create a developer-only debug system.



Commands:



```text

giveAmmo()

healPlayer()

killAll()

spawnEnemy(type)

startWave(number)

triggerMutation(type)

spawnBoss(type)

setGodMode()

setInfiniteAmmo()

teleportPlayer()

```



Debug UI should be disabled in production builds.



\---



\# 30. Analytics / Telemetry Hooks



Create an abstract analytics interface without locking the project to a provider.



Track optional events such as:



```text

game\_started

wave\_started

wave\_completed

player\_died

boss\_spawned

boss\_killed

upgrade\_selected

mutation\_triggered

game\_completed

```



Do not collect unnecessary personal data.



\---



\# 31. Content Data Architecture



All tunable gameplay values should be centralized.



For example:



```text

config/

├── weapons.ts

├── enemies.ts

├── waves.ts

├── mutations.ts

├── upgrades.ts

└── bosses.ts

```



Changing:



```ts

zombie.walker.speed

```



must not require editing AI logic.



This is critical for balancing.



\---



\# 32. Balancing Strategy



Do not attempt to balance the entire game from assumptions.



Use a three-pass process.



\### Pass 1 — Functional



Everything works.



Balance can be ugly.



\### Pass 2 — Playability



Adjust:



\* Enemy count

\* Spawn pacing

\* Ammo economy

\* Damage

\* Health

\* Upgrade strength



\### Pass 3 — Polish



Optimize:



\* Difficulty curve

\* Build diversity

\* Mutation frequency

\* Boss difficulty

\* Run length

\* Reward pacing



\---



\# 33. Recommended First Play Session



Target experience:



```text

0:00–2:00

Learn controls



2:00–5:00

First meaningful wave pressure



5:00–10:00

First build choices



10:00–15:00

Mutation system becomes noticeable



15:00–20:00

Adaptive enemy behavior becomes apparent



20:00+

Player has a recognizable build



Major milestone

Boss encounter

```



The player should understand the unique mechanics before the game becomes extremely difficult.



\---



\# 34. Development Milestones



\## Milestone 1 — Playable Prototype



Contains:



\* FPS movement

\* One weapon

\* One zombie

\* Basic wave system



Definition of Done:



> Player can enter a map, shoot zombies, survive waves, and die.



\---



\## Milestone 2 — Core Game



Contains:



\* Multiple weapons

\* Multiple zombies

\* Health

\* Ammo

\* Reload

\* Wave scaling

\* Basic UI



Definition of Done:



> The game is genuinely playable for 15–20 minutes.



\---



\## Milestone 3 — Signature Mechanics



Contains:



\* Signal mutations

\* Adaptive zombie system

\* Progression

\* Upgrades

\* Dynamic environment



Definition of Done:



> Two runs can meaningfully feel different.



\---



\## Milestone 4 — Content



Contains:



\* Bosses

\* More enemy variants

\* More mutations

\* More upgrades

\* Better map design



Definition of Done:



> The game has a complete gameplay loop and meaningful progression.



\---



\## Milestone 5 — Polish



Contains:



\* Audio

\* VFX

\* Lighting

\* UI polish

\* Performance optimization

\* Bug fixing



Definition of Done:



> The game feels like a finished indie browser game rather than a prototype.



\---



\# 35. Claude Code Workflow



Claude Code must NOT attempt to implement the whole project in one pass.



It should operate using the following loop:



```text

READ

&#x20;↓

PLAN

&#x20;↓

IMPLEMENT

&#x20;↓

TEST

&#x20;↓

RUN

&#x20;↓

INSPECT

&#x20;↓

FIX

&#x20;↓

DOCUMENT

&#x20;↓

COMMIT

&#x20;↓

NEXT PHASE

```



Before modifying a system:



1\. Read the relevant architecture files.

2\. Identify dependencies.

3\. Understand current implementation.

4\. Implement the smallest safe change.

5\. Run tests.

6\. Run the game.

7\. Verify behavior.

8\. Update documentation.

9\. Only then move to the next task.



Claude must never rewrite large portions of working code unnecessarily.



\---



\# 36. Required Project Documentation



Maintain:



```text

README.md

IMPLEMENTATION\_PLAN.md

ARCHITECTURE.md

GAME\_DESIGN.md

PROGRESS.md

DECISIONS.md

BALANCING.md

TESTING.md

```



\### PROGRESS.md



Must always contain:



```text

Current Phase

Completed Tasks

Active Task

Known Bugs

Next Task

Blocked Tasks

```



This allows future Claude Code sessions to continue the project safely.



\---



\# 37. Git Strategy



Use small meaningful commits.



Example:



```text

feat: add fps controller

feat: add weapon framework

feat: add zombie ai

feat: add wave manager

feat: add mutation system

feat: add adaptive enemy system

fix: prevent zombie spawn overlap

perf: optimize enemy updates

```



Never commit intentionally broken code to the main branch.



\---



\# 38. Definition of Done



The project is considered complete when:



\### Gameplay



\* Player can complete a full run

\* Waves scale correctly

\* Weapons feel distinct

\* Zombies behave predictably but dynamically

\* Mutations work

\* Adaptive system works

\* Upgrades work

\* Boss encounters work

\* Game over and victory work



\### Technical



\* No production console errors

\* No major memory leaks

\* No critical gameplay exploits

\* Save system works

\* Settings persist

\* Build works

\* Deployment works



\### Performance



\* Stable frame rate under normal gameplay

\* Acceptable performance with large zombie counts

\* Effects do not cause major frame drops

\* Loading remains reasonable



\### UX



\* Controls are understandable

\* HUD communicates essential information

\* Menus work

\* Restarting a run is quick

\* Player always understands why they died



\---



\# 39. Scope Control Rules



The following rules are mandatory.



\### Rule 1



Do not add a feature merely because it sounds cool.



\### Rule 2



Every new system must have a clear gameplay purpose.



\### Rule 3



Do not introduce multiplayer until the single-player game is complete.



\### Rule 4



Do not add a second map until the first map has a complete gameplay loop.



\### Rule 5



Prefer reusable systems over one-off implementations.



\### Rule 6



Performance regressions must be fixed before adding major new content.



\### Rule 7



Do not replace working architecture without a measurable reason.



\---



\# 40. Final Product Loop



The final experience should feel like:



```text

START RUN

&#x20;  ↓

EXPLORE

&#x20;  ↓

SURVIVE WAVE

&#x20;  ↓

KILL ZOMBIES

&#x20;  ↓

EARN XP + SCRAP

&#x20;  ↓

CHOOSE UPGRADE

&#x20;  ↓

SIGNAL MUTATION

&#x20;  ↓

WORLD CHANGES

&#x20;  ↓

ENEMIES ADAPT

&#x20;  ↓

SURVIVE

&#x20;  ↓

BOSS

&#x20;  ↓

RESTORE SIGNAL

&#x20;  ↓

ENDGAME

```



The key design principle is:



> \*\*The player should never feel that the next wave is simply "more zombies."\*\*



The next wave should introduce a new tactical problem.



\---



\# 41. Priority Order



When trade-offs are necessary, prioritize:



```text

1\. Gameplay feel

2\. Stability

3\. Performance

4\. Core systems

5\. Content variety

6\. Visual polish

7\. Extra features

```



A small game that feels great is preferable to a huge game full of broken systems.



\---



\# 42. Initial Build Target



The first playable version should intentionally be small:



\### Map



1 compact industrial / communications facility



\### Weapons



3



\### Zombies



4



\### Mutations



6



\### Upgrades



12+



\### Bosses



1



\### Wave Target



20



\### Endings



1 initially, expandable later



Once this version is stable and fun, expand content without redesigning the core architecture.



\---



\## Final Development Objective



Build a polished browser FPS that combines:



\*\*Fast FPS combat + roguelite progression + wave survival + adaptive enemies + dynamic world events.\*\*



The signature feature is the interaction between:



```text

PLAYER BEHAVIOR

&#x20;       +

SIGNAL MUTATIONS

&#x20;       +

ENEMY ADAPTATION

&#x20;       =

DIFFERENT RUNS

```



The player should finish a run thinking:



> "The game actually reacted to the way I played."



