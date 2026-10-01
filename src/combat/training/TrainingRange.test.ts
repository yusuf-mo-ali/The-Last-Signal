import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { TRAINING_DUMMIES, TRAINING_RANGE } from '../../config/training';
import { CollisionWorld } from '../../physics/CollisionWorld';
import { Rng } from '../../utils/Rng';
import { Hitscan } from '../../weapons/hitscan';
import { boxTriangles } from '../../world/levels/geometry';
import { PickupManager } from '../../world/PickupManager';
import { CombatSystem, type HitInput } from '../CombatSystem';
import { TrainingRange } from './TrainingRange';

const DT = 1 / 60;

function setup(options: { chanceRng?: Rng; placements?: boolean } = {}) {
  const hitscan = new Hitscan(new CollisionWorld(boxTriangles([-50, -1, -50], [50, 0, 50])));
  const combat = new CombatSystem({ hitscan });
  const pickups = new PickupManager({ collector: () => null, collect: () => false });
  const range = new TrainingRange({
    combat,
    rng: options.chanceRng ?? new Rng('drops'),
    pickups,
    ...(options.placements === false ? { placements: [] } : {}),
  });
  range.reset();
  const hit = (
    targetId: string,
    zone: HitInput['zone'] = 'HEAD',
    weaponId: HitInput['weaponId'] = 'pistol',
  ) =>
    combat.applyHit({
      targetId,
      zone,
      weaponId,
      source: 'shot',
      quick: false,
      baseDamage: 26,
      falloff: 1,
      headshotMultiplier: 2.5,
      point: [0, 1.6, 0],
      direction: [0, 0, -1],
      distance: 5,
    });
  const steps = (seconds: number) => {
    for (let i = 0; i < Math.round(seconds * 60); i++) {
      combat.fixedUpdate(DT);
      range.fixedUpdate(DT);
    }
  };
  return { hitscan, combat, pickups, range, hit, steps };
}

describe('TrainingRange', () => {
  it('places the configured range as combat targets with their configured health', () => {
    const { range, combat } = setup();
    expect(range.dummies.map((d) => [d.id, d.definition.kind])).toEqual(
      TRAINING_RANGE.dummies.map((p, i) => [`dummy-${i + 1}`, p.kind]),
    );
    expect(combat.targets.map((t) => t.id)).toEqual(range.dummies.map((d) => d.id));
    for (const dummy of range.dummies) {
      expect(dummy.health.max).toBe(TRAINING_DUMMIES[dummy.definition.kind].health);
      const p = TRAINING_RANGE.dummies[range.dummies.indexOf(dummy)];
      expect(dummy.rig.position.toArray()).toEqual(p?.position);
    }
  });

  it('the dummy straight ahead of the spawn is hit in the head by a level shot', () => {
    const { hitscan } = setup();
    const hit = hitscan.cast(new Vector3(0, 1.62, 14), new Vector3(0, 0, -1), 100);
    expect(hit).toMatchObject({ kind: 'target', targetId: 'dummy-1', zone: 'HEAD' });
  });

  it('a standard dummy dies after two headshots, stays down, then stands up at full health', () => {
    const { range, hit, steps, hitscan } = setup();
    hit('dummy-1');
    expect(hit('dummy-1')?.killed).toBe(true);
    const dummy = range.get('dummy-1');
    expect(dummy?.deaths).toBe(1);
    expect(dummy?.respawnTimer).toBe(TRAINING_DUMMIES.standard.respawnDelay);
    expect(hit('dummy-1')).toBeNull(); // dead: ignored
    // Dead dummies are not hittable: the shot flies on.
    expect(hitscan.cast(new Vector3(0, 1.62, 14), new Vector3(0, 0, -1), 10)).toBeNull();

    steps(TRAINING_DUMMIES.standard.respawnDelay - 0.1);
    expect(dummy?.health.isDead).toBe(true);
    steps(0.1);
    expect(dummy?.health.isAlive).toBe(true);
    expect(dummy?.health.current).toBe(100);
    expect(dummy?.respawnTimer).toBe(0);
    expect(hit('dummy-1', 'TORSO')?.health).toBe(74);
  });

  it('the zoned dummy is tougher', () => {
    const { hit } = setup();
    for (let i = 0; i < 6; i++) {
      expect(hit('dummy-2')?.killed).toBe(false);
    }
    expect(hit('dummy-2')?.killed).toBe(true); // 7 × 65 > 400
  });

  it('dying rolls the drop table: a sure drop appears at the dummy’s feet', () => {
    const always = { next: () => 0 } as unknown as Rng;
    const { pickups, hit, range } = setup({ chanceRng: always });
    hit('dummy-1');
    hit('dummy-1');
    expect(pickups.active).toHaveLength(1);
    const p = range.get('dummy-1')?.rig.position;
    expect(pickups.active[0]?.position.x).toBe(p?.x);
    expect(pickups.active[0]?.position.z).toBe(p?.z);
    // The zoned dummy has no drop table.
    for (let i = 0; i < 7; i++) {
      hit('dummy-2');
    }
    expect(pickups.active).toHaveLength(1);
  });

  it('a drop that fails its roll leaves nothing', () => {
    const never = { next: () => 0.999 } as unknown as Rng;
    const { pickups, hit } = setup({ chanceRng: never });
    hit('dummy-1');
    hit('dummy-1');
    expect(pickups.active).toHaveLength(0);
  });

  it('spawns and removes dummies on demand (debug), with fresh ids', () => {
    const { range, combat } = setup({ placements: false });
    expect(range.dummies).toHaveLength(0);
    const d = range.spawn('standard', [5, 0, 5], 1);
    expect(d.id).toBe('dummy-1');
    expect(d.rig.yaw).toBe(1);
    expect(range.spawn('zoned', [6, 0, 5]).id).toBe('dummy-2');
    expect(range.remove('dummy-1')).toBe(true);
    expect(range.remove('dummy-1')).toBe(false);
    expect(combat.get('dummy-1')).toBeUndefined();
    expect(() => range.spawn('bogus' as 'standard', [0, 0, 0])).toThrow(/Unknown/);
  });

  it('reset rebuilds the range: everyone alive, ids from 1, extra dummies gone', () => {
    const { range, combat, hit } = setup();
    range.spawn('standard', [9, 0, 9]);
    hit('dummy-1');
    hit('dummy-1');
    range.reset();
    expect(range.dummies).toHaveLength(TRAINING_RANGE.dummies.length);
    expect(combat.targets).toHaveLength(TRAINING_RANGE.dummies.length);
    expect(range.dummies.every((d) => d.health.isAlive && d.deaths === 0)).toBe(true);
  });

  it('reviveAll stands everyone up at once', () => {
    const { range, hit } = setup();
    hit('dummy-1');
    hit('dummy-1');
    hit('dummy-3', 'TORSO');
    range.reviveAll();
    expect(range.dummies.map((d) => [d.health.current, d.respawnTimer])).toEqual(
      range.dummies.map((d) => [d.health.max, 0]),
    );
  });
});
