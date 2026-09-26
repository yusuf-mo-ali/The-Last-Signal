/**
 * Fixed-step timer helpers shared by the weapons (D-004, D-040).
 */

/** Tolerance for timers that land on a step boundary (floating-point sums of 1/60 s). */
export const TIMER_EPSILON = 1e-9;

/**
 * Advances a shot cooldown by one step. Crossing zero during the step leaves the (negative)
 * remainder so the next interval is shortened by it; a cooldown already at or below zero resets
 * to zero, so readiness is never banked.
 */
export function stepCooldown(cooldown: number, dt: number): number {
  return cooldown > TIMER_EPSILON ? cooldown - dt : 0;
}

/** Counts a timer down by one step; a residue from summing 1/60 s steps counts as finished. */
export function countDown(remaining: number, dt: number): number {
  const next = remaining - dt;
  return next > TIMER_EPSILON ? next : 0;
}
