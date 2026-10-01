import { describe, expect, it } from 'vitest';
import { Game } from '../core/Game';
import { InputState } from './InputState';
import { attachStepInput } from './stepInput';

function setup() {
  const game = new Game({ strict: true });
  const input = new InputState();
  const reader = input.createReader();
  const detach = attachStepInput(game, reader);
  const seen: boolean[] = [];
  // A gameplay system registered *after* attaching still sees the step's input.
  game.addSystem({ fixedUpdate: () => seen.push(reader.wasKeyPressed('Space')) });
  return { game, input, reader, seen, detach };
}

const STEP = 1 / 60;

describe('attachStepInput', () => {
  it('delivers a tap to exactly one fixed step, even across frames with no step', () => {
    const { game, input, seen } = setup();
    input.keyDown('Space');
    input.keyUp('Space');

    // 240 Hz: three frames with no fixed step, then one with a step.
    game.frame(STEP / 4);
    game.frame(STEP / 4);
    game.frame(STEP / 4);
    expect(seen).toEqual([]);
    game.frame(STEP / 4);
    game.frame(STEP);

    expect(seen).toEqual([true, false]);
  });

  it('shows a tap to only the first of several steps in one frame (no double jump)', () => {
    const { game, input, seen } = setup();
    input.keyDown('Space');
    game.frame(STEP * 3);
    expect(seen).toEqual([true, false, false]);
  });

  it('samples before systems registered earlier too', () => {
    const game = new Game();
    const input = new InputState();
    const reader = input.createReader();
    const seen: boolean[] = [];
    game.addSystem({ fixedUpdate: () => seen.push(reader.wasKeyPressed('KeyE')) });
    attachStepInput(game, reader);

    input.keyDown('KeyE');
    game.frame(STEP);

    expect(seen).toEqual([true]);
  });

  it('discards input gathered while paused, so the resume click is not a shot', () => {
    const { game, input, seen } = setup();
    game.start({ request: () => 1, cancel: () => undefined });
    game.state.transition('LOADING');
    game.state.transition('PLAYING');
    game.state.pause();

    input.keyDown('Space'); // pressed while paused
    game.frame(STEP); // frozen: no steps
    game.state.resume();
    game.frame(STEP);

    expect(seen).toEqual([false]);
  });

  it('discards input gathered on the upgrade screen', () => {
    const { game, input, seen } = setup();
    for (const s of [
      'MAIN_MENU',
      'LOADING',
      'PLAYING',
      'WAVE_ACTIVE',
      'WAVE_COMPLETE',
      'UPGRADE_SELECTION',
    ] as const) {
      game.state.transition(s);
    }
    input.keyDown('Space');
    game.frame(STEP);
    game.state.transition('WAVE_START');
    game.frame(STEP);
    expect(seen).toEqual([false]);
  });

  it('keeps input across ordinary state changes', () => {
    const { game, input, seen } = setup();
    game.state.transition('MAIN_MENU');
    input.keyDown('Space');
    game.state.transition('LOADING');
    game.frame(STEP);
    expect(seen).toEqual([true]);
  });

  it('can be detached', () => {
    const { game, input, reader, seen, detach } = setup();
    detach();
    input.keyDown('Space');
    game.frame(STEP);
    expect(seen).toEqual([false]); // no longer sampled per step
    reader.sample();
    expect(reader.wasKeyPressed('Space')).toBe(true);
  });
});
