/**
 * The player's body: a kinematic capsule moved through the static level (plan §8, D-006, D-038).
 * Runs once per fixed step, so movement is identical at any display refresh rate.
 *
 * Each step:
 * 1. crouch / stand (standing up only when there is headroom),
 * 2. horizontal velocity toward the wished velocity (ground acceleration and braking, limited
 *    air control that keeps momentum),
 * 3. jump (with coyote time and a jump buffer), gravity while airborne (integrated exactly, so
 *    the jump height does not depend on the step size),
 * 4. move in sub-steps no longer than half the capsule radius, pushing out of every surface
 *    touched (walkable ground pushes straight up, so the player never slides on slopes; walls
 *    and ceilings push along their normal and cancel the velocity into them),
 * 5. ground check: a short downward probe, or a longer "snap" while walking so the player sticks
 *    to ramps and stairs instead of skipping down them,
 * 6. kill plane: anything that escapes the level is returned to the spawn point.
 *
 * Browser-independent: three.js math only. Positions are the feet (bottom of the capsule).
 */

import { Vector3 } from 'three';
import { Capsule } from 'three/addons/math/Capsule.js';
import { jumpSpeed, type PlayerMovementConfig } from '../config/player';
import type { CapsuleContact, CollisionWorld } from '../physics/CollisionWorld';

/** What the player wants to do this step, independent of which keys produced it. */
export interface MoveIntent {
  /** -1 (back) … 1 (forward). */
  readonly forward: number;
  /** -1 (left) … 1 (right). */
  readonly right: number;
  readonly sprint: boolean;
  /** Held: crouch while true. */
  readonly crouch: boolean;
  /** Pressed this step (an edge, not held). */
  readonly jump: boolean;
}

export const NO_INTENT: MoveIntent = {
  forward: 0,
  right: 0,
  sprint: false,
  crouch: false,
  jump: false,
};

/** Resolution passes per sub-step; each pass fixes the deepest remaining overlap. */
const MAX_RESOLVE_PASSES = 6;
/** Overlaps shallower than this are treated as touching, not penetrating. */
const CONTACT_EPSILON = 1e-5;
/** Downward probe that decides "grounded" when not snapping. */
const GROUND_PROBE = 0.03;
/** Sub-step length as a fraction of the capsule radius (tunnelling guard). */
const SUBSTEP_FRACTION = 0.5;
const MAX_SUBSTEPS = 16;
/** A contact whose normal points down at least this much is a ceiling. */
const CEILING_NORMAL_Y = -0.3;

export class PlayerMotor {
  /** Feet position after the latest step. */
  readonly position = new Vector3();
  /** Feet position before the latest step, for render interpolation. */
  readonly previousPosition = new Vector3();
  readonly velocity = new Vector3();
  /** Normal of the ground under the feet (up when airborne). */
  readonly groundNormal = new Vector3(0, 1, 0);

  grounded = false;
  crouched = false;
  sprinting = false;
  /** Eye height above the feet; eases between the standing and crouched heights. */
  eyeHeight: number;
  previousEyeHeight: number;
  /** Times the player fell out of the level and was returned to the spawn. */
  respawns = 0;
  /** Horizontal distance walked on the ground, metres (feeds the head bob and tests). */
  groundDistance = 0;

  readonly config: PlayerMovementConfig;
  private readonly world: CollisionWorld;
  private readonly spawn = new Vector3();
  private readonly killPlaneY: number;
  private timeSinceGrounded = Number.POSITIVE_INFINITY;
  private jumpBuffer = 0;
  private jumpedThisStep = false;
  /**
   * Added to the vertical velocity when moving, so a step moves by the *average* vertical speed
   * over the step (exact for constant gravity): jumps reach `jumpHeight` at any step size.
   */
  private verticalBias = 0;

  private readonly capsule = new Capsule();
  private readonly wish = new Vector3();
  private readonly scratch = new Vector3();
  private readonly stepMove = new Vector3();

  constructor(
    world: CollisionWorld,
    config: PlayerMovementConfig,
    spawn: { readonly position: Vector3; readonly killPlaneY: number },
  ) {
    this.world = world;
    this.config = config;
    this.spawn.copy(spawn.position);
    this.killPlaneY = spawn.killPlaneY;
    this.eyeHeight = config.standEyeHeight;
    this.previousEyeHeight = config.standEyeHeight;
    this.reset();
  }

  /** Current capsule height (standing or crouched). */
  get height(): number {
    return this.crouched ? this.config.crouchHeight : this.config.standHeight;
  }

  /** Horizontal speed, m/s. */
  get horizontalSpeed(): number {
    return Math.hypot(this.velocity.x, this.velocity.z);
  }

  /** Puts the player at the spawn point, standing still. */
  reset(): void {
    this.teleport(this.spawn);
  }

  /** Moves the player instantly (no interpolation, no collision sweep), then settles on the ground. */
  teleport(position: Vector3): void {
    this.position.copy(position);
    this.velocity.set(0, 0, 0);
    this.verticalBias = 0;
    this.crouched = false;
    this.sprinting = false;
    this.eyeHeight = this.config.standEyeHeight;
    this.jumpBuffer = 0;
    this.timeSinceGrounded = Number.POSITIVE_INFINITY;
    this.resolveOverlaps();
    this.grounded = this.probeGround(GROUND_PROBE);
    this.previousPosition.copy(this.position);
    this.previousEyeHeight = this.eyeHeight;
  }

  /** Keeps interpolation still for a step in which the player does not simulate. */
  hold(): void {
    this.previousPosition.copy(this.position);
    this.previousEyeHeight = this.eyeHeight;
  }

  /** Advances the body by one fixed step. `yaw` is the view direction (PlayerLook). */
  step(intent: MoveIntent, yaw: number, dt: number): void {
    const { config, velocity } = this;
    this.previousPosition.copy(this.position);
    this.previousEyeHeight = this.eyeHeight;
    this.jumpedThisStep = false;
    const wasGrounded = this.grounded;

    this.updateCrouch(intent.crouch);

    // ---- horizontal velocity ----------------------------------------------------------------
    const forward = clampUnit(intent.forward);
    const right = clampUnit(intent.right);
    // Forward is (-sin yaw, 0, -cos yaw); right is (cos yaw, 0, -sin yaw).
    const sin = Math.sin(yaw);
    const cos = Math.cos(yaw);
    this.wish.set(-sin * forward + cos * right, 0, -cos * forward - sin * right);
    const wishLength = this.wish.length();
    if (wishLength > 1) {
      this.wish.divideScalar(wishLength); // diagonals are no faster
    }
    this.sprinting = intent.sprint && !this.crouched && forward > 0;
    const topSpeed =
      config.walkSpeed *
      (this.crouched ? config.crouchMultiplier : this.sprinting ? config.sprintMultiplier : 1);
    const hasInput = wishLength > 1e-6;
    if (this.grounded) {
      const rate = hasInput ? config.groundAcceleration : config.groundDeceleration;
      this.accelerateToward(this.wish.x * topSpeed, this.wish.z * topSpeed, rate * dt);
    } else if (hasInput) {
      this.accelerateToward(
        this.wish.x * topSpeed,
        this.wish.z * topSpeed,
        config.airAcceleration * dt,
      );
    }

    // ---- jump and gravity -------------------------------------------------------------------
    this.jumpBuffer = intent.jump ? config.jumpBufferTime : Math.max(0, this.jumpBuffer - dt);
    const canJump = this.grounded || this.timeSinceGrounded <= config.coyoteTime;
    if (this.jumpBuffer > 0 && canJump) {
      velocity.y = jumpSpeed(config);
      this.grounded = false;
      this.jumpBuffer = 0;
      this.timeSinceGrounded = Number.POSITIVE_INFINITY; // one jump per take-off
      this.jumpedThisStep = true;
    }
    if (this.grounded) {
      velocity.y = 0;
      this.verticalBias = 0;
    } else {
      const before = velocity.y;
      velocity.y = Math.max(velocity.y - config.gravity * dt, -config.maxFallSpeed);
      this.verticalBias = (before - velocity.y) / 2;
    }

    // ---- move and collide -------------------------------------------------------------------
    const startX = this.position.x;
    const startZ = this.position.z;
    this.moveAndCollide(dt);

    // ---- ground check -----------------------------------------------------------------------
    const snap = wasGrounded && !this.jumpedThisStep && velocity.y <= 0;
    if (velocity.y > 0 && !snap) {
      this.grounded = false;
    } else {
      this.grounded = this.probeGround(snap ? config.groundSnapDistance : GROUND_PROBE);
    }
    if (this.grounded) {
      velocity.y = Math.max(0, velocity.y);
      this.timeSinceGrounded = 0;
      this.groundDistance += Math.hypot(this.position.x - startX, this.position.z - startZ);
    } else {
      this.timeSinceGrounded += dt;
      this.groundNormal.set(0, 1, 0);
    }

    // ---- eye height and kill plane ----------------------------------------------------------
    const targetEye = this.crouched ? config.crouchEyeHeight : config.standEyeHeight;
    this.eyeHeight += (targetEye - this.eyeHeight) * (1 - Math.exp(-config.eyeHeightResponse * dt));

    if (this.position.y < this.killPlaneY) {
      this.respawns++;
      this.reset();
    }
  }

  /** True if a standing capsule would fit at the current position. */
  canStand(): boolean {
    const { config } = this;
    // Slightly thinner, so a wall the player is merely touching does not count as "no headroom".
    const radius = config.radius - 0.02;
    this.capsule.start.set(this.position.x, this.position.y + config.radius, this.position.z);
    this.capsule.end.set(
      this.position.x,
      this.position.y + config.standHeight - radius,
      this.position.z,
    );
    this.capsule.radius = radius;
    return !this.world.capsuleContacts(this.capsule).some((c) => c.depth > CONTACT_EPSILON);
  }

  private updateCrouch(wantCrouch: boolean): void {
    if (wantCrouch) {
      this.crouched = true;
    } else if (this.crouched && this.canStand()) {
      this.crouched = false;
    }
  }

  /** Moves the horizontal velocity toward (x, z) by at most `maxChange`. */
  private accelerateToward(x: number, z: number, maxChange: number): void {
    const dx = x - this.velocity.x;
    const dz = z - this.velocity.z;
    const distance = Math.hypot(dx, dz);
    if (distance <= maxChange) {
      this.velocity.x = x;
      this.velocity.z = z;
    } else {
      this.velocity.x += (dx / distance) * maxChange;
      this.velocity.z += (dz / distance) * maxChange;
    }
  }

  private moveAndCollide(dt: number): void {
    const total = this.scratch.copy(this.velocity).multiplyScalar(dt);
    const maxStep = this.config.radius * SUBSTEP_FRACTION;
    const substeps = Math.min(MAX_SUBSTEPS, Math.max(1, Math.ceil(total.length() / maxStep)));
    for (let i = 0; i < substeps; i++) {
      // Velocity may lose components to collisions mid-move; re-derive each sub-step's share.
      this.stepMove.copy(this.velocity);
      this.stepMove.y += this.verticalBias;
      this.stepMove.multiplyScalar(dt / substeps);
      this.position.add(this.stepMove);
      this.resolveOverlaps();
    }
  }

  /** Pushes the capsule out of every surface it overlaps, deepest first. */
  private resolveOverlaps(): void {
    const { config, velocity } = this;
    for (let pass = 0; pass < MAX_RESOLVE_PASSES; pass++) {
      const contact = this.deepestContact();
      if (!contact) {
        return;
      }
      const n = contact.normal;
      if (n.y >= config.walkableNormalY) {
        // Ground: lift straight up by the amount that clears the surface. No sideways push, so
        // standing or walking on a ramp never slides the player.
        this.position.y += contact.depth / n.y;
        if (velocity.y < 0) {
          velocity.y = 0;
          this.verticalBias = 0;
        }
      } else {
        this.position.addScaledVector(n, contact.depth);
        const into = velocity.dot(n);
        if (into < 0) {
          velocity.addScaledVector(n, -into); // slide along the surface
        }
        if (n.y <= CEILING_NORMAL_Y && velocity.y > 0) {
          velocity.y = 0; // head hit a ceiling: start falling
          this.verticalBias = 0;
        }
      }
    }
  }

  private deepestContact(): CapsuleContact | undefined {
    this.placeCapsule(this.position.y);
    const contacts = this.world.capsuleContacts(this.capsule);
    const deepest = contacts[0];
    return deepest && deepest.depth > CONTACT_EPSILON ? deepest : undefined;
  }

  /**
   * Looks for walkable ground up to `maxDrop` below the feet. If found, moves the feet onto it
   * and records its normal. Probes in increments shorter than the radius, so no thin floor is
   * skipped.
   */
  private probeGround(maxDrop: number): boolean {
    const { config } = this;
    const startY = this.position.y;
    const increments = Math.max(1, Math.ceil(maxDrop / (config.radius * SUBSTEP_FRACTION)));
    for (let i = 1; i <= increments; i++) {
      const y = startY - (maxDrop * i) / increments;
      const ground = this.walkableContact(y);
      if (ground) {
        // Settle onto the surface: lift by the overlap until no walkable surface overlaps.
        let settledY = y;
        for (let pass = 0; pass < MAX_RESOLVE_PASSES; pass++) {
          const overlap = this.walkableContact(settledY);
          if (!overlap) {
            break;
          }
          this.groundNormal.copy(overlap.normal);
          settledY += overlap.depth / overlap.normal.y;
        }
        this.position.y = Math.min(startY, settledY);
        return true;
      }
    }
    this.position.y = startY;
    return false;
  }

  private walkableContact(feetY: number): CapsuleContact | undefined {
    this.placeCapsule(feetY);
    return this.world
      .capsuleContacts(this.capsule)
      .find((c) => c.depth > CONTACT_EPSILON && c.normal.y >= this.config.walkableNormalY);
  }

  private placeCapsule(feetY: number): void {
    const { radius } = this.config;
    const { x, z } = this.position;
    this.capsule.radius = radius;
    this.capsule.start.set(x, feetY + radius, z);
    this.capsule.end.set(x, feetY + this.height - radius, z);
  }
}

function clampUnit(value: number): number {
  return Math.min(1, Math.max(-1, value));
}
