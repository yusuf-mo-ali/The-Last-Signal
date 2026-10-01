import { describe, expect, it } from 'vitest';
import { CATWALK_HEIGHT, DOCK_HEIGHT, DUCT_CLEARANCE } from '../world/levels/facility';
import { jumpSpeed, PLAYER_MOVEMENT as P } from './player';

describe('PLAYER_MOVEMENT', () => {
  it('has a consistent body: crouched is shorter, eyes sit inside the capsule', () => {
    expect(P.crouchHeight).toBeLessThan(P.standHeight);
    expect(P.crouchHeight).toBeGreaterThan(P.radius * 2);
    expect(P.standEyeHeight).toBeLessThan(P.standHeight);
    expect(P.crouchEyeHeight).toBeLessThan(P.crouchHeight);
    expect(P.crouchEyeHeight).toBeLessThan(P.standEyeHeight);
  });

  it('orders speeds: crouch < walk < sprint', () => {
    expect(P.crouchMultiplier).toBeGreaterThan(0);
    expect(P.crouchMultiplier).toBeLessThan(1);
    expect(P.sprintMultiplier).toBeGreaterThan(1);
  });

  it('reaches full speed and stops quickly (responsive, not floaty)', () => {
    const sprintSpeed = P.walkSpeed * P.sprintMultiplier;
    expect(sprintSpeed / P.groundAcceleration).toBeLessThanOrEqual(0.2);
    expect(sprintSpeed / P.groundDeceleration).toBeLessThanOrEqual(0.25);
    expect(P.airAcceleration).toBeLessThan(P.groundAcceleration);
  });

  it('derives the jump speed from the jump height: v = √(2gh)', () => {
    const v = jumpSpeed(P);
    expect((v * v) / (2 * P.gravity)).toBeCloseTo(P.jumpHeight);
  });

  it('fits the blockout: the jump clears the dock, the duct needs a crouch, stairs need no jump', () => {
    expect(P.jumpHeight).toBeGreaterThan(DOCK_HEIGHT + 0.1);
    expect(P.jumpHeight).toBeLessThan(CATWALK_HEIGHT);
    expect(DUCT_CLEARANCE).toBeGreaterThan(P.crouchHeight);
    expect(DUCT_CLEARANCE).toBeLessThan(P.standHeight);
  });

  it('treats ~49° as the steepest walkable slope and snaps less than a step height', () => {
    expect(Math.acos(P.walkableNormalY) * (180 / Math.PI)).toBeCloseTo(49.5, 0);
    expect(P.groundSnapDistance).toBeLessThan(P.jumpHeight);
    expect(P.coyoteTime).toBeGreaterThan(0);
    expect(P.jumpBufferTime).toBeGreaterThan(0);
  });
});
