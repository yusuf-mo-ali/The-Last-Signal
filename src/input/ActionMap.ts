/**
 * Maps game actions ("fire", "moveForward") to physical inputs through a bindings table
 * (`config/input.ts`). Gameplay code asks about actions, never about keys, so rebinding needs no
 * code changes.
 */

import type { Binding, InputAction, InputBindings } from '../config/input';
import type { InputReader } from './InputState';

export class ActionMap {
  private readonly reader: InputReader;
  private bindings: InputBindings;

  constructor(reader: InputReader, bindings: InputBindings) {
    this.reader = reader;
    this.bindings = bindings;
  }

  /** Replaces the bindings (e.g. after the player rebinds a control). */
  setBindings(bindings: InputBindings): void {
    this.bindings = bindings;
  }

  /** True while any key or mouse binding of `action` is held. Wheel bindings are never "held". */
  isDown(action: InputAction): boolean {
    return this.bindings[action].some((binding) => this.bindingDown(binding));
  }

  /** True if any binding of `action` was pressed (or wheel-stepped) in the reader's window. */
  wasPressed(action: InputAction): boolean {
    return this.bindings[action].some((binding) => this.bindingPressed(binding));
  }

  /** True if any key or mouse binding of `action` was released in the reader's window. */
  wasReleased(action: InputAction): boolean {
    return this.bindings[action].some((binding) => this.bindingReleased(binding));
  }

  private bindingDown(binding: Binding): boolean {
    if ('key' in binding) {
      return this.reader.isKeyDown(binding.key);
    }
    if ('mouse' in binding) {
      return this.reader.isButtonDown(binding.mouse);
    }
    return false;
  }

  private bindingPressed(binding: Binding): boolean {
    if ('key' in binding) {
      return this.reader.wasKeyPressed(binding.key);
    }
    if ('mouse' in binding) {
      return this.reader.wasButtonPressed(binding.mouse);
    }
    return binding.wheel === 'down' ? this.reader.wheelStepsDown > 0 : this.reader.wheelStepsUp > 0;
  }

  private bindingReleased(binding: Binding): boolean {
    if ('key' in binding) {
      return this.reader.wasKeyReleased(binding.key);
    }
    if ('mouse' in binding) {
      return this.reader.wasButtonReleased(binding.mouse);
    }
    return false;
  }
}
