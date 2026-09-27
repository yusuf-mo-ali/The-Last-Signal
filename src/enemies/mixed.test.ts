/**
 * Several archetypes at once (D-043): one manager, one combat system, one navigation; each enemy
 * keeps its own data and state. In the Phase 1 facility, as the game runs it.
 */

import type { Vector3 } from 'three';
import { Capsule } from 'three/addons/math/Capsule.js';
import { describe, expect, it } from 'vitest';
import type { HitInput } from '../combat/CombatSystem';
import {
  DEFAULT_ROSTER,
  ENEMY_STATS,
  type DamageZone,
  type EnemyArchetypeId,
} from '../config/enemies';
import { FACILITY } from '../world/levels/facility';
import { World } from '../world/World';
import type { Enemy } from './Enemy';
import { enemyTestWorld, TestTarget } from './testWorld';

const facility = new World(FACILITY);
const capsule = new Capsule();

function penetration(enemy: Enemy): number {
  const feet: Vector3 = enemy.motor.position;
  const { radius, height } = enemy.config.body;
  capsule.radius = radius;
  capsule.start.set(feet.x, feet.y + radius, feet.z);
  capsule.end.set(feet.x, feet.y + height - radius, feet.z);
  return facility.collision.capsuleContacts(capsule)[0]?.depth ?? 0;
}

function pistolHit(t: ReturnType<typeof enemyTestWorld>, id: string, zone: DamageZone) {
  const hit: HitInput = {
    targetId: id,
    zone,
    weaponId: 'pistol',
    source: 'shot',
    quick: false,
    baseDamage: 26,
    falloff: 1,
    headshotMultiplier: 2.5,
    point: [0, 1, 0],
    direction: [0, 0, -1],
    distance: 8,
  };
  return t.combat.applyHit(hit);
}

/** The default roster in a loose group in the yard, alerted to a tough target by the tower. */
function mixedYard(count: number) {
  const target = new TestTarget(0, -3);
  target.health = 100_000;
  const t = enemyTestWorld({ targets: [target], world: facility.collision, level: FACILITY });
  const enemies: Enemy[] = [];
  for (let i = 0; i < count; i++) {
    const archetype = DEFAULT_ROSTER[i % DEFAULT_ROSTER.length] as EnemyArchetypeId;
    const at: [number, number, number] = [-9 + (i % 6) * 1.6, 0, 8 + Math.floor(i / 6) * 1.6];
    expect(t.manager.canStand(archetype, at), `${archetype} at ${at.join(',')}`).toBe(true);
    const enemy = t.manager.spawn(archetype, at, { patrol: false, alertTo: target });
    if (enemy) {
      enemies.push(enemy);
    }
  }
  return { t, target, enemies };
}

describe('a mixed group', () => {
  it('every archetype chases through the same navigation, stays out of the walls, and apart', () => {
    const { t, target, enemies } = mixedYard(12);
    let worstPenetration = 0;
    // Separation is a push, not a wall: a sprinting Runner may brush through a body, but no two
    // enemies stay on top of each other (closer than the smaller body's radius) for long.
    const stacked = new Map<string, number>();
    let longestStack = 0;
    for (let s = 0; s < 20 * 60; s++) {
      t.step();
      if (s % 30 === 0) {
        for (const enemy of enemies) {
          worstPenetration = Math.max(worstPenetration, penetration(enemy));
        }
      }
      for (let i = 0; i < enemies.length; i++) {
        for (let j = i + 1; j < enemies.length; j++) {
          const a = enemies[i];
          const b = enemies[j];
          if (a && b) {
            const d = Math.hypot(
              a.motor.position.x - b.motor.position.x,
              a.motor.position.z - b.motor.position.z,
            );
            const key = `${a.id}/${b.id}`;
            const run =
              d < Math.min(a.config.body.radius, b.config.body.radius)
                ? (stacked.get(key) ?? 0) + 1
                : 0;
            stacked.set(key, run);
            longestStack = Math.max(longestStack, run);
          }
        }
      }
    }
    expect(longestStack).toBeLessThanOrEqual(12); // 0.2 s
    expect(worstPenetration).toBeLessThan(0.05);
    for (const enemy of enemies) {
      expect(enemy.target?.id, enemy.id).toBe('player');
      expect(enemy.motor.position.y).toBeGreaterThan(-0.5);
    }
    // Everyone that fights in melee got its hits in; the Screamers screamed and never hit.
    const hitters = new Set(t.of('attackHit').map((h) => h.id));
    for (const enemy of enemies) {
      if (enemy.config.behavior === 'melee') {
        expect(hitters.has(enemy.id), enemy.id).toBe(true);
      } else {
        expect(hitters.has(enemy.id), enemy.id).toBe(false);
      }
    }
    expect(t.of('alarm').length).toBeGreaterThan(0);
    expect(target.hits.length).toBe(t.of('attackHit').length);
  });

  it('the Runners arrive first and the Tanks last', () => {
    const { t, enemies } = mixedYard(8);
    const firstStrike = new Map<string, number>();
    let step = 0;
    t.manager.events.on('attackStarted', (e) => {
      if (!firstStrike.has(e.id)) {
        firstStrike.set(e.id, step);
      }
    });
    for (; step < 40 * 60; step++) {
      t.step();
    }
    const by = (archetype: EnemyArchetypeId) =>
      enemies.filter((e) => e.archetype.id === archetype).map((e) => firstStrike.get(e.id) ?? 1e9);
    const runner = Math.max(...by('runner'));
    const walker = Math.min(...by('walker'));
    const tank = Math.min(...by('tank'));
    expect(runner).toBeLessThan(walker);
    expect(walker).toBeLessThan(tank);
    expect(tank).toBeLessThan(1e9);
  });

  it('hits land only on the enemy hit, with that enemy’s own damage profile', () => {
    const { t, enemies } = mixedYard(4);
    t.manager.frozen = true;
    const results = enemies.map((e) => [e.id, pistolHit(t, e.id, 'TORSO')?.amount]);
    expect(results).toEqual([
      ['walker-1', 26],
      ['runner-2', 26],
      ['tank-3', 13],
      ['screamer-4', 26],
    ]);
    const health = enemies.map((e) => e.health.current);
    expect(health).toEqual([
      ENEMY_STATS.walker.health - 26,
      ENEMY_STATS.runner.health - 26,
      ENEMY_STATS.tank.health - 13,
      ENEMY_STATS.screamer.health - 26,
    ]);
    // Staggered by the same hit: all but the Tank (head only).
    expect(enemies.map((e) => e.state === 'STAGGER')).toEqual([false, true, false, true]);
  });

  it('no state leaks between enemies: traits, plates and haste stay on their own enemy', () => {
    const { t, enemies } = mixedYard(4);
    t.manager.frozen = true;
    const [walker, runner, tank, screamer] = enemies;
    t.manager.setTraits(walker!.id, ['helmeted']); // eslint-disable-line @typescript-eslint/no-non-null-assertion
    t.manager.setTraits(tank!.id, ['helmeted', 'elite']); // eslint-disable-line @typescript-eslint/no-non-null-assertion
    pistolHit(t, walker!.id, 'HEAD'); // eslint-disable-line @typescript-eslint/no-non-null-assertion
    expect(walker?.plates[0]?.broken).toBe(true);
    expect(tank?.plates[0]?.broken).toBe(false); // its own helmet
    expect(runner?.plates).toEqual([]);
    expect(screamer?.config.traits).toEqual([]);
    expect(runner?.config.traits).toEqual([]);
    expect(tank?.health.max).toBeCloseTo(ENEMY_STATS.tank.health * 1.6, 9);
    expect(runner?.health.max).toBe(ENEMY_STATS.runner.health);
    // Configs are separate objects from the shared archetype definitions.
    expect(ENEMY_STATS.tank.health).toBe(360);
    expect(tank?.archetype).toBe(ENEMY_STATS.tank);
  });

  it.each([
    ['walker', 0.05],
    ['walker', 0.25],
    ['screamer', 0.05],
    ['tank', 0.1],
  ] as const)(
    'a sprinting Runner meeting a %s head-on (%s m off its line) steers round it, not through it',
    (kind, offset) => {
      const ahead = new TestTarget(0, 20, 'ahead');
      const behind = new TestTarget(0, -8, 'behind');
      ahead.health = behind.health = 1e9;
      const t = enemyTestWorld({ targets: [ahead, behind] });
      const runner = t.manager.spawn('runner', [0, 0, 0], { patrol: false });
      const other = t.manager.spawn(kind, [offset, 0, 12], { patrol: false });
      if (!runner || !other) {
        throw new Error('no spawn');
      }
      t.manager.alert(runner.id, ahead);
      t.manager.alert(other.id, behind);
      let closest = Number.POSITIVE_INFINITY;
      for (let i = 0; i < 4 * 60; i++) {
        t.step();
        const a = runner.motor.position;
        const b = other.motor.position;
        closest = Math.min(closest, Math.hypot(a.x - b.x, a.z - b.z));
      }
      expect(closest).toBeGreaterThan(runner.config.body.radius + other.config.body.radius);
    },
  );

  it('big bodies keep their room: two Tanks side by side move apart to both radii plus a margin', () => {
    const t = enemyTestWorld({ targets: [new TestTarget(25, 25)] });
    const a = t.manager.spawn('tank', [0, 0, 0], { patrol: false });
    const b = t.manager.spawn('tank', [0.9, 0, 0], { patrol: false });
    t.seconds(3);
    const d = a && b ? a.motor.position.distanceTo(b.motor.position) : 0;
    expect(d).toBeGreaterThanOrEqual(ENEMY_STATS.tank.body.radius * 2 + 0.09);
  });

  it('pools are per archetype: a freed Runner is never reused as a Tank', () => {
    const t = enemyTestWorld({ targets: [new TestTarget(25, 25)] });
    const runner = t.manager.spawn('runner', [0, 0, 0], { patrol: false });
    t.manager.kill('runner-1');
    t.manager.despawn('runner-1');
    const tank = t.manager.spawn('tank', [0, 0, 0], { patrol: false });
    expect(tank).not.toBe(runner);
    expect(tank?.archetype.id).toBe('tank');
    expect(tank?.config.body).toBe(ENEMY_STATS.tank.body);
    const runnerAgain = t.manager.spawn('runner', [3, 0, 0], { patrol: false });
    expect(runnerAgain).toBe(runner);
  });

  it('is deterministic: the same group gives the same outcome', () => {
    const run = () => {
      const { t, target } = mixedYard(8);
      t.seconds(12);
      return {
        positions: t.manager.enemies.map((e) =>
          e.motor.position.toArray().map((v) => +v.toFixed(9)),
        ),
        hits: target.hits.length,
        alarms: t.of('alarm').length,
      };
    };
    expect(run()).toEqual(run());
  });
});
