/**
 * Enemy simulation cost as the crowd grows (plan §11 "no expensive logic every render frame",
 * D-037 budget: a simulation step ≤ 4 ms with the maximum alive enemies). 1–64 Walkers chase a
 * target that keeps moving around the facility yard, the expensive case: every one of them
 * steering, re-planning, colliding and pushing apart.
 *
 * The checks are on work, which is deterministic: decisions (`think`, the part that casts rays)
 * are spread evenly over the think interval, so the decisions and rays per step grow linearly
 * with the crowd and never pile up on one step. Timing is only checked against the budget itself,
 * so it fails on a real regression and not on a slow machine. `PERF_REPORT=1` prints the
 * measurements for TESTING.md §7.
 */

import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { ENEMY_RULES } from '../config/enemies';
import { FACILITY } from '../world/levels/facility';
import { World } from '../world/World';
import { meleeBrain } from './ai/meleeBrain';
import { DT, enemyTestWorld, TestTarget } from './testWorld';

const COUNTS = [1, 4, 8, 16, 32, 64] as const;
const WARM_UP_STEPS = 120;
const MEASURED_STEPS = 600;
const STEP_BUDGET_MS = 4;
const THINK_STEPS = Math.round(ENEMY_RULES.thinkInterval / DT);
const report = process.env.PERF_REPORT === '1';
const facility = new World(FACILITY);

interface Sample {
  readonly count: number;
  /** Average and worst milliseconds per fixed step (manager + combat). */
  readonly stepMs: number;
  readonly worstStepMs: number;
  /** Microseconds per step in each part (a separate, instrumented run). */
  readonly thinkUs: number;
  readonly updateUs: number;
  readonly separateUs: number;
  readonly moveUs: number;
  readonly combatUs: number;
  /** One pistol ray against the level and every enemy's hit volumes. */
  readonly hitscanUs: number;
  readonly thinksPerStep: number;
  readonly maxThinksInAStep: number;
  readonly raysPerStep: number;
}

/** The target circles the south yard at a jog, so the crowd never stops chasing. */
function moveTarget(target: TestTarget, step: number): void {
  const angle = step * DT * 0.6;
  target.position.set(Math.cos(angle) * 7, 0, 9 + Math.sin(angle) * 3);
}

function crowd(count: number) {
  const target = new TestTarget(7, 9);
  target.health = Number.POSITIVE_INFINITY; // they hit it; it never dies
  const t = enemyTestWorld({ targets: [target], level: FACILITY, world: facility.collision });
  // Spawn spots across the north yard, nearest to its middle first, where a body fits.
  const spots: Vector3[] = [];
  for (let x = -18; x <= 18; x += 1.3) {
    for (let z = -10; z <= 3; z += 1.3) {
      if (t.manager.canStand('walker', [x, 0, z])) {
        spots.push(new Vector3(x, 0, z));
      }
    }
  }
  spots.sort((a, b) => a.distanceTo(new Vector3(0, 0, -4)) - b.distanceTo(new Vector3(0, 0, -4)));
  if (spots.length < count) {
    throw new Error(`only ${spots.length} spawn spots`);
  }
  for (let i = 0; i < count; i++) {
    const enemy = t.manager.spawn('walker', spots[i] ?? new Vector3(), { alertTo: target });
    if (!enemy) {
      throw new Error('spawn refused');
    }
  }
  return { ...t, target };
}

function measure(count: number): Sample {
  const t = crowd(count);
  let step = 0;
  const tick = () => {
    moveTarget(t.target, step++);
    t.manager.fixedUpdate(DT);
    t.combat.fixedUpdate(DT);
  };
  for (let i = 0; i < WARM_UP_STEPS; i++) {
    tick();
  }

  // Clean timing, and the work done per step.
  const thinks0 = t.manager.stats.thinks;
  const rays0 = t.manager.lines.rays;
  let maxThinks = 0;
  let worst = 0;
  const start = performance.now();
  for (let i = 0; i < MEASURED_STEPS; i++) {
    const before = t.manager.stats.thinks;
    const s0 = performance.now();
    tick();
    worst = Math.max(worst, performance.now() - s0);
    maxThinks = Math.max(maxThinks, t.manager.stats.thinks - before);
  }
  const stepMs = (performance.now() - start) / MEASURED_STEPS;
  const thinksPerStep = (t.manager.stats.thinks - thinks0) / MEASURED_STEPS;
  const raysPerStep = (t.manager.lines.rays - rays0) / MEASURED_STEPS;

  // Where the time goes: the same crowd again, each part timed.
  const parts = { think: 0, update: 0, separate: 0, move: 0, combat: 0 };
  const timed =
    <A extends unknown[], R>(key: keyof typeof parts, fn: (...args: A) => R) =>
    (...args: A): R => {
      const s0 = performance.now();
      const result = fn(...args);
      parts[key] += performance.now() - s0;
      return result;
    };
  const manager = t.manager as unknown as {
    separate: (...args: unknown[]) => void;
    move: (...args: unknown[]) => void;
  };
  const brainMethods = {
    think: Object.getOwnPropertyDescriptor(meleeBrain, 'think'),
    update: Object.getOwnPropertyDescriptor(meleeBrain, 'update'),
  };
  meleeBrain.think = timed('think', meleeBrain.think.bind(meleeBrain));
  meleeBrain.update = timed('update', meleeBrain.update.bind(meleeBrain));
  manager.separate = timed('separate', manager.separate.bind(t.manager));
  manager.move = timed('move', manager.move.bind(t.manager));
  const combatStep = timed('combat', (dt: number) => {
    t.combat.fixedUpdate(dt);
  });
  try {
    for (let i = 0; i < MEASURED_STEPS; i++) {
      moveTarget(t.target, step++);
      t.manager.fixedUpdate(DT);
      combatStep(DT);
    }
  } finally {
    for (const [name, descriptor] of Object.entries(brainMethods)) {
      if (descriptor) {
        Object.defineProperty(meleeBrain, name, descriptor);
      }
    }
    delete (manager as Partial<typeof manager>).separate;
    delete (manager as Partial<typeof manager>).move;
  }

  // One shot into the crowd.
  const eye = new Vector3(t.target.position.x, 1.6, t.target.position.z);
  const centre = new Vector3();
  for (const enemy of t.manager.enemies) {
    centre.add(enemy.motor.position);
  }
  centre.divideScalar(count).setY(1.3);
  const direction = centre.sub(eye).normalize();
  const casts = 2000;
  for (let i = 0; i < 200; i++) {
    t.hitscan.cast(eye, direction, 120); // warm-up
  }
  const c0 = performance.now();
  for (let i = 0; i < casts; i++) {
    t.hitscan.cast(eye, direction, 120);
  }
  const hitscanUs = ((performance.now() - c0) / casts) * 1000;

  const us = (ms: number) => (ms / MEASURED_STEPS) * 1000;
  return {
    count,
    stepMs,
    worstStepMs: worst,
    thinkUs: us(parts.think),
    updateUs: us(parts.update),
    separateUs: us(parts.separate),
    moveUs: us(parts.move),
    combatUs: us(parts.combat),
    hitscanUs,
    thinksPerStep,
    maxThinksInAStep: maxThinks,
    raysPerStep,
  };
}

describe('enemy simulation cost, 1 to 64 Walkers chasing', () => {
  const samples: Sample[] = [];

  it.each(COUNTS)('%i Walkers: decisions spread evenly, work linear, inside the budget', (n) => {
    const sample = measure(n);
    samples.push(sample);
    // Every enemy decides once per think interval…
    expect(sample.thinksPerStep).toBeCloseTo(n / THINK_STEPS, 1);
    // …and never more than its share on any one step (no spike every interval).
    expect(sample.maxThinksInAStep).toBeLessThanOrEqual(Math.ceil(n / THINK_STEPS));
    // Rays: a handful per decision (sight, a walkable line, route corners), none per frame.
    expect(sample.raysPerStep).toBeLessThanOrEqual(sample.thinksPerStep * 16);
    expect(sample.stepMs).toBeLessThan(STEP_BUDGET_MS);
  });

  it('prints the measurements (PERF_REPORT=1)', () => {
    if (report) {
      console.table(
        samples.map((s) => ({
          walkers: s.count,
          'step ms': s.stepMs.toFixed(3),
          'worst ms': s.worstStepMs.toFixed(2),
          'think µs': s.thinkUs.toFixed(1),
          'update µs': s.updateUs.toFixed(1),
          'separate µs': s.separateUs.toFixed(1),
          'move µs': s.moveUs.toFixed(1),
          'combat µs': s.combatUs.toFixed(2),
          'hitscan µs': s.hitscanUs.toFixed(2),
          'thinks/step': s.thinksPerStep.toFixed(2),
          'max thinks': s.maxThinksInAStep,
          'rays/step': s.raysPerStep.toFixed(1),
        })),
      );
    }
    expect(samples).toHaveLength(COUNTS.length);
  });
});
