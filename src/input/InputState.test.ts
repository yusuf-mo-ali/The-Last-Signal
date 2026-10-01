import { describe, expect, it } from 'vitest';
import { InputState, WheelDeltaMode } from './InputState';

function setup() {
  const input = new InputState();
  const reader = input.createReader();
  return { input, reader };
}

describe('InputState', () => {
  describe('keys: held state and edges', () => {
    it('tracks held state by physical key code', () => {
      const { input } = setup();
      input.keyDown('KeyW');
      expect(input.isKeyDown('KeyW')).toBe(true);
      expect(input.isKeyDown('KeyZ')).toBe(false);
      input.keyUp('KeyW');
      expect(input.isKeyDown('KeyW')).toBe(false);
    });

    it('reports a press once, in the window where it happened', () => {
      const { input, reader } = setup();
      input.keyDown('Space');
      reader.sample();
      expect(reader.wasKeyPressed('Space')).toBe(true);
      expect(reader.wasKeyReleased('Space')).toBe(false);

      reader.sample(); // next frame, still held
      expect(reader.wasKeyPressed('Space')).toBe(false);
      expect(reader.isKeyDown('Space')).toBe(true);

      input.keyUp('Space');
      reader.sample();
      expect(reader.wasKeyReleased('Space')).toBe(true);
      expect(reader.isKeyDown('Space')).toBe(false);
    });

    it('does not lose a tap that starts and ends inside one window', () => {
      const { input, reader } = setup();
      input.keyDown('KeyR');
      input.keyUp('KeyR');
      reader.sample();
      expect(reader.wasKeyPressed('KeyR')).toBe(true);
      expect(reader.wasKeyReleased('KeyR')).toBe(true);
      expect(reader.isKeyDown('KeyR')).toBe(false);
    });

    it('ignores auto-repeat and duplicate key-downs while held', () => {
      const { input, reader } = setup();
      input.keyDown('KeyW');
      reader.sample();
      input.keyDown('KeyW');
      input.keyDown('KeyW');
      reader.sample();
      expect(reader.wasKeyPressed('KeyW')).toBe(false);
    });

    it('ignores a release with no recorded press, and empty codes', () => {
      const { input, reader } = setup();
      input.keyUp('KeyQ');
      input.keyDown('');
      reader.sample();
      expect(reader.wasKeyReleased('KeyQ')).toBe(false);
      expect(input.isKeyDown('')).toBe(false);
    });

    it('reports nothing that happened before the reader was created', () => {
      const input = new InputState();
      input.keyDown('KeyE');
      const late = input.createReader();
      late.sample();
      expect(late.wasKeyPressed('KeyE')).toBe(false);
      expect(late.isKeyDown('KeyE')).toBe(true); // held state is always live
    });
  });

  describe('mouse buttons', () => {
    it('tracks held state and edges per button', () => {
      const { input, reader } = setup();
      input.buttonDown(0);
      input.buttonDown(2);
      reader.sample();
      expect(reader.wasButtonPressed(0)).toBe(true);
      expect(reader.wasButtonPressed(2)).toBe(true);
      expect(reader.wasButtonPressed(1)).toBe(false);

      input.buttonUp(0);
      reader.sample();
      expect(reader.wasButtonReleased(0)).toBe(true);
      expect(reader.isButtonDown(0)).toBe(false);
      expect(reader.isButtonDown(2)).toBe(true);
    });
  });

  describe('independent readers (frame vs fixed step)', () => {
    it('lets every reader see each press exactly once, at its own pace', () => {
      const { input } = setup();
      const frame = input.createReader();
      const step = input.createReader();

      input.keyDown('Space');
      // A 240 Hz frame with no fixed step: the frame reader sees the press...
      frame.sample();
      expect(frame.wasKeyPressed('Space')).toBe(true);
      // ...a later frame does not see it again...
      frame.sample();
      expect(frame.wasKeyPressed('Space')).toBe(false);
      // ...and the step reader, sampled only now, still sees it once.
      step.sample();
      expect(step.wasKeyPressed('Space')).toBe(true);
      step.sample();
      expect(step.wasKeyPressed('Space')).toBe(false);
    });

    it('discard() drops everything gathered so far', () => {
      const { input, reader } = setup();
      input.keyDown('KeyE');
      input.buttonDown(0);
      input.mouseMove(40, 10);
      input.wheel(300);

      reader.discard();
      expect(reader.wasKeyPressed('KeyE')).toBe(false);
      reader.sample();
      expect(reader.wasKeyPressed('KeyE')).toBe(false);
      expect(reader.wasButtonPressed(0)).toBe(false);
      expect(reader.mouseDeltaX).toBe(0);
      expect(reader.wheelStepsDown).toBe(0);
      expect(reader.isKeyDown('KeyE')).toBe(true);
    });
  });

  describe('mouse movement', () => {
    it('accumulates every event in a window, then starts from zero in the next', () => {
      const { input, reader } = setup();
      input.mouseMove(3, -2);
      input.mouseMove(4.5, 1);
      input.mouseMove(-1, 0.25);
      reader.sample();
      expect(reader.mouseDeltaX).toBeCloseTo(6.5);
      expect(reader.mouseDeltaY).toBeCloseTo(-0.75);

      reader.sample(); // no motion since
      expect(reader.mouseDeltaX).toBe(0);
      expect(reader.mouseDeltaY).toBe(0);

      input.mouseMove(10, 20);
      reader.sample();
      expect(reader.mouseDeltaX).toBe(10);
      expect(reader.mouseDeltaY).toBe(20);
    });

    it('keeps the deltas stable until the next sample, however often they are read', () => {
      const { input, reader } = setup();
      input.mouseMove(5, 5);
      reader.sample();
      input.mouseMove(100, 100); // arrives after the sample: belongs to the next window
      expect(reader.mouseDeltaX).toBe(5);
      expect(reader.mouseDeltaX).toBe(5);
      reader.sample();
      expect(reader.mouseDeltaX).toBe(100);
    });

    it('discards glitch-sized and non-finite events (D-017)', () => {
      const input = new InputState({ maxMotionPerEvent: 500 });
      const reader = input.createReader();
      input.mouseMove(12, 0);
      input.mouseMove(4000, 0); // Chromium movementX spike
      input.mouseMove(0, -900);
      input.mouseMove(Number.NaN, 1);
      input.mouseMove(3, Number.POSITIVE_INFINITY);
      reader.sample();
      expect(reader.mouseDeltaX).toBe(12);
      expect(reader.mouseDeltaY).toBe(0);
      expect(input.discardedMotionEvents).toBe(4);
    });

    it('accepts large but plausible flicks under the default limit', () => {
      const { input, reader } = setup();
      input.mouseMove(1200, -800);
      reader.sample();
      expect(reader.mouseDeltaX).toBe(1200);
    });
  });

  describe('mouse wheel', () => {
    it('turns one mouse notch into one step, in each browser delta mode', () => {
      const cases: [number, number][] = [
        [100, WheelDeltaMode.PIXEL], // Chrome / Edge
        [3, WheelDeltaMode.LINE], // Firefox
        [1, WheelDeltaMode.PAGE],
      ];
      for (const [delta, mode] of cases) {
        const { input, reader } = setup();
        input.wheel(delta, mode);
        reader.sample();
        expect(reader.wheelStepsDown).toBe(1);
        expect(reader.wheelStepsUp).toBe(0);
      }
    });

    it('counts direction: negative delta is up', () => {
      const { input, reader } = setup();
      input.wheel(-200);
      reader.sample();
      expect(reader.wheelStepsUp).toBe(2);
      expect(reader.wheelStepsDown).toBe(0);
    });

    it('accumulates small trackpad deltas into whole steps, carrying the remainder', () => {
      const { input, reader } = setup();
      for (let i = 0; i < 7; i++) {
        input.wheel(30); // 210 px total
      }
      reader.sample();
      expect(reader.wheelStepsDown).toBe(2);
      input.wheel(90); // remainder 10 + 90 = one more notch
      reader.sample();
      expect(reader.wheelStepsDown).toBe(1);
    });

    it('lets opposite motion cancel before it makes a step', () => {
      const { input, reader } = setup();
      input.wheel(60);
      input.wheel(-60);
      reader.sample();
      expect(reader.wheelStepsDown + reader.wheelStepsUp).toBe(0);
    });

    it('ignores invalid deltas and unknown modes', () => {
      const { input, reader } = setup();
      input.wheel(Number.NaN);
      input.wheel(500, 7);
      reader.sample();
      expect(reader.wheelStepsDown).toBe(0);
    });
  });

  describe('releaseAll (focus loss)', () => {
    it('releases every held key and button and records the releases', () => {
      const { input, reader } = setup();
      input.keyDown('KeyW');
      input.keyDown('ShiftLeft');
      input.buttonDown(0);
      reader.sample();

      input.releaseAll();
      reader.sample();

      expect(input.isKeyDown('KeyW')).toBe(false);
      expect(input.isKeyDown('ShiftLeft')).toBe(false);
      expect(input.isButtonDown(0)).toBe(false);
      expect(reader.wasKeyReleased('KeyW')).toBe(true);
      expect(reader.wasButtonReleased(0)).toBe(true);
    });

    it('clears a partial wheel notch', () => {
      const { input, reader } = setup();
      input.wheel(90);
      input.releaseAll();
      input.wheel(20);
      reader.sample();
      expect(reader.wheelStepsDown).toBe(0);
    });
  });
});
