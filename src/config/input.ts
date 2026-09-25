/**
 * Default input bindings (GAME_DESIGN.md §4.1, D-017). Pure data: rebinding later only swaps this
 * table, never the code that reads it.
 *
 * Keys are `KeyboardEvent.code` values, which name the *physical* key position: `KeyW` is the key
 * left of `KeyE` on every layout, so AZERTY players press their Z key and still move forward.
 */

/** `MouseEvent.button` values. */
export const MouseButton = {
  LEFT: 0,
  MIDDLE: 1,
  RIGHT: 2,
  BACK: 3,
  FORWARD: 4,
} as const;
export type MouseButton = (typeof MouseButton)[keyof typeof MouseButton];

export type WheelDirection = 'up' | 'down';

/** One physical input that can trigger an action. */
export type Binding =
  { readonly key: string } | { readonly mouse: MouseButton } | { readonly wheel: WheelDirection };

export const INPUT_ACTIONS = [
  'moveForward',
  'moveBackward',
  'moveLeft',
  'moveRight',
  'sprint',
  'crouch',
  'jump',
  'fire',
  'aim',
  'reload',
  'weapon1',
  'weapon2',
  'weapon3',
  'weaponNext',
  'weaponPrevious',
  'interact',
  'melee',
  'pause',
] as const;
export type InputAction = (typeof INPUT_ACTIONS)[number];

export type InputBindings = Readonly<Record<InputAction, readonly Binding[]>>;

const key = (code: string): Binding => ({ key: code });
const mouse = (button: MouseButton): Binding => ({ mouse: button });
const wheel = (direction: WheelDirection): Binding => ({ wheel: direction });

export const DEFAULT_BINDINGS: InputBindings = {
  moveForward: [key('KeyW')],
  moveBackward: [key('KeyS')],
  moveLeft: [key('KeyA')],
  moveRight: [key('KeyD')],
  sprint: [key('ShiftLeft'), key('ShiftRight')],
  // Not Ctrl: pages cannot block Ctrl+W, so crouch-walking forward would close the tab (D-017).
  // `ControlLeft` remains available as an opt-in rebind.
  crouch: [key('KeyC')],
  jump: [key('Space')],
  fire: [mouse(MouseButton.LEFT)],
  aim: [mouse(MouseButton.RIGHT)],
  reload: [key('KeyR')],
  weapon1: [key('Digit1')],
  weapon2: [key('Digit2')],
  weapon3: [key('Digit3')],
  weaponNext: [wheel('down')],
  weaponPrevious: [wheel('up')],
  interact: [key('KeyE')], // [Proposed, O-6]
  melee: [key('KeyV')], // [Proposed, O-6]
  // While the pointer is locked the browser consumes Esc to release the lock; the game then pauses
  // on the lock loss (D-017). This binding covers Esc presses while the pointer is free.
  pause: [key('Escape')],
};

/** The optional crouch binding named in the plan (§3), for players who opt in. */
export const CTRL_CROUCH_BINDING: Binding = key('ControlLeft');

/** A physical input bound to more than one action. */
export interface BindingConflict {
  readonly binding: string;
  readonly actions: readonly InputAction[];
}

/** Lists physical inputs bound to more than one action (a rebinding mistake). */
export function findBindingConflicts(bindings: InputBindings): BindingConflict[] {
  const byInput = new Map<string, InputAction[]>();
  for (const action of INPUT_ACTIONS) {
    for (const binding of bindings[action]) {
      const id = describeBinding(binding);
      byInput.set(id, [...(byInput.get(id) ?? []), action]);
    }
  }
  return [...byInput]
    .filter(([, actions]) => actions.length > 1)
    .map(([binding, actions]) => ({ binding, actions }));
}

/** Every keyboard code used by `bindings`; the browser layer suppresses their default actions. */
export function boundKeyCodes(bindings: InputBindings): ReadonlySet<string> {
  const codes = new Set<string>();
  for (const action of INPUT_ACTIONS) {
    for (const binding of bindings[action]) {
      if ('key' in binding) {
        codes.add(binding.key);
      }
    }
  }
  return codes;
}

/** A stable, readable id for a binding, e.g. `key:KeyW`, `mouse:0`, `wheel:down`. */
export function describeBinding(binding: Binding): string {
  if ('key' in binding) {
    return `key:${binding.key}`;
  }
  if ('mouse' in binding) {
    return `mouse:${binding.mouse}`;
  }
  return `wheel:${binding.wheel}`;
}
