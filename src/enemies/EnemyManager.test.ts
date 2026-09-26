import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { ENEMY_RULES, ENEMY_STATS } from '../config/enemies';
import { FACILITY } from '../world/levels/facility';
import { PickupManager } from '../world/PickupManager';
import { World } from '../world/World';
import { DT, enemyTestWorld, TestTarget } from './testWorld';
import { TrainingEncounter } from './TrainingEncounter';

const W = ENEMY_STATS.walker;

describe('EnemyManager: spawning and combat registration', () => {
  it('registers each enemy with combat under a unique id, with its hit volumes on its body', () => {
    const t = enemyTestWorld({ targets: [new TestTarget(25, 25)] });
    const a = t.manager.spawn('walker', [2, 0, 3], { yaw: 1 });
    const b = t.manager.spawn('walker', [-4, 0, 1]);
    expect([a?.id, b?.id]).toEqual(['walker-1', 'walker-2']);
    const target = t.combat.get('walker-1');
    expect(target?.health.max).toBe(W.health);
    expect(target?.staggerThreshold).toBe(W.staggerThreshold);
    expect(target?.rig.position.toArray()).toEqual([2, 0, 3]);
    expect(target?.rig.yaw).toBe(1);
    expect(t.of('spawned').map((s) => s.id)).toEqual(['walker-1', 'walker-2']);
    // A bullet at its head from the front is a headshot.
    const hit = t.hitscan.cast(new Vector3(2, 1.63, 8), new Vector3(0, 0, -1), 20);
    expect(hit).toMatchObject({ kind: 'target', targetId: 'walker-1', zone: 'HEAD' });
  });

  it('its hit volumes follow it as it moves', () => {
    const t = enemyTestWorld({ targets: [new TestTarget(0, 10)] });
    const walker = t.manager.spawn('walker', [0, 0, 0], { patrol: false });
    t.seconds(4);
    expect(walker?.motor.position.z).toBeGreaterThan(2);
    expect(t.combat.get('walker-1')?.rig.position.toArray()).toEqual(
      walker?.motor.position.toArray(),
    );
  });

  it('refuses to spawn beyond the living-enemy cap', () => {
    const t = enemyTestWorld({ rules: { maxAlive: 2 } });
    expect(t.manager.spawn('walker', [0, 0, 0])).not.toBeNull();
    expect(t.manager.spawn('walker', [3, 0, 0])).not.toBeNull();
    expect(t.manager.spawn('walker', [6, 0, 0])).toBeNull();
    expect(t.manager.aliveCount).toBe(2);
  });

  it('only implemented archetypes can be spawned', () => {
    const t = enemyTestWorld();
    expect(() => t.manager.spawn('runner', [0, 0, 0])).toThrow(/no definition yet/);
  });

  it('canStand: room for the body and ground under the feet (spawn validation)', () => {
    const t = enemyTestWorld({ level: FACILITY, world: new World(FACILITY).collision });
    const rays = t.manager.lines.rays;
    expect(t.manager.canStand('walker', [0, 0, 8])).toBe(true); // open yard
    expect(t.manager.canStand('walker', new Vector3(-22.25, 2.5, 1))).toBe(true); // catwalk
    expect(t.manager.canStand('walker', [0.65, 0, 0.6])).toBe(false); // inside the signal tower
    expect(t.manager.canStand('walker', [3.6, 0, 4.6])).toBe(false); // inside a crate
    expect(t.manager.canStand('walker', [-18.5, 2.5, 1])).toBe(false); // in the air by the catwalk
    expect(t.manager.canStand('walker', [0, 0, 30])).toBe(false); // outside the level
    expect(t.manager.lines.rays - rays).toBe(4); // one ground ray per body that fits
    expect(t.manager.enemies).toHaveLength(0); // a query only
  });
});

describe('EnemyManager: death and cleanup', () => {
  it('dies through combat: DEAD once, not hittable, removed exactly once after its corpse time', () => {
    const t = enemyTestWorld({ targets: [new TestTarget(25, 25)] });
    const walker = t.manager.spawn('walker', [0, 0, 0], { patrol: false });
    // Two headshots (65 + 65 ≥ 120).
    const headshot = () =>
      t.combat.applyHit({
        targetId: 'walker-1',
        zone: 'HEAD',
        weaponId: 'pistol',
        source: 'shot',
        quick: false,
        baseDamage: 26,
        falloff: 1,
        headshotMultiplier: 2.5,
        point: [0, 1.6, 0],
        direction: [0, 0, -1],
        distance: 5,
      });
    expect(headshot()?.killed).toBe(false);
    expect(headshot()?.killed).toBe(true);
    expect(walker?.state).toBe('DEAD');
    expect(t.of('died')).toEqual([{ id: 'walker-1', archetype: 'walker', position: [0, 0, 0] }]);
    // Dead: further hits are ignored, and shots pass through the body.
    expect(headshot()).toBeNull();
    expect(t.hitscan.cast(new Vector3(0, 1.63, 5), new Vector3(0, 0, -1), 20)?.kind).not.toBe(
      'target',
    );
    // The body stays for its corpse time, still registered, then is removed once.
    t.step(Math.round(W.corpseTime / DT) - 1);
    expect(t.combat.get('walker-1')).toBeDefined();
    expect(t.of('despawned')).toEqual([]);
    t.step(1);
    expect(t.combat.get('walker-1')).toBeUndefined();
    expect(t.manager.get('walker-1')).toBeUndefined();
    t.seconds(2);
    expect(t.of('despawned')).toEqual([{ id: 'walker-1' }]);
    expect(t.of('died')).toHaveLength(1);
  });

  it('despawning twice cleans up once; a despawned id stays gone', () => {
    const t = enemyTestWorld();
    t.manager.spawn('walker', [0, 0, 0]);
    expect(t.manager.despawn('walker-1')).toBe(true);
    expect(t.manager.despawn('walker-1')).toBe(false);
    expect(t.of('despawned')).toHaveLength(1);
    expect(t.combat.targets).toEqual([]);
    expect(t.manager.stats.despawned).toBe(1);
  });

  it('an enemy that falls out of the level is removed (once), not left falling', () => {
    const t = enemyTestWorld({ targets: [new TestTarget(25, 25)] });
    const walker = t.manager.spawn('walker', [45, 0, 0], { patrol: false }); // past the floor
    t.seconds(5);
    expect(t.of('despawned')).toEqual([{ id: 'walker-1' }]);
    expect(t.manager.get('walker-1')).toBeUndefined();
    expect(t.combat.get('walker-1')).toBeUndefined();
    expect(walker?.despawned).toBe(true);
  });

  it('reuses pooled instances with fresh state and a new id', () => {
    const t = enemyTestWorld({ targets: [new TestTarget(0, 5)] });
    const first = t.manager.spawn('walker', [0, 0, 0], { patrol: false });
    t.seconds(3); // chasing, with a target and timers
    t.manager.kill('walker-1');
    t.seconds(W.corpseTime + 0.1);
    const second = t.manager.spawn('walker', [5, 0, 5], { patrol: false });
    expect(second).toBe(first); // the same object, reused
    expect(second?.id).toBe('walker-2');
    expect(second?.state).toBe('IDLE');
    expect(second?.health.current).toBe(W.health);
    expect(second?.target).toBeNull();
    expect(second?.attackPhase).toBe('none');
    expect(second?.motor.position.toArray()).toEqual([5, 0, 5]);
  });

  it('clear removes everyone and restarts ids (a new run)', () => {
    const t = enemyTestWorld();
    t.manager.spawn('walker', [0, 0, 0]);
    t.manager.spawn('walker', [3, 0, 0]);
    t.manager.clear();
    expect(t.manager.enemies).toEqual([]);
    expect(t.combat.targets).toEqual([]);
    expect(t.manager.spawn('walker', [0, 0, 0])?.id).toBe('walker-1');
  });

  it('a death can drop pickups from its drop table', () => {
    const pickups = new PickupManager({ collector: () => null, collect: () => false });
    const t = enemyTestWorld({ pickups, seed: 'drops' });
    let drops = 0;
    for (let i = 0; i < 40; i++) {
      t.manager.spawn('walker', [0, 0, 0], { patrol: false });
      t.manager.kill(`walker-${i + 1}`);
      drops = pickups.active.length;
      t.manager.despawn(`walker-${i + 1}`);
    }
    // 20 % chance: some, not all.
    expect(drops).toBeGreaterThan(0);
    expect(drops).toBeLessThan(40);
  });
});

describe('EnemyManager: control', () => {
  it('does nothing while inactive (outside a run) or frozen (debug)', () => {
    const t = enemyTestWorld({ targets: [new TestTarget(0, 5)] });
    const walker = t.manager.spawn('walker', [0, 0, 0], { patrol: false });
    t.setActive(false);
    t.seconds(3);
    expect(walker?.state).toBe('IDLE');
    expect(t.manager.stats.thinks).toBe(0);
    t.setActive(true);
    t.manager.frozen = true;
    t.seconds(3);
    expect(walker?.motor.position.toArray()).toEqual([0, 0, 0]);
    t.manager.frozen = false;
    t.seconds(2);
    expect(walker?.state).not.toBe('IDLE');
  });

  it('forceState goes through the game’s own paths, and refuses illegal moves', () => {
    const t = enemyTestWorld({ targets: [new TestTarget(25, 25)] });
    const walker = t.manager.spawn('walker', [0, 0, 0], { patrol: false });
    expect(t.manager.forceState('walker-1', 'ATTACK')).toBe(false); // IDLE → ATTACK is illegal
    expect(t.manager.forceState('walker-1', 'STAGGER')).toBe(true);
    expect(t.of('staggered')).toEqual([{ id: 'walker-1' }]);
    expect(t.manager.forceState('walker-1', 'DEAD')).toBe(true);
    expect(walker?.state).toBe('DEAD');
    expect(t.of('died')).toHaveLength(1);
    expect(t.manager.forceState('walker-1', 'IDLE')).toBe(false);
    expect(t.manager.forceState('nobody', 'IDLE')).toBe(false);
  });

  it('can be alerted to a target (spawned knowing where the player is)', () => {
    const target = new TestTarget(0, 25);
    const t = enemyTestWorld({ targets: [target] });
    const walker = t.manager.spawn('walker', [0, 0, 0], { alertTo: target, patrol: false });
    expect(walker?.state).toBe('DETECT');
    // Alerting again changes nothing: it already has that target.
    expect(t.manager.alert('walker-1', target)).toBe(true);
    expect(t.of('targetAcquired')).toHaveLength(1);
    expect(t.manager.alert('nobody', target)).toBe(false);
  });
});

describe('TrainingEncounter', () => {
  it('places its enemies on reset and brings each back after its body is removed', () => {
    const t = enemyTestWorld({ targets: [new TestTarget(25, 25)] });
    const encounter = new TrainingEncounter({
      enemies: t.manager,
      active: () => true,
      placements: [
        { archetype: 'walker', position: [0, 0, 0], yaw: 0, patrol: false },
        { archetype: 'walker', position: [5, 0, 0], yaw: 0, patrol: true },
      ],
      respawnDelay: 2,
    });
    encounter.reset();
    expect(encounter.placed).toEqual(['walker-1', 'walker-2']);
    expect(t.manager.get('walker-2')?.patrols).toBe(true);
    expect(t.manager.get('walker-1')?.patrols).toBe(false);
    t.manager.kill('walker-1');
    const run = (seconds: number) => {
      for (let i = 0; i < Math.round(seconds / DT); i++) {
        t.step();
        encounter.fixedUpdate(DT);
      }
    };
    run(W.corpseTime + 0.05); // the body is removed…
    expect(encounter.placed).toEqual([null, 'walker-2']);
    run(1.8); // …and nothing comes back before the respawn delay (2 s)…
    expect(encounter.placed).toEqual([null, 'walker-2']);
    run(0.3); // …then it does, where it was placed.
    expect(encounter.placed).toEqual(['walker-3', 'walker-2']);
    expect(t.manager.get('walker-3')?.motor.position.toArray()).toEqual([0, 0, 0]);
  });

  it('the configured encounter keeps its enemies away from the spawn point', () => {
    const t = enemyTestWorld();
    const encounter = new TrainingEncounter({ enemies: t.manager, active: () => true });
    encounter.reset();
    for (const enemy of t.manager.enemies) {
      const p = enemy.motor.position;
      // Beyond detection range (plus patrol radius when patrolling) of the spawn (0, 0, 14).
      const reach = W.detectionRange + (enemy.patrols ? W.patrol.radius : 0);
      expect(Math.hypot(p.x, p.z - 14), enemy.id).toBeGreaterThan(reach);
    }
    expect(ENEMY_RULES.maxAlive).toBeGreaterThanOrEqual(t.manager.enemies.length);
  });
});
