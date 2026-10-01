/**
 * Traits on living enemies (D-043): spawned with them or changed at run time, on any archetype,
 * through the same stats, combat profile, drops and pool as everything else.
 */

import { describe, expect, it } from 'vitest';
import type { HitInput } from '../combat/CombatSystem';
import type { DamageZone } from '../config/enemies';
import { ENEMY_STATS } from '../config/enemies';
import { PickupManager } from '../world/PickupManager';
import { DT, enemyTestWorld, TestTarget } from './testWorld';

const W = ENEMY_STATS.walker;
const steps = (seconds: number) => Math.round(seconds / DT);

type World = ReturnType<typeof enemyTestWorld>;

function pistolHit(t: World, id: string, zone: DamageZone) {
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

function far() {
  return enemyTestWorld({ targets: [new TestTarget(25, 25)] });
}

describe('traits at spawn', () => {
  it('an Armored Walker: the body soaks armor, the head does not', () => {
    const t = far();
    const walker = t.manager.spawn('walker', [0, 0, 0], { patrol: false, traits: ['armored'] });
    expect(walker?.config.traits).toEqual(['armored']);
    expect(t.combat.get('walker-1')?.zoneArmor).toEqual(walker?.config.zoneArmor);
    expect(pistolHit(t, 'walker-1', 'TORSO')).toMatchObject({ amount: 16, armorReduction: 10 });
    expect(pistolHit(t, 'walker-1', 'ARM_LEFT')?.amount).toBeCloseTo(16.9 - 6, 9);
    expect(pistolHit(t, 'walker-1', 'HEAD')).toMatchObject({ amount: 65, armorReduction: 0 });
  });

  it('a Helmeted Walker: the first headshot knocks the helmet off and staggers it', () => {
    const t = far();
    const walker = t.manager.spawn('walker', [0, 0, 0], { patrol: false, traits: ['helmeted'] });
    const broken: string[] = [];
    t.combat.events.on('armorBroken', (e) => broken.push(`${e.targetId}:${e.plateId}`));
    expect(walker?.plates.map((p) => [p.id, p.durability])).toEqual([['helmet', 50]]);
    expect(pistolHit(t, 'walker-1', 'HEAD')).toMatchObject({ amount: 15, absorbed: 50 });
    expect(broken).toEqual(['walker-1:helmet']);
    expect(walker?.plates[0]?.broken).toBe(true);
    expect(walker?.state).toBe('STAGGER'); // 15 alone would not stagger it
    expect(walker?.target?.id).toBe('player'); // and it knows who did it
    t.seconds(W.staggerDuration + 0.1);
    expect(pistolHit(t, 'walker-1', 'HEAD')).toMatchObject({ amount: 65, absorbed: 0 });
    expect(walker?.health.current).toBe(W.health - 15 - 65);
  });

  it('an Elite Walker: more health, faster, harder hits, harder to stagger', () => {
    const tough = new TestTarget(0, 10);
    tough.health = 1000;
    const t = enemyTestWorld({ targets: [tough] });
    const elite = t.manager.spawn('walker', [0, 0, 0], { patrol: false, traits: ['elite'] });
    expect(elite?.health.max).toBeCloseTo(W.health * 1.6, 9);
    expect(t.combat.get('walker-1')?.staggerThreshold).toBeCloseTo(W.staggerThreshold * 1.5, 9);
    // A hit that would stagger a Walker (35) does not stagger an Elite one (52.5).
    t.combat.applyDamage('walker-1', { amount: 40 });
    expect(elite?.state).not.toBe('STAGGER');
    t.runUntil(() => t.of('attackHit').length > 0, 20);
    expect(tough.hits[0]?.amount).toBeCloseTo(W.attackDamage * 1.3, 9);
  });

  it('an Elite drops its bonus on top of its archetype’s table', () => {
    const options = { collector: () => null, collect: () => false, maxActive: 100 };
    const plain = new PickupManager(options);
    const bonus = new PickupManager(options);
    const count = (pickups: PickupManager, traits: string[]) => {
      const t = enemyTestWorld({ pickups, seed: 'drops', targets: [new TestTarget(25, 25)] });
      let drops = 0;
      for (let i = 1; i <= 20; i++) {
        t.manager.spawn('walker', [0, 0, 0], { patrol: false, traits });
        t.manager.kill(`walker-${i}`);
        drops = pickups.active.length;
        t.manager.despawn(`walker-${i}`);
      }
      return drops;
    };
    const plainDrops = count(plain, []);
    const eliteDrops = count(bonus, ['elite']);
    expect(plainDrops).toBeLessThan(20);
    expect(eliteDrops).toBeGreaterThanOrEqual(20); // the elite table always drops
  });

  it('unknown traits are refused', () => {
    const t = far();
    expect(() => t.manager.spawn('walker', [0, 0, 0], { traits: ['cursed'] })).toThrow(
      /Unknown trait/,
    );
  });

  it('any archetype can carry any trait (no archetype-specific code)', () => {
    const t = far();
    const tank = t.manager.spawn('tank', [0, 0, 0], { patrol: false, traits: ['armored'] });
    const screamer = t.manager.spawn('screamer', [4, 0, 0], {
      patrol: false,
      traits: ['helmeted'],
    });
    const runner = t.manager.spawn('runner', [-4, 0, 0], { patrol: false, traits: ['elite'] });
    // Tank torso: 26 × 0.5 = 13, then 10 armor.
    expect(pistolHit(t, tank!.id, 'TORSO')?.amount).toBe(3); // eslint-disable-line @typescript-eslint/no-non-null-assertion
    expect(pistolHit(t, screamer!.id, 'HEAD')?.absorbed).toBe(50); // eslint-disable-line @typescript-eslint/no-non-null-assertion
    expect(runner?.config.moveSpeed).toBeCloseTo(ENEMY_STATS.runner.moveSpeed * 1.1, 9);
    expect(runner?.health.max).toBeCloseTo(ENEMY_STATS.runner.health * 1.6, 9);
  });
});

describe('traits at run time', () => {
  it('adding and removing keeps the health fraction and updates combat at once', () => {
    const t = far();
    const walker = t.manager.spawn('walker', [0, 0, 0], { patrol: false });
    t.combat.applyDamage('walker-1', { amount: W.health / 2 });
    expect(t.manager.addTrait('walker-1', 'elite')).toBe(true);
    expect(walker?.health.max).toBeCloseTo(W.health * 1.6, 9);
    expect(walker?.health.current).toBeCloseTo(W.health * 0.8, 9);
    expect(t.manager.addTrait('walker-1', 'armored')).toBe(true);
    expect(walker?.config.traits).toEqual(['armored', 'elite']);
    expect(pistolHit(t, 'walker-1', 'TORSO')?.amount).toBe(16);
    expect(t.manager.removeTrait('walker-1', 'armored')).toBe(true);
    expect(pistolHit(t, 'walker-1', 'TORSO')?.amount).toBe(26);
    expect(t.manager.removeTrait('walker-1', 'elite')).toBe(true);
    expect(walker?.config.traits).toEqual([]);
    expect(walker?.health.max).toBe(W.health);
    expect(walker?.health.current).toBeCloseTo((W.health * 0.8 - 26 - 16) / 1.6, 9);
    expect(t.of('traitsChanged').map((e) => e.traits)).toEqual([
      ['elite'],
      ['armored', 'elite'],
      ['elite'],
      [],
    ]);
  });

  it('changes its speed straight away', () => {
    const t = enemyTestWorld({ targets: [new TestTarget(0, 25)] });
    const walker = t.manager.spawn('walker', [0, 0, 0], { patrol: false });
    t.manager.alert('walker-1', t.target);
    t.seconds(2);
    t.manager.setTraits('walker-1', ['armored']);
    t.seconds(1);
    const before = walker!.motor.position.clone(); // eslint-disable-line @typescript-eslint/no-non-null-assertion
    t.step(steps(1));
    expect(walker?.motor.position.distanceTo(before)).toBeCloseTo(W.moveSpeed * 0.9, 1);
  });

  it('a broken helmet stays broken when other traits change; re-adding one gives a whole one', () => {
    const t = far();
    const walker = t.manager.spawn('walker', [0, 0, 0], { patrol: false, traits: ['helmeted'] });
    pistolHit(t, 'walker-1', 'HEAD');
    expect(walker?.plates[0]?.broken).toBe(true);
    t.manager.addTrait('walker-1', 'armored');
    expect(walker?.plates[0]?.broken).toBe(true);
    expect(t.combat.get('walker-1')?.plates).toEqual(walker?.plates);
    t.manager.removeTrait('walker-1', 'helmeted');
    expect(walker?.plates).toEqual([]);
    t.manager.addTrait('walker-1', 'helmeted');
    expect(walker?.plates[0]?.durability).toBe(50);
    expect(t.combat.get('walker-1')?.plates[0]).toBe(walker?.plates[0]);
  });

  it('refuses dead, unknown or missing enemies', () => {
    const t = far();
    t.manager.spawn('walker', [0, 0, 0], { patrol: false });
    expect(t.manager.setTraits('nobody', ['elite'])).toBe(false);
    expect(() => t.manager.addTrait('walker-1', 'cursed')).toThrow(/Unknown trait/);
    t.manager.kill('walker-1');
    expect(t.manager.addTrait('walker-1', 'elite')).toBe(false);
  });
});

describe('traits and the pool', () => {
  it('a reused enemy starts with only the traits it is spawned with, and whole plates', () => {
    const t = far();
    const first = t.manager.spawn('walker', [0, 0, 0], {
      patrol: false,
      traits: ['helmeted', 'elite'],
    });
    pistolHit(t, 'walker-1', 'HEAD');
    expect(first?.plates[0]?.broken).toBe(true);
    t.manager.kill('walker-1');
    t.manager.despawn('walker-1');

    const plain = t.manager.spawn('walker', [0, 0, 0], { patrol: false });
    expect(plain).toBe(first); // the same instance
    expect(plain?.config.traits).toEqual([]);
    expect(plain?.plates).toEqual([]);
    expect(plain?.health.max).toBe(W.health);
    expect(t.combat.get('walker-2')?.plates).toEqual([]);
    expect(t.combat.get('walker-2')?.staggerThreshold).toBe(W.staggerThreshold);
    expect(pistolHit(t, 'walker-2', 'HEAD')?.amount).toBe(65);
    t.manager.kill('walker-2');
    t.manager.despawn('walker-2');

    const again = t.manager.spawn('walker', [0, 0, 0], { patrol: false, traits: ['helmeted'] });
    expect(again?.plates[0]?.durability).toBe(50);
  });

  it('haste does not survive into the next life', () => {
    const t = far();
    const first = t.manager.spawn('walker', [0, 0, 0], { patrol: false });
    first!.hasteMultiplier = 1.35; // eslint-disable-line @typescript-eslint/no-non-null-assertion
    first!.hasteUntil = 1000; // eslint-disable-line @typescript-eslint/no-non-null-assertion
    t.manager.kill('walker-1');
    t.manager.despawn('walker-1');
    const next = t.manager.spawn('walker', [0, 0, 0], { patrol: false });
    expect(next).toBe(first);
    expect(next?.haste(0)).toBe(1);
  });
});
