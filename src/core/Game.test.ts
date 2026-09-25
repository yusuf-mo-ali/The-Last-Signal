import { describe, expect, it, vi } from 'vitest';
import { BEACON_ANGULAR_SPEED, TestScene } from '../world/TestScene';
import { FROZEN_STATES, Game, type FrameScheduler, type Presentation } from './Game';
import { ALL_GAME_STATES, InvalidTransitionError } from './GameState';

/** A requestAnimationFrame stand-in: frames fire only when the test says so. */
class ManualFrames implements FrameScheduler {
  private nextHandle = 1;
  private readonly callbacks = new Map<number, (timestampMs: number) => void>();

  get pending(): number {
    return this.callbacks.size;
  }

  request(callback: (timestampMs: number) => void): number {
    const handle = this.nextHandle++;
    this.callbacks.set(handle, callback);
    return handle;
  }

  cancel(handle: number): void {
    this.callbacks.delete(handle);
  }

  /** Fires every pending callback with `timestampMs`, like one browser animation frame. */
  fire(timestampMs: number): void {
    const due = [...this.callbacks.values()];
    this.callbacks.clear();
    for (const callback of due) {
      callback(timestampMs);
    }
  }

  /** Fires `count` frames `intervalMs` apart, starting at `startMs`. Returns the next timestamp. */
  run(count: number, intervalMs: number, startMs = 0): number {
    let t = startMs;
    for (let i = 0; i < count; i++) {
      this.fire(t);
      t += intervalMs;
    }
    return t;
  }
}

const FRAME_60 = 1000 / 60;

function startedGame() {
  const game = new Game({ strict: true });
  const scene = new TestScene();
  game.addSystem(scene);
  const frames = new ManualFrames();
  game.start(frames);
  return { game, scene, frames };
}

function enterRun(game: Game): void {
  game.state.transition('LOADING');
  game.state.transition('PLAYING');
}

describe('Game', () => {
  describe('construction (headless, D-003)', () => {
    it('is created in Node with no browser, renderer or presentation', () => {
      const game = new Game();
      expect(game.state.current).toBe('BOOT');
      expect(game.isRunning).toBe(false);
      expect(game.time.scale).toBe(1);
      expect(game.time.stepCount).toBe(0);
    });

    it('passes strict mode to the state machine', () => {
      expect(() => new Game({ strict: true }).state.transition('VICTORY')).toThrow(
        InvalidTransitionError,
      );
      expect(new Game().state.transition('VICTORY')).toBe(false);
    });

    it('passes time options to the clock', () => {
      const game = new Game({ time: { fixedDt: 1 / 30 } });
      expect(game.time.fixedDt).toBe(1 / 30);
    });
  });

  describe('frame loop', () => {
    it('leaves BOOT for MAIN_MENU on start and requests the first frame', () => {
      const { game, frames } = startedGame();
      expect(game.state.current).toBe('MAIN_MENU');
      expect(game.isRunning).toBe(true);
      expect(frames.pending).toBe(1);
    });

    it('ignores a second start while running', () => {
      const { game, frames } = startedGame();
      game.start(frames);
      expect(frames.pending).toBe(1);
    });

    it('runs one fixed step per 60 Hz frame; the first frame only sets the time base', () => {
      const { game, scene, frames } = startedGame();

      frames.run(61, FRAME_60);

      expect(game.time.stepCount).toBe(60);
      expect(scene.steps).toBe(60);
      expect(game.time.simTime).toBeCloseTo(1);
      expect(frames.pending).toBe(1); // still looping
    });

    it('decouples simulation rate from display rate (144 Hz and 30 Hz)', () => {
      const fast = startedGame();
      fast.frames.run(145, 1000 / 144);
      expect(Math.abs(fast.game.time.stepCount - 60)).toBeLessThanOrEqual(1);

      const slow = startedGame();
      slow.frames.run(31, 1000 / 30);
      expect(slow.game.time.stepCount).toBe(60);
    });

    it('advances the test scene exactly by its fixed steps', () => {
      const { game, scene, frames } = startedGame();
      frames.run(31, FRAME_60);
      expect(scene.angle).toBeCloseTo(
        game.time.stepCount * game.time.fixedDt * BEACON_ANGULAR_SPEED,
      );
    });

    it('caps a long hitch (e.g. a background tab) instead of catching up', () => {
      const { game, frames } = startedGame();
      frames.fire(0);
      frames.fire(5000); // 5 s gap

      expect(game.time.stepCount).toBe(game.time.maxStepsPerFrame);
      frames.fire(5000 + FRAME_60);
      expect(game.time.stepCount).toBe(game.time.maxStepsPerFrame + 1);
    });
  });

  describe('presentation', () => {
    it('renders once per frame, after the fixed steps, with alpha in [0, 1) and the frame time', () => {
      const game = new Game();
      const scene = new TestScene();
      game.addSystem(scene);
      const calls: { alpha: number; frameDt: number; stepsSoFar: number }[] = [];
      game.setPresentation({
        render: (alpha, frameDt) => calls.push({ alpha, frameDt, stepsSoFar: scene.steps }),
      });
      const frames = new ManualFrames();
      game.start(frames);

      frames.fire(0);
      frames.fire(FRAME_60 * 1.5); // 1.5 steps owed: 1 runs, alpha 0.5

      expect(calls).toHaveLength(2);
      expect(calls[1]?.stepsSoFar).toBe(1);
      expect(calls[1]?.alpha).toBeCloseTo(0.5);
      expect(calls[1]?.frameDt).toBeCloseTo(0.025);
      for (const call of calls) {
        expect(call.alpha).toBeGreaterThanOrEqual(0);
        expect(call.alpha).toBeLessThan(1);
      }
    });

    it('lets the view interpolate smoothly between fixed steps', () => {
      const game = new Game();
      const scene = new TestScene();
      game.addSystem(scene);
      const drawn: number[] = [];
      game.setPresentation({ render: (alpha) => drawn.push(scene.interpolatedAngle(alpha)) });

      // 240 Hz display: four frames per simulation step.
      for (let i = 0; i < 40; i++) {
        game.frame(1 / 240);
      }

      for (let i = 1; i < drawn.length; i++) {
        expect((drawn[i] ?? 0) - (drawn[i - 1] ?? 0)).toBeGreaterThanOrEqual(0);
      }
      expect(new Set(drawn.map((a) => a.toFixed(6))).size).toBeGreaterThan(game.time.stepCount);
    });

    it('can be removed to run headless', () => {
      const game = new Game();
      const render = vi.fn();
      const presentation: Presentation = { render };
      game.setPresentation(presentation);
      game.setPresentation(null);

      expect(game.frame(1 / 60)).toBe(1);
      expect(render).not.toHaveBeenCalled();
    });
  });

  describe('time scale follows the game state', () => {
    it('freezes simulated time exactly in PAUSED and UPGRADE_SELECTION', () => {
      expect([...FROZEN_STATES].sort()).toEqual(['PAUSED', 'UPGRADE_SELECTION']);
    });

    it('stops fixed steps while paused, keeps rendering, and resumes without a burst', () => {
      const { game, frames } = startedGame();
      const render = vi.fn();
      game.setPresentation({ render });
      enterRun(game);
      let t = frames.run(11, FRAME_60);
      const before = game.time.stepCount;

      game.state.pause();
      expect(game.time.scale).toBe(0);
      t = frames.run(120, FRAME_60, t);
      expect(game.time.stepCount).toBe(before);
      expect(render).toHaveBeenCalledTimes(131);

      game.state.resume();
      expect(game.time.scale).toBe(1);
      frames.fire(t);
      expect(game.time.stepCount).toBe(before + 1);
    });

    it('freezes during upgrade selection and runs again on the next wave', () => {
      const { game, frames } = startedGame();
      enterRun(game);
      game.state.transition('WAVE_ACTIVE');
      game.state.transition('WAVE_COMPLETE');
      game.state.transition('UPGRADE_SELECTION');
      const t = frames.run(10, FRAME_60);
      expect(game.time.stepCount).toBe(0);

      game.state.transition('WAVE_START');
      frames.run(10, FRAME_60, t);
      expect(game.time.stepCount).toBe(10);
    });

    it('runs at full speed in every other state', () => {
      for (const state of ALL_GAME_STATES.filter((s) => !FROZEN_STATES.has(s))) {
        const game = new Game();
        // Force the clock into the paused scale, then enter `state` through a legal path.
        game.time.scale = 0;
        const path = {
          BOOT: [],
          MAIN_MENU: ['MAIN_MENU'],
          LOADING: ['MAIN_MENU', 'LOADING'],
          PLAYING: ['MAIN_MENU', 'LOADING', 'PLAYING'],
          WAVE_START: ['MAIN_MENU', 'LOADING', 'PLAYING'],
          WAVE_ACTIVE: ['MAIN_MENU', 'LOADING', 'PLAYING', 'WAVE_ACTIVE'],
          BOSS: ['MAIN_MENU', 'LOADING', 'PLAYING', 'BOSS'],
          WAVE_COMPLETE: ['MAIN_MENU', 'LOADING', 'PLAYING', 'BOSS', 'WAVE_COMPLETE'],
          GAME_OVER: ['MAIN_MENU', 'LOADING', 'PLAYING', 'GAME_OVER'],
          VICTORY: ['MAIN_MENU', 'LOADING', 'PLAYING', 'BOSS', 'WAVE_COMPLETE', 'VICTORY'],
        } as const;
        const steps = path[state as keyof typeof path];
        if (steps.length === 0) {
          continue; // BOOT is never re-entered; its scale is the initial 1 (checked above)
        }
        for (const step of steps) {
          game.state.transition(step);
        }
        expect(game.time.scale).toBe(1);
      }
    });
  });

  describe('stop, errors and disposal', () => {
    it('stop() cancels the pending frame, and a restart does not catch up on stopped time', () => {
      const { game, frames } = startedGame();
      frames.run(10, FRAME_60);
      const before = game.time.stepCount;

      game.stop();
      expect(game.isRunning).toBe(false);
      expect(frames.pending).toBe(0);

      game.start(frames);
      frames.fire(60_000); // a minute later: first frame after restart only sets the time base
      expect(game.time.stepCount).toBe(before);
      frames.fire(60_000 + FRAME_60);
      expect(game.time.stepCount).toBe(before + 1);
    });

    it('does not re-enter BOOT handling on restart', () => {
      const { game, frames } = startedGame();
      enterRun(game);
      game.stop();
      game.start(frames);
      expect(game.state.current).toBe('WAVE_START');
    });

    it('can be stopped from inside a frame', () => {
      const { game, frames } = startedGame();
      game.addSystem({
        fixedUpdate: () => {
          game.stop();
        },
      });

      frames.fire(0);
      frames.fire(FRAME_60);

      expect(game.isRunning).toBe(false);
      expect(frames.pending).toBe(0);
    });

    it('stops the loop and rethrows when a frame throws, instead of failing every frame', () => {
      const { game, frames } = startedGame();
      const boom = new Error('boom');
      game.setPresentation({
        render: () => {
          throw boom;
        },
      });

      expect(() => {
        frames.fire(0);
      }).toThrow(boom);
      expect(game.isRunning).toBe(false);
      expect(frames.pending).toBe(0);
    });

    it('runs systems in registration order and stops calling removed ones', () => {
      const game = new Game();
      const order: string[] = [];
      game.addSystem({ fixedUpdate: () => order.push('a') });
      const removeB = game.addSystem({ fixedUpdate: () => order.push('b') });
      game.addSystem({ fixedUpdate: () => order.push('c') });

      game.frame(1 / 60);
      removeB();
      game.frame(1 / 60);

      expect(order).toEqual(['a', 'b', 'c', 'a', 'c']);
    });

    it('dispose() stops the loop and detaches systems, presentation and state listeners', () => {
      const { game, scene, frames } = startedGame();
      const render = vi.fn();
      game.setPresentation({ render });
      frames.run(5, FRAME_60);
      const steps = scene.steps;

      game.dispose();
      expect(frames.pending).toBe(0);
      game.frame(1 / 60);
      expect(scene.steps).toBe(steps);
      expect(render).toHaveBeenCalledTimes(5);

      enterRun(game);
      game.state.pause();
      expect(game.time.scale).toBe(1); // the state listener was removed
    });
  });
});
