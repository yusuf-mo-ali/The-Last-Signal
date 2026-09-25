/**
 * Full-screen status messages that replace the game view (ARCHITECTURE.md §7.17, D-035):
 * - `webgl-unsupported`: WebGL 2 is missing, with concrete recovery steps;
 * - `error`: a fatal error stopped the game; player-safe message and a reload button;
 * - `context-lost`: the graphics context was lost and the game is waiting for it to return;
 * - `context-lost-timeout`: it did not return; reloading is the fix.
 *
 * All text is set with `textContent`, never HTML, so error messages cannot inject markup.
 */

import type { ErrorReport } from '../core/ErrorHandler';

export type StatusMode = 'webgl-unsupported' | 'error' | 'context-lost' | 'context-lost-timeout';

interface StatusCopy {
  readonly title: string;
  readonly body: string;
  readonly steps?: readonly string[];
  readonly action: string;
}

const COPY: Readonly<Record<StatusMode, StatusCopy>> = {
  'webgl-unsupported': {
    title: 'WebGL 2 is not available',
    body: 'THE LAST SIGNAL needs WebGL 2 to draw its 3D world, and this browser or device is not providing it. You can usually fix this:',
    steps: [
      'Update Chrome, Edge or Firefox to the latest version.',
      'Turn on hardware acceleration (Chrome/Edge: Settings → System; Firefox: Settings → General → Performance), then restart the browser.',
      'Update your graphics drivers.',
      'If it still fails, try another browser or computer.',
    ],
    action: 'Try again',
  },
  error: {
    title: 'Something went wrong',
    body: 'The game hit an unexpected error and stopped. Reloading the page usually fixes this.',
    action: 'Reload',
  },
  'context-lost': {
    title: 'Graphics paused',
    body: 'The browser reset the graphics device. Waiting for it to come back…',
    action: 'Reload now',
  },
  'context-lost-timeout': {
    title: 'Graphics did not recover',
    body: 'The graphics device has not come back. Reloading the page should restore it.',
    action: 'Reload',
  },
};

export interface StatusScreenOptions {
  /** Called by the action button (normally `location.reload()`). */
  readonly onReload: () => void;
  /** Show technical details (stack traces) for errors. Development builds only. */
  readonly showDetails: boolean;
}

export class StatusScreen {
  readonly element: HTMLElement;
  private readonly title: HTMLElement;
  private readonly body: HTMLElement;
  private readonly steps: HTMLOListElement;
  private readonly message: HTMLElement;
  private readonly details: HTMLPreElement;
  private readonly button: HTMLButtonElement;
  private readonly showDetails: boolean;
  private current: StatusMode | null = null;

  constructor(container: HTMLElement, options: StatusScreenOptions) {
    const doc = container.ownerDocument;
    const make = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string) => {
      const el = doc.createElement(tag);
      el.className = className;
      return el;
    };
    this.showDetails = options.showDetails;
    this.element = make('section', 'status-screen');
    this.element.setAttribute('role', 'alert');
    this.element.hidden = true;
    this.title = make('h1', 'status-screen__title');
    this.body = make('p', 'status-screen__body');
    this.steps = make('ol', 'status-screen__steps');
    this.message = make('p', 'status-screen__message');
    this.details = make('pre', 'status-screen__details');
    this.button = make('button', 'status-screen__action');
    this.button.type = 'button';
    this.button.addEventListener('click', options.onReload);
    this.element.append(this.title, this.body, this.steps, this.message, this.details, this.button);
    container.appendChild(this.element);
  }

  get mode(): StatusMode | null {
    return this.current;
  }

  show(mode: StatusMode, report?: ErrorReport): void {
    const copy = COPY[mode];
    this.current = mode;
    this.element.dataset.mode = mode;
    this.title.textContent = copy.title;
    this.body.textContent = copy.body;
    this.steps.replaceChildren(
      ...(copy.steps ?? []).map((step) => {
        const li = this.element.ownerDocument.createElement('li');
        li.textContent = step;
        return li;
      }),
    );
    this.steps.hidden = !copy.steps;
    this.message.textContent = report ? report.message : '';
    this.message.hidden = !report;
    const stack = report?.error instanceof Error ? report.error.stack : undefined;
    this.details.textContent = stack ?? '';
    this.details.hidden = !(this.showDetails && stack);
    this.button.textContent = copy.action;
    this.element.hidden = false;
  }

  hide(): void {
    this.current = null;
    this.element.hidden = true;
  }

  dispose(): void {
    this.element.remove();
  }
}
