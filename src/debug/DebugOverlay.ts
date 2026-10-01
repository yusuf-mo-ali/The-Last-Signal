/**
 * Development-only stats panel (D-020). Plain text in a fixed `<pre>`; written a few times per
 * second, never per frame. Excluded from production bundles with the rest of `debug/`.
 */

export class DebugOverlay {
  readonly element: HTMLPreElement;

  constructor(container: HTMLElement) {
    this.element = container.ownerDocument.createElement('pre');
    this.element.className = 'debug-overlay';
    this.element.setAttribute('aria-hidden', 'true');
    container.appendChild(this.element);
  }

  get visible(): boolean {
    return !this.element.hidden;
  }

  setVisible(visible: boolean): void {
    this.element.hidden = !visible;
  }

  setText(text: string): void {
    this.element.textContent = text;
  }

  dispose(): void {
    this.element.remove();
  }
}
