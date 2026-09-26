import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { DROP_TABLES, PICKUP_RULES, PICKUPS } from '../config/drops';
import { Rng } from '../utils/Rng';
import { rollDrops } from './drops';
import { PickupManager, type Pickup, type PickupEvents } from './PickupManager';

const DT = 1 / 60;

function setup(accept = true) {
  const player = new Vector3(20, 0, 20);
  let present = true;
  const collected: Pickup[] = [];
  const manager = new PickupManager({
    collector: () => (present ? player : null),
    collect: (pickup) => {
      if (accept) {
        collected.push(pickup);
      }
      return accept;
    },
  });
  const events: string[] = [];
  for (const type of ['spawned', 'collected', 'expired'] as const) {
    manager.events.on(type, (e: PickupEvents[typeof type]) => events.push(`${type}:${e.id}`));
  }
  return {
    manager,
    player,
    collected,
    events,
    leave: () => {
      present = false;
    },
  };
}

describe('PickupManager', () => {
  it('spawns pickups where asked', () => {
    const { manager, events } = setup();
    const p = manager.spawn('ammo', [1, 0.2, 2]);
    expect(p.position.toArray()).toEqual([1, 0.2, 2]);
    expect(p.definition).toBe(PICKUPS.ammo);
    expect(events).toEqual(['spawned:1']);
    expect(() => manager.spawn('nope' as 'ammo', [0, 0, 0])).toThrow(/Unknown pickup/);
  });

  it('is collected when the player comes within its radius and it is needed', () => {
    const { manager, player, collected, events } = setup();
    manager.spawn('ammo', [0, 0.2, 0]);
    manager.fixedUpdate(DT);
    expect(collected).toHaveLength(0);
    player.set(PICKUPS.ammo.radius - 0.01, 0, 0);
    manager.fixedUpdate(DT);
    expect(collected).toHaveLength(1);
    expect(manager.active).toHaveLength(0);
    expect(events).toEqual(['spawned:1', 'collected:1']);
  });

  it('is not collected from too far above or below', () => {
    const { manager, player, collected } = setup();
    manager.spawn('ammo', [0, 0.2, 0]);
    player.set(0, 0.2 + PICKUP_RULES.verticalReach + 0.1, 0);
    manager.fixedUpdate(DT);
    expect(collected).toHaveLength(0);
  });

  it('stays on the ground when nobody needs it, then expires', () => {
    const { manager, player, events } = setup(false);
    manager.spawn('ammo', [0, 0, 0]);
    player.set(0, 0, 0);
    for (let i = 0; i < PICKUPS.ammo.lifetime * 60 - 1; i++) {
      manager.fixedUpdate(DT);
    }
    expect(manager.active).toHaveLength(1);
    manager.fixedUpdate(DT);
    manager.fixedUpdate(DT);
    expect(manager.active).toHaveLength(0);
    expect(events).toEqual(['spawned:1', 'expired:1']);
  });

  it('nobody collects while there is no collector', () => {
    const { manager, player, collected, leave } = setup();
    manager.spawn('ammo', [0, 0, 0]);
    player.set(0, 0, 0);
    leave();
    manager.fixedUpdate(DT);
    expect(collected).toHaveLength(0);
  });

  it('keeps at most maxActive pickups, removing the oldest', () => {
    const { manager, events } = setup();
    for (let i = 0; i < PICKUP_RULES.maxActive + 2; i++) {
      manager.spawn('ammo', [i, 0, 0]);
    }
    expect(manager.active).toHaveLength(PICKUP_RULES.maxActive);
    expect(manager.active[0]?.id).toBe(3);
    expect(events.filter((e) => e.startsWith('expired'))).toEqual(['expired:1', 'expired:2']);
    manager.clear();
    expect(manager.active).toHaveLength(0);
  });
});

describe('rollDrops', () => {
  it('rolls every entry independently, with a seed-reproducible result', () => {
    const table = [
      { pickup: 'ammo' as const, chance: 0.5 },
      { pickup: 'ammo' as const, chance: 0.5 },
    ];
    const a = Array.from({ length: 50 }, (_, i) => rollDrops(table, new Rng(i)).length);
    const b = Array.from({ length: 50 }, (_, i) => rollDrops(table, new Rng(i)).length);
    expect(a).toEqual(b);
    expect(new Set(a)).toEqual(new Set([0, 1, 2]));
  });

  it('matches the configured chance over many rolls', () => {
    const rng = new Rng('drops');
    let drops = 0;
    for (let i = 0; i < 4000; i++) {
      drops += rollDrops(DROP_TABLES.trainingDummy, rng).length;
    }
    expect(drops / 4000).toBeCloseTo(0.5, 1);
  });

  it('clamps chances and scales them with a multiplier (Scavenger)', () => {
    const rng = new Rng(1);
    expect(rollDrops([{ pickup: 'ammo', chance: 0 }], rng)).toEqual([]);
    expect(rollDrops([{ pickup: 'ammo', chance: 5 }], rng)).toEqual(['ammo']);
    expect(rollDrops([{ pickup: 'ammo', chance: 0.4 }], rng, 3)).toEqual(['ammo']);
    expect(rollDrops([{ pickup: 'ammo', chance: 0.4 }], rng, 0)).toEqual([]);
  });

  it('draws once per entry even when the chance is 0 or 1', () => {
    let draws = 0;
    const counting = {
      next: () => {
        draws++;
        return 0.5;
      },
    } as unknown as Rng;
    rollDrops(
      [
        { pickup: 'ammo', chance: 0 },
        { pickup: 'ammo', chance: 1 },
      ],
      counting,
    );
    expect(draws).toBe(2);
  });
});
