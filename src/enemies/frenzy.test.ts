/**
 * Alarm responses added by Phase 7.1 (D-046):
 * - a frenzy (from a DEATH CRY or a completed scream): attacks sooner, faster wind-ups (never
 *   below 70 %), faster turning and stagger resistance, never stacked, gone when it ends;
 * - a last-known alert (DEATH CRY): listeners rush where the target was when the cry went up and
 *   find it again only by seeing it;
 * - a DEATH CRY cannot chain: one kill, one cry, no further deaths.
 */

import { describe, expect, it } from 'vitest';
import type { HitInput } from '../combat/CombatSystem';
import { EFFECT_CLAMPS, type FrenzyParams } from '../config/effects';
import { ENEMY_STATS, type DamageZone } from '../config/enemies';
import { MUTATIONS } from '../config/mutations';
import { clampAlarmParams } from '../modifiers/EffectRouter';
import { TriggerRegistry } from '../modifiers/TriggerRegistry';
import { registerMutationActions } from '../signal/actions';
import { clampFrenzy } from './Enemy';
import { DT, enemyTestWorld, TestTarget } from './testWorld';

const W = ENEMY_STATS.walker;
const R = ENEMY_STATS.runner;
const S = ENEMY_STATS.screamer;
const SCREAM_FRENZY = S.ability!.frenzy!; // eslint-disable-line @typescript-eslint/no-non-null-assertion
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

/** A scream-kind alarm at the origin carrying `frenzy`, heard within 18 m. */
function scream(t: World, frenzy: FrenzyParams | null = SCREAM_FRENZY) {
  return t.manager.raiseAlarm({
    sourceId: 'screamer-x',
    kind: 'scream',
    reinforcements: true,
    position: [0, 0, 0],
    radius: 18,
    alertDuration: 8,
    haste: null,
    frenzy,
  });
}

describe('frenzy (D-046)', () => {
  it('data: the Screamer’s frenzy and the DEATH CRY’s are inside the guardrails', () => {
    expect(clampFrenzy(SCREAM_FRENZY)).toEqual(SCREAM_FRENZY);
    const cry = MUTATIONS.SCREAM.effects[0];
    const p = cry?.kind === 'trigger' ? (cry.params ?? {}) : {};
    expect(clampAlarmParams(p)).toEqual(p);
  });

  it('a completed scream frenzies those within its radius, not itself, not the far ones', () => {
    const t = enemyTestWorld({ targets: [new TestTarget(0, 12)] });
    t.manager.spawn('screamer', [0, 0, 0], { patrol: false });
    const near = t.manager.spawn('walker', [-6, 0, -4], { patrol: false });
    const far = t.manager.spawn('walker', [22, 0, -12], { patrol: false });
    t.runUntil(() => t.of('alarm').length > 0, 5);
    const now = t.manager.now;
    expect(t.of('alarm')[0]?.frenzy).toEqual(SCREAM_FRENZY);
    expect(near?.frenzied(now)).toBe(true);
    expect(near?.frenzyKind).toBe('scream');
    expect(near?.frenzyUntil).toBeCloseTo(now + SCREAM_FRENZY.duration, 9);
    expect(near?.cooldownScale(now)).toBe(SCREAM_FRENZY.cooldownScale);
    expect(far?.frenzied(now)).toBe(false);
    expect(t.manager.get('screamer-1')?.frenzied(now)).toBe(false);
    expect(t.of('frenzied')).toEqual([
      { id: 'walker-2', kind: 'scream', until: near?.frenzyUntil },
    ]);
  });

  it('an interrupted scream frenzies nobody', () => {
    const t = enemyTestWorld({ targets: [new TestTarget(0, 12)] });
    const screamer = t.manager.spawn('screamer', [0, 0, 0], { patrol: false });
    const near = t.manager.spawn('walker', [-6, 0, -4], { patrol: false });
    t.runUntil(() => screamer?.attackPhase === 'windup', 3);
    pistolHit(t, 'screamer-1', 'TORSO'); // 26 ≥ 25: staggered, the scream is lost
    t.seconds(S.attack.windup + 0.5);
    expect(t.of('alarm')).toEqual([]);
    expect(t.of('frenzied')).toEqual([]);
    expect(near?.frenzied(t.manager.now)).toBe(false);
  });

  it('a frenzied Walker winds up faster and attacks again sooner; both return after it', () => {
    const t = enemyTestWorld({ targets: [new TestTarget(0, 1.2)] });
    const walker = t.manager.spawn('walker', [0, 0, 0], { patrol: false });
    t.step();
    scream(t);
    const started: number[] = [];
    const hits: number[] = [];
    let i = 0;
    t.manager.events.on('attackStarted', () => started.push(i));
    t.manager.events.on('attackHit', () => hits.push(i));
    t.manager.events.on('attackMissed', () => hits.push(i));
    t.target.health = 1e9;
    for (; i < steps(5); i++) {
      t.step();
    }
    const windup = W.attack.windup * SCREAM_FRENZY.windupScale;
    expect(t.of('attackStarted')[0]?.windup).toBeCloseTo(windup, 9);
    expect((hits[0] ?? 0) - (started[0] ?? 0)).toBe(steps(windup));
    // The next attack comes when the shorter cooldown allows (or its recovery ends, if later).
    const gap = (started[1] ?? 0) - (started[0] ?? 0);
    expect(gap).toBe(
      Math.max(
        steps(W.attackCooldown * SCREAM_FRENZY.cooldownScale),
        steps(windup) + steps(W.attack.recovery),
      ),
    );
    expect(gap).toBeLessThan(steps(W.attackCooldown));
    // After the frenzy (6 s from the scream) everything is back to normal.
    t.seconds(SCREAM_FRENZY.duration);
    expect(walker?.frenzied(t.manager.now)).toBe(false);
    const before = t.of('attackStarted').length;
    t.runUntil(() => t.of('attackStarted').length > before, 5);
    expect(t.of('attackStarted').at(-1)?.windup).toBe(W.attack.windup);
  });

  it('turns faster while frenzied', () => {
    const turnRate = (frenzy: FrenzyParams | null) => {
      const t = enemyTestWorld({ targets: [new TestTarget(0, 8)] });
      // Facing away (yaw 0 faces −z; the target is at +z).
      const walker = t.manager.spawn('walker', [0, 0, 0], { patrol: false, yaw: 0 });
      t.step();
      scream(t, frenzy);
      let best = 0;
      for (let k = 0; k < 30; k++) {
        const before = walker?.heading ?? 0;
        t.step();
        best = Math.max(best, Math.abs((walker?.heading ?? 0) - before) / DT);
      }
      return best;
    };
    const plain = turnRate(null);
    const fast = turnRate(SCREAM_FRENZY);
    expect(plain).toBeCloseTo(W.turnSpeed, 3);
    expect(fast).toBeCloseTo(W.turnSpeed * SCREAM_FRENZY.turnScale, 3);
  });

  it('stagger resistance: a Pistol body shot staggers a Runner, but not a frenzied one', () => {
    const t = enemyTestWorld({ targets: [new TestTarget(0, 40)] });
    const plain = t.manager.spawn('runner', [10, 0, 0], { patrol: false });
    const frenzied = t.manager.spawn('runner', [-10, 0, 0], { patrol: false });
    t.step();
    t.manager.raiseAlarm({
      sourceId: 'x',
      kind: 'scream',
      reinforcements: false,
      position: [-10, 0, 0],
      radius: 5,
      alertDuration: 0,
      haste: null,
      frenzy: SCREAM_FRENZY,
    });
    expect(R.staggerThreshold).toBeLessThan(26);
    expect(R.staggerThreshold * SCREAM_FRENZY.staggerScale).toBeGreaterThan(26);
    pistolHit(t, plain?.id ?? '', 'TORSO');
    pistolHit(t, frenzied?.id ?? '', 'TORSO');
    expect(plain?.state).toBe('STAGGER');
    expect(frenzied?.state).not.toBe('STAGGER');
    // When the frenzy ends, the normal threshold is back.
    t.seconds(SCREAM_FRENZY.duration + 1);
    expect(frenzied?.frenzied(t.manager.now)).toBe(false);
    pistolHit(t, frenzied?.id ?? '', 'TORSO');
    expect(frenzied?.state).toBe('STAGGER');
  });

  it('never stacks: the strongest scales win and it ends at most one duration from now', () => {
    const t = enemyTestWorld({ targets: [new TestTarget(0, 40)] });
    const walker = t.manager.spawn('walker', [2, 0, 0], { patrol: false });
    t.step();
    const weak: FrenzyParams = {
      duration: 3,
      cooldownScale: 0.7,
      windupScale: 0.85,
      turnScale: 1.4,
      staggerScale: 1,
    };
    scream(t, SCREAM_FRENZY);
    const firstUntil = walker?.frenzyUntil ?? 0;
    t.seconds(1);
    scream(t, weak);
    let now = t.manager.now;
    expect(walker?.cooldownScale(now)).toBe(SCREAM_FRENZY.cooldownScale);
    expect(walker?.turnScale(now)).toBe(SCREAM_FRENZY.turnScale);
    expect(walker?.staggerScale(now)).toBe(SCREAM_FRENZY.staggerScale);
    expect(walker?.frenzyUntil).toBe(firstUntil); // the weaker, shorter one does not extend it
    // Many alarms in a row never push it further than one duration from the latest.
    for (let k = 0; k < 20; k++) {
      t.step();
      scream(t, SCREAM_FRENZY);
    }
    now = t.manager.now;
    expect(walker?.frenzyUntil).toBeCloseTo(now + SCREAM_FRENZY.duration, 9);
    expect(walker?.cooldownScale(now)).toBe(SCREAM_FRENZY.cooldownScale);
  });

  it('is clamped whoever asks: never longer, quicker or tougher than the guardrails', () => {
    const t = enemyTestWorld({ targets: [new TestTarget(0, 40)] });
    const walker = t.manager.spawn('walker', [2, 0, 0], { patrol: false });
    t.step();
    scream(t, {
      duration: 60,
      cooldownScale: 0.01,
      windupScale: 0.01,
      turnScale: 10,
      staggerScale: 10,
    });
    const c = EFFECT_CLAMPS.frenzy;
    const now = t.manager.now;
    expect(walker?.frenzyUntil).toBeCloseTo(now + c.duration, 9);
    expect(walker?.cooldownScale(now)).toBe(c.cooldownScale);
    expect(walker?.windupScale(now)).toBe(c.windupScale);
    expect(walker?.turnScale(now)).toBe(c.turnScale);
    expect(walker?.staggerScale(now)).toBe(c.staggerScale);
  });

  it('a pooled enemy comes back without the frenzy', () => {
    const t = enemyTestWorld({ targets: [new TestTarget(0, 40)] });
    const walker = t.manager.spawn('walker', [2, 0, 0], { patrol: false });
    t.step();
    scream(t);
    t.manager.kill(walker?.id ?? '');
    t.seconds(W.corpseTime + 0.5);
    const again = t.manager.spawn('walker', [2, 0, 0], { patrol: false });
    expect(again).toBe(walker); // the same pooled body
    expect(again?.frenzied(t.manager.now)).toBe(false);
    expect(again?.frenzyKind).toBeNull();
    expect(again?.appliedStaggerScale).toBe(1);
  });
});

describe('last-known alerts: a DEATH CRY tells where you were, not where you are (D-046)', () => {
  /**
   * A Walker north of the wall, the player south of it (no line of sight), the cry at the Walker.
   * The player then moves further away along the wall, still out of sight.
   */
  function cryScene(mode: 'live' | 'lastKnown', archetype: 'walker' | 'runner' = 'walker') {
    const t = enemyTestWorld({ targets: [new TestTarget(10, -2)] });
    const walker = t.manager.spawn(archetype, [10, 0, -20], { patrol: false });
    if (!walker) {
      throw new Error('spawn');
    }
    t.step();
    const alarm = t.manager.raiseAlarm({
      sourceId: 'walker-x',
      kind: 'deathCry',
      reinforcements: false,
      position: [10, 0, -19],
      radius: 9,
      alertDuration: 6,
      alertMode: mode,
      haste: null,
    });
    return { t, walker, alarm };
  }

  it('the listener rushes the spot where the player stood when the cry went up', () => {
    const { t, walker, alarm } = cryScene('lastKnown');
    expect(alarm.alertMode).toBe('lastKnown');
    expect(alarm.targetPosition).toEqual([10, 0, -2]);
    expect(walker.target?.id).toBe('player');
    expect(walker.investigating).toBe(true);
    expect(walker.lastKnownTargetPosition.toArray()).toEqual([10, 0, -2]);
    t.target.position.set(25, 0, 5);
    t.seconds(1);
    expect(walker.canSeeTarget).toBe(false);
    // It does not track the moving player: the spot is still where the cry was.
    expect(walker.lastKnownTargetPosition.toArray()).toEqual([10, 0, -2]);
  });

  it('a live alert (a scream) tracks the player instead', () => {
    const { t, walker } = cryScene('live');
    expect(walker.investigating).toBe(false);
    t.target.position.set(25, 0, 5);
    t.seconds(1);
    expect(walker.lastKnownTargetPosition.toArray()).toEqual([25, 0, 5]);
  });

  it('it reaches the spot through the doorway, then finds the player only by sight', () => {
    // A Runner, so the trip fits in the alert (a Walker gives up halfway: covered below).
    const { t, walker } = cryScene('lastKnown', 'runner');
    t.target.position.set(25, 0, 5);
    let closest = Number.POSITIVE_INFINITY;
    const done = t.runUntil(() => {
      closest = Math.min(
        closest,
        Math.hypot(walker.motor.position.x - 10, walker.motor.position.z + 2),
      );
      return !walker.investigating;
    }, 20);
    expect(done).toBeGreaterThan(0);
    expect(walker.motor.position.z).toBeGreaterThan(-10.5); // at or through the doorway
    // It stopped investigating because it saw the player, or it reached the spot.
    expect(walker.canSeeTarget || closest < 1.5).toBe(true);
  });

  it('a listener that never finds the player gives up when the alert and its memory run out', () => {
    const { t, walker } = cryScene('lastKnown');
    t.target.position.set(25, 0, 5);
    t.seconds(8);
    expect(walker.target).toBeNull();
    expect(walker.investigating).toBe(false);
    expect(walker.state).toBe('IDLE');
  });

  it('an enemy that already sees the player ignores the spot', () => {
    const t = enemyTestWorld({ targets: [new TestTarget(0, 6)] });
    const walker = t.manager.spawn('walker', [0, 0, 0], { patrol: false });
    t.seconds(0.5);
    expect(walker?.canSeeTarget).toBe(true);
    t.manager.raiseAlarm({
      sourceId: 'x',
      kind: 'deathCry',
      reinforcements: false,
      position: [0, 0, 0],
      radius: 9,
      alertDuration: 6,
      alertMode: 'lastKnown',
      haste: null,
    });
    expect(walker?.investigating).toBe(false);
  });
});

describe('DEATH CRY end to end: frenzy, last known, no chain', () => {
  function crowd(count: number) {
    const t = enemyTestWorld({ targets: [new TestTarget(0, 25)] });
    const triggers = new TriggerRegistry();
    registerMutationActions(triggers, t.manager);
    const cry = MUTATIONS.SCREAM.effects[0];
    const params = clampAlarmParams(cry?.kind === 'trigger' ? cry.params : {});
    triggers.add('mutation:SCREAM', 'enemy:died', 'deathCry', params);
    t.manager.events.on('died', (e) => {
      triggers.dispatch('enemy:died', e);
    });
    for (let i = 0; i < count; i++) {
      t.manager.spawn('walker', [(i % 5) * 1.6 - 3.2, 0, Math.floor(i / 5) * 1.6 - 3], {
        patrol: false,
      });
    }
    t.step();
    return { t, params };
  }

  it('one kill in a crowd of 20: exactly one cry, no further deaths, never reinforcements', () => {
    const { t } = crowd(20);
    t.manager.kill('walker-1');
    t.seconds(3);
    expect(t.of('alarm')).toHaveLength(1);
    expect(t.of('alarm')[0]).toMatchObject({
      kind: 'deathCry',
      reinforcements: false,
      alertMode: 'lastKnown',
    });
    expect(t.of('died')).toHaveLength(1);
    expect(t.manager.aliveCount).toBe(19);
  });

  it('those who hear it are hastened and frenzied for the cry’s duration, marked as a death cry', () => {
    const { t, params } = crowd(6);
    t.manager.kill('walker-1');
    const now = t.manager.now;
    const listeners = t.manager.enemies.filter((e) => e.alive);
    expect(listeners.length).toBe(5);
    for (const e of listeners) {
      expect(e.frenzyKind).toBe('deathCry');
      expect(e.frenzyUntil).toBeCloseTo(now + (params.frenzyDuration ?? 0), 9);
      expect(e.cooldownScale(now)).toBe(params.frenzyCooldownScale);
      expect(e.haste(now)).toBe(params.hasteMultiplier);
      expect(e.investigating || e.canSeeTarget).toBe(true);
    }
    expect(t.of('frenzied')).toHaveLength(5);
  });
});
