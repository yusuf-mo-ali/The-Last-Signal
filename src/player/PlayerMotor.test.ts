import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { jumpSpeed, PLAYER_MOVEMENT as P } from '../config/player';
import { CollisionWorld } from '../physics/CollisionWorld';
import { levelTriangles } from '../world/levels/geometry';
import type { Brush, Vec3 } from '../world/levels/types';
import { NO_INTENT, PlayerMotor, type MoveIntent } from './PlayerMotor';

const DT = 1 / 60;
const box = (min: Vec3, max: Vec3): Brush => ({ kind: 'box', min, max, surface: 'wall' });

/**
 * A test range, laid out in lanes so each test has room:
 * - a big floor (top y = 0) around the origin, and nothing beyond it (a drop into the void),
 * - a wall whose west face is at x = 5,
 * - a low ceiling at y = 1.3 over x ∈ [-20, -10] (crouch-only tunnel),
 * - a 1 m high platform over z ∈ [20, 30] (ledges),
 * - a walkable ramp (0 → 2 m over 6 m) and a steep one (0 → 3 m over 1 m),
 * - a thin 5 cm floor slab high up, and a thin wall, for tunnelling tests.
 */
const RANGE: Brush[] = [
  box([-40, -1, -40], [40, 0, 40]),
  box([5, 0, -10], [6, 4, 10]),
  box([-20, 1.3, -5], [-10, 2, 5]),
  box([-5, 0, 20], [5, 1, 30]),
  { kind: 'ramp', min: [20, 0, -3], max: [26, 2, 3], rise: '+x', surface: 'wall' },
  box([26, 0, -3], [30, 2, 3]),
  { kind: 'ramp', min: [20, 0, 10], max: [21, 3, 14], rise: '+x', surface: 'wall' },
  box([-30, 20, -30], [-20, 20.05, -20]),
  box([-10, 0, -30], [-9.95, 4, -20]),
];
const WORLD = new CollisionWorld(levelTriangles(RANGE, 'collision').flatMap((g) => g.triangles));

function motorAt(x: number, y: number, z: number, config = P): PlayerMotor {
  return new PlayerMotor(WORLD, config, {
    position: new Vector3(x, y, z),
    killPlaneY: -20,
  });
}

function intent(partial: Partial<MoveIntent>): MoveIntent {
  return { ...NO_INTENT, ...partial };
}

function run(motor: PlayerMotor, input: MoveIntent, steps: number, yaw = 0): void {
  for (let i = 0; i < steps; i++) {
    motor.step(input, yaw, DT);
  }
}

const FORWARD = intent({ forward: 1 });

describe('PlayerMotor', () => {
  describe('standing', () => {
    it('starts grounded on the floor, at rest, standing', () => {
      const m = motorAt(0, 0, 0);
      expect(m.grounded).toBe(true);
      expect(m.crouched).toBe(false);
      expect(m.position.y).toBeCloseTo(0, 5);
      expect(m.eyeHeight).toBe(P.standEyeHeight);
    });

    it('stays exactly still with no input (no drift, no sinking)', () => {
      const m = motorAt(0, 0, 0);
      run(m, NO_INTENT, 300);
      expect(m.position.length()).toBeLessThan(1e-6);
      expect(m.grounded).toBe(true);
    });
  });

  describe('movement integration', () => {
    it('moves forward (−z at yaw 0), back, and strafes', () => {
      const cases: [Partial<MoveIntent>, [number, number]][] = [
        [{ forward: 1 }, [0, -1]],
        [{ forward: -1 }, [0, 1]],
        [{ right: 1 }, [1, 0]],
        [{ right: -1 }, [-1, 0]],
      ];
      for (const [input, [dx, dz]] of cases) {
        const m = motorAt(0, 0, 0);
        run(m, intent(input), 30);
        const moved = m.position.clone().normalize();
        expect(moved.x).toBeCloseTo(dx, 5);
        expect(moved.z).toBeCloseTo(dz, 5);
      }
    });

    it('moves relative to the view: yaw π/2 turns "forward" to −x', () => {
      const m = motorAt(0, 0, 0);
      run(m, FORWARD, 30, Math.PI / 2);
      expect(m.position.x).toBeLessThan(-1);
      expect(Math.abs(m.position.z)).toBeLessThan(1e-6);
    });

    it('accelerates to walking speed quickly, then holds it', () => {
      const m = motorAt(0, 0, 0);
      m.step(FORWARD, 0, DT);
      expect(m.horizontalSpeed).toBeCloseTo(P.groundAcceleration * DT);
      run(m, FORWARD, 8); // 9 steps = 0.15 s
      expect(m.horizontalSpeed).toBeCloseTo(P.walkSpeed);
      run(m, FORWARD, 60);
      expect(m.horizontalSpeed).toBeCloseTo(P.walkSpeed);
    });

    it('covers walking speed × time once at speed', () => {
      const m = motorAt(-20, 0, 15);
      run(m, intent({ right: 1 }), 30);
      const x0 = m.position.x;
      run(m, intent({ right: 1 }), 60);
      expect(m.position.x - x0).toBeCloseTo(P.walkSpeed, 5);
    });

    it('brakes to a stop when the keys are released, without sliding backwards', () => {
      const m = motorAt(0, 0, 0);
      run(m, FORWARD, 60);
      const zAtRelease = m.position.z;
      let steps = 0;
      while (m.horizontalSpeed > 0 && steps < 60) {
        m.step(NO_INTENT, 0, DT);
        steps++;
      }
      expect(steps * DT).toBeLessThanOrEqual(P.walkSpeed / P.groundDeceleration + DT);
      const zStopped = m.position.z;
      expect(zStopped).toBeLessThan(zAtRelease); // kept moving forward while braking
      run(m, NO_INTENT, 30);
      expect(m.position.z).toBe(zStopped);
    });

    it('is no faster diagonally', () => {
      const m = motorAt(-30, 0, 15); // open floor to the north-east
      run(m, intent({ forward: 1, right: 1 }), 60);
      expect(m.horizontalSpeed).toBeCloseTo(P.walkSpeed);
    });

    it('cancels opposite inputs', () => {
      const m = motorAt(0, 0, 0);
      run(m, intent({ forward: 1, right: 0 }), 1);
      run(m, intent({ forward: 0 }), 60);
      expect(m.horizontalSpeed).toBe(0);
    });

    it('records the previous position each step for render interpolation', () => {
      const m = motorAt(0, 0, 0);
      run(m, FORWARD, 20);
      const before = m.position.clone();
      m.step(FORWARD, 0, DT);
      expect(m.previousPosition.equals(before)).toBe(true);
      expect(m.position.z).toBeLessThan(before.z);
      m.hold();
      expect(m.previousPosition.equals(m.position)).toBe(true);
    });
  });

  describe('sprint', () => {
    it('sprints at 1.5× walking speed while moving forward', () => {
      const m = motorAt(0, 0, 0);
      run(m, intent({ forward: 1, sprint: true }), 60);
      expect(m.sprinting).toBe(true);
      expect(m.horizontalSpeed).toBeCloseTo(P.walkSpeed * P.sprintMultiplier);
    });

    it('does not sprint backwards or sideways only', () => {
      for (const input of [{ forward: -1 }, { right: 1 }]) {
        const m = motorAt(-35, 0, 12);
        run(m, intent({ ...input, sprint: true }), 60);
        expect(m.sprinting).toBe(false);
        expect(m.horizontalSpeed).toBeCloseTo(P.walkSpeed);
      }
    });

    it('slows back to walking speed when sprint is released', () => {
      const m = motorAt(0, 0, 0);
      run(m, intent({ forward: 1, sprint: true }), 60);
      run(m, FORWARD, 30);
      expect(m.horizontalSpeed).toBeCloseTo(P.walkSpeed);
    });
  });

  describe('crouch', () => {
    it('crouches: lower capsule, lower eyes (eased), half speed; sprint is ignored', () => {
      const m = motorAt(0, 0, 0);
      m.step(intent({ crouch: true }), 0, DT);
      expect(m.crouched).toBe(true);
      expect(m.height).toBe(P.crouchHeight);
      expect(m.eyeHeight).toBeLessThan(P.standEyeHeight);
      expect(m.eyeHeight).toBeGreaterThan(P.crouchEyeHeight); // eased, not snapped
      run(m, intent({ crouch: true, forward: 1, sprint: true }), 60);
      expect(m.eyeHeight).toBeCloseTo(P.crouchEyeHeight, 3);
      expect(m.sprinting).toBe(false);
      expect(m.horizontalSpeed).toBeCloseTo(P.walkSpeed * P.crouchMultiplier);
    });

    it('stands up when released, if there is headroom', () => {
      const m = motorAt(0, 0, 0);
      run(m, intent({ crouch: true }), 10);
      run(m, NO_INTENT, 60);
      expect(m.crouched).toBe(false);
      expect(m.eyeHeight).toBeCloseTo(P.standEyeHeight, 3);
    });

    it('cannot enter a low tunnel standing, but can crouched', () => {
      const standing = motorAt(-8, 0, 0);
      run(standing, intent({ right: -1 }), 120); // walk west into the tunnel mouth
      expect(standing.position.x).toBeGreaterThan(-10 + 0.1);
      expect(standing.position.y).toBeCloseTo(0, 5);

      const crouching = motorAt(-8, 0, 0);
      run(crouching, intent({ right: -1, crouch: true }), 120);
      expect(crouching.position.x).toBeLessThan(-12);
      expect(crouching.grounded).toBe(true);
    });

    it('stays crouched under a low ceiling until there is room to stand', () => {
      const m = motorAt(-8, 0, 0);
      run(m, intent({ right: -1, crouch: true }), 120);
      expect(m.canStand()).toBe(false);
      run(m, NO_INTENT, 30); // crouch released inside the tunnel
      expect(m.crouched).toBe(true);
      run(m, intent({ right: 1 }), 120); // walk back out
      expect(m.position.x).toBeGreaterThan(-10);
      expect(m.crouched).toBe(false);
    });
  });

  describe('jump and gravity', () => {
    function jumpApex(m: PlayerMotor): { apex: number; airSteps: number } {
      m.step(intent({ jump: true }), 0, DT);
      let apex = m.position.y;
      let airSteps = 1;
      while (!m.grounded && airSteps < 300) {
        m.step(NO_INTENT, 0, DT);
        apex = Math.max(apex, m.position.y);
        airSteps++;
      }
      return { apex, airSteps };
    }

    it('jumps to the configured height and lands after the expected air time', () => {
      const m = motorAt(0, 0, 0);
      const { apex, airSteps } = jumpApex(m);
      expect(apex).toBeGreaterThan(P.jumpHeight * 0.95);
      expect(apex).toBeLessThan(P.jumpHeight * 1.02);
      const expectedAir = (2 * jumpSpeed(P)) / P.gravity;
      expect(airSteps * DT).toBeCloseTo(expectedAir, 1);
      expect(m.grounded).toBe(true);
      expect(m.position.y).toBeCloseTo(0, 5);
      expect(m.velocity.y).toBe(0);
    });

    it('does not jump again while the key is held (jump is an edge)', () => {
      const m = motorAt(0, 0, 0);
      jumpApex(m);
      run(m, NO_INTENT, 60); // the held key produces no new presses
      expect(m.grounded).toBe(true);
      expect(m.position.y).toBeCloseTo(0, 5);
    });

    it('cannot jump in mid-air', () => {
      const m = motorAt(0, 0, 0);
      m.step(intent({ jump: true }), 0, DT);
      run(m, NO_INTENT, 20); // past the coyote window, rising
      const vy = m.velocity.y;
      m.step(intent({ jump: true }), 0, DT);
      expect(m.velocity.y).toBeLessThan(vy); // gravity only, no second boost
    });

    it('buffers a jump pressed just before landing', () => {
      const m = motorAt(0, 3, 0); // falling from 3 m
      expect(m.grounded).toBe(false);
      while (m.position.y > 0.4) {
        m.step(NO_INTENT, 0, DT);
      }
      m.step(intent({ jump: true }), 0, DT); // still in the air, within the buffer window
      let jumped = false;
      for (let i = 0; i < 12; i++) {
        m.step(NO_INTENT, 0, DT);
        jumped ||= m.velocity.y > 0;
      }
      expect(jumped).toBe(true);
    });

    it('forgets a jump pressed too long before landing', () => {
      const m = motorAt(0, 6, 0);
      while (m.position.y > 3) {
        m.step(NO_INTENT, 0, DT);
      }
      m.step(intent({ jump: true }), 0, DT);
      let jumped = false;
      for (let i = 0; i < 90; i++) {
        m.step(NO_INTENT, 0, DT);
        jumped ||= m.velocity.y > 0;
      }
      expect(jumped).toBe(false);
      expect(m.grounded).toBe(true);
    });

    it('falls under gravity when airborne, up to the terminal speed', () => {
      const m = motorAt(-25, 60, -35); // over open floor, far from everything
      m.step(NO_INTENT, 0, DT);
      m.step(NO_INTENT, 0, DT);
      expect(m.velocity.y).toBeCloseTo(-2 * P.gravity * DT);
      run(m, NO_INTENT, 60);
      expect(m.velocity.y).toBeCloseTo(-P.gravity * DT * 62);
      const fast = motorAt(-25, 5000, -35);
      run(fast, NO_INTENT, 300);
      expect(fast.velocity.y).toBe(-P.maxFallSpeed);
    });
  });

  describe('ground detection and ledges', () => {
    it('walks off a ledge and falls', () => {
      const m = motorAt(0, 1, 25); // on the platform
      expect(m.grounded).toBe(true);
      run(m, intent({ forward: -1 }), 90); // south, off the edge at z = 30
      expect(m.position.z).toBeGreaterThan(30);
      expect(m.position.y).toBeCloseTo(0, 5);
      expect(m.grounded).toBe(true);
    });

    it('allows a jump shortly after leaving a ledge (coyote time)', () => {
      const m = motorAt(0, 1, 29.2);
      let steps = 0;
      while (m.grounded && steps < 60) {
        m.step(intent({ forward: -1 }), 0, DT);
        steps++;
      }
      expect(m.grounded).toBe(false);
      m.step(intent({ forward: -1 }), 0, DT);
      m.step(intent({ forward: -1, jump: true }), 0, DT); // 2 steps (33 ms) late
      expect(m.velocity.y).toBeGreaterThan(0);
    });

    it('does not allow a jump long after leaving a ledge', () => {
      const m = motorAt(0, 1, 29.2);
      while (m.grounded) {
        m.step(intent({ forward: -1 }), 0, DT);
      }
      run(m, intent({ forward: -1 }), Math.ceil(P.coyoteTime / DT) + 2);
      m.step(intent({ jump: true }), 0, DT);
      expect(m.velocity.y).toBeLessThan(0);
    });

    it('blocks a walk into a ledge taller than a step, and lets a jump reach its top', () => {
      const walker = motorAt(0, 0, 33);
      run(walker, FORWARD, 90); // north into the platform's south face (z = 30)
      expect(walker.position.z).toBeGreaterThanOrEqual(30 + P.radius - 1e-3);
      expect(walker.position.y).toBeCloseTo(0, 5);

      const jumper = motorAt(0, 0, 31);
      jumper.step(intent({ forward: 1, jump: true }), 0, DT);
      run(jumper, FORWARD, 60);
      expect(jumper.position.y).toBeCloseTo(1, 5);
      expect(jumper.position.z).toBeLessThan(30);
    });

    it('walks up a walkable ramp and stays grounded sprinting down it (ground snap)', () => {
      const m = motorAt(17, 0, 0);
      run(m, intent({ right: 1 }), 150); // east, up the ramp onto the block
      expect(m.position.x).toBeGreaterThan(26);
      expect(m.position.y).toBeCloseTo(2, 5);
      // Sprinting west, facing west: each step drops more than the plain ground probe reaches.
      m.teleport(new Vector3(27, 2, 0));
      let airborne = 0;
      for (let i = 0; i < 120; i++) {
        m.step(intent({ forward: 1, sprint: true }), Math.PI / 2, DT);
        airborne += m.grounded ? 0 : 1;
      }
      expect(m.position.x).toBeLessThan(20);
      expect(airborne).toBe(0);
    });

    it('does not slide when standing on a ramp', () => {
      const m = motorAt(23, 1, 0);
      const start = m.position.clone();
      run(m, NO_INTENT, 180);
      expect(m.grounded).toBe(true);
      expect(m.position.distanceTo(start)).toBeLessThan(1e-6);
      expect(m.groundNormal.y).toBeLessThan(1);
    });

    it('lands on a ramp without being pushed sideways', () => {
      const m = motorAt(23, 3, 0);
      let steps = 0;
      while (!m.grounded && steps++ < 120) {
        m.step(NO_INTENT, 0, DT);
      }
      expect(m.grounded).toBe(true);
      expect(m.position.x).toBe(23);
      expect(m.position.z).toBe(0);
      // The ramp is 1 m high at x = 23; a sphere resting on a slope sits r·(1/n.y − 1) higher.
      const normalY = 3 / Math.hypot(3, 1);
      expect(m.position.y).toBeCloseTo(1 + P.radius * (1 / normalY - 1), 3);
    });

    it('cannot walk up a slope steeper than walkable', () => {
      const m = motorAt(18, 0, 12);
      run(m, intent({ right: 1 }), 180);
      expect(m.position.y).toBeLessThan(0.5);
      expect(m.position.x).toBeLessThan(21);
    });
  });

  describe('collision', () => {
    it('stops at a wall, one radius from its face', () => {
      const m = motorAt(0, 0, 0);
      run(m, intent({ right: 1 }), 120);
      expect(m.position.x).toBeCloseTo(5 - P.radius, 3);
      expect(m.velocity.x).toBeCloseTo(0, 5);
    });

    it('slides along a wall when moving into it at an angle', () => {
      const m = motorAt(4, 0, 0);
      // 45° into the wall: north-east.
      run(m, intent({ forward: 1, right: 1 }), 60);
      expect(m.position.x).toBeLessThanOrEqual(5 - P.radius + 1e-3);
      expect(m.position.z).toBeLessThan(-2);
    });

    it('does not tunnel through a thin floor at terminal fall speed', () => {
      const m = motorAt(-25, 30, -25);
      m.velocity.y = -P.maxFallSpeed;
      run(m, NO_INTENT, 60);
      expect(m.position.y).toBeCloseTo(20.05, 3);
      expect(m.grounded).toBe(true);
    });

    it('does not tunnel through a thin wall at very high speed', () => {
      // In the air, east of a 5 cm wall at x = −10, moving 1 m per step (3× the capsule radius).
      const m = motorAt(-8.5, 1, -25);
      m.velocity.set(-60, 0, 0);
      run(m, NO_INTENT, 10);
      expect(m.position.x).toBeCloseTo(-9.95 + P.radius, 3);
    });

    it('never ends a step inside the level while running around', () => {
      const m = motorAt(0, 0, 0);
      for (let i = 0; i < 1200; i++) {
        const yaw = Math.sin(i / 50) * Math.PI;
        m.step(intent({ forward: 1, sprint: i % 200 < 100, jump: i % 90 === 0 }), yaw, DT);
        expect(m.position.y).toBeGreaterThan(-0.01);
      }
    });
  });

  describe('falling out of the level', () => {
    it('returns to the spawn point below the kill plane', () => {
      const m = motorAt(0, 0, 0);
      m.teleport(new Vector3(100, 0, 100)); // beyond the floor
      let steps = 0;
      while (m.respawns === 0 && steps < 600) {
        m.step(NO_INTENT, 0, DT);
        steps++;
      }
      expect(m.respawns).toBe(1);
      expect(m.position.length()).toBeLessThan(1e-6);
      expect(m.velocity.length()).toBe(0);
      expect(m.grounded).toBe(true);
    });
  });
});
