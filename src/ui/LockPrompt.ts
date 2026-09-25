/**
 * Minimal "click to play / click to resume" prompt that covers the canvas while the pointer is
 * not locked (D-017). Pointer lock can only be requested from a user gesture, and a re-lock can be
 * refused, so the player needs a visible, clickable target and feedback. Deliberately minimal:
 * the real pause menu replaces it with the UI systems (plan §22).
 */

export type LockPromptMode = 'start' | 'paused' | 'refused' | 'hidden';

const MESSAGES: Readonly<
  Record<Exclude<LockPromptMode, 'hidden'>, { title: string; hint: string }>
> = {
  start: { title: 'Click to play', hint: 'Mouse to look · Esc to release the mouse' },
  paused: { title: 'Paused', hint: 'Click to resume' },
  refused: {
    title: 'Mouse not captured',
    hint: 'The browser refused to capture the mouse. Click again to resume.',
  },
};

export class LockPrompt {
  readonly element: HTMLButtonElement;
  private readonly title: HTMLElement;
  private readonly hint: HTMLElement;
  private current: LockPromptMode = 'hidden';

  constructor(container: HTMLElement, onActivate: () => void) {
    const doc = container.ownerDocument;
    this.element = doc.createElement('button');
    this.element.type = 'button';
    this.element.className = 'lock-prompt';
    this.title = doc.createElement('span');
    this.title.className = 'lock-prompt__title';
    this.hint = doc.createElement('span');
    this.hint.className = 'lock-prompt__hint';
    this.element.append(this.title, this.hint);
    this.element.addEventListener('click', onActivate);
    container.appendChild(this.element);
    this.show('start');
  }

  get mode(): LockPromptMode {
    return this.current;
  }

  show(mode: LockPromptMode): void {
    this.current = mode;
    this.element.dataset.mode = mode;
    this.element.hidden = mode === 'hidden';
    if (mode !== 'hidden') {
      this.title.textContent = MESSAGES[mode].title;
      this.hint.textContent = MESSAGES[mode].hint;
    }
  }

  dispose(): void {
    this.element.remove();
  }
}
