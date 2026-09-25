/**
 * Shared helpers for the end-to-end specs. Everything passed to `page.evaluate` runs in the
 * browser, so it only uses browser APIs and the development-only `window.tls` interface.
 */

import { expect, test as base, type Page, type TestInfo } from '@playwright/test';
import type { ErrorHandler } from '../../src/core/ErrorHandler';
import type { Game } from '../../src/core/Game';
import type { ActionMap } from '../../src/input/ActionMap';
import type { InputState } from '../../src/input/InputState';
import type { PointerLock } from '../../src/input/PointerLock';
import type { Renderer } from '../../src/render/Renderer';
import type { PerspectiveCamera } from 'three';
import type { ViewSettings } from '../../src/core/Config';
import type { Player } from '../../src/player/Player';
import type { World } from '../../src/world/World';

/** What `tls.inspect()` returns in development builds (see src/debug/installDebug.ts). */
export interface DevHandles {
  readonly game: Game;
  readonly renderer: Renderer;
  readonly input: InputState;
  readonly pointerLock: PointerLock;
  readonly errors: ErrorHandler;
  readonly world: World;
  readonly player: Player;
  readonly camera: PerspectiveCamera;
  readonly frameActions: ActionMap;
}

/** What `tls.player()` returns. */
export interface PlayerSnapshot {
  readonly position: [number, number, number];
  readonly velocity: [number, number, number];
  readonly speed: number;
  readonly grounded: boolean;
  readonly crouched: boolean;
  readonly sprinting: boolean;
  readonly eyeHeight: number;
  readonly yaw: number;
  readonly pitch: number;
  readonly respawns: number;
  readonly groundDistance: number;
}

/** The `window.tls` commands used by the specs (see src/debug/installDebug.ts). */
export interface TlsApi {
  inspect(): DevHandles;
  help(): readonly { name: string; available: boolean }[];
  state(): unknown;
  stats(): { overlayVisible: boolean };
  giveAmmo(): unknown;
  player(): PlayerSnapshot;
  teleportPlayer(x: number, y: number, z: number, yaw?: number): unknown;
  look(yaw: number, pitch?: number): unknown;
  view(changes?: Partial<ViewSettings>): ViewSettings;
  loseContext(): unknown;
  restoreContext(): unknown;
  throwError(kind?: 'frame' | 'async' | 'rejection'): unknown;
}

declare global {
  interface Window {
    tls?: TlsApi;
  }
}

export interface PageIssue {
  readonly type: string;
  readonly text: string;
}

/** Console messages, page errors, failed requests and HTTP errors seen by a page. */
export class IssueLog {
  readonly entries: PageIssue[] = [];
  readonly requests: string[] = [];

  attach(page: Page): void {
    page.on('console', (m) => this.entries.push({ type: m.type(), text: m.text() }));
    page.on('pageerror', (e) => this.entries.push({ type: 'pageerror', text: e.message }));
    page.on('requestfailed', (r) => this.entries.push({ type: 'requestfailed', text: r.url() }));
    page.on('request', (r) => this.requests.push(r.url()));
    page.on('response', (r) => {
      if (r.status() >= 400) {
        this.entries.push({ type: 'http', text: `${r.status()} ${r.url()}` });
      }
    });
  }

  /** Errors, warnings, page errors, failed requests and HTTP errors not matched by `allow`. */
  problems(allow: readonly RegExp[] = []): PageIssue[] {
    return this.entries.filter(
      (e) =>
        ['error', 'warning', 'pageerror', 'requestfailed', 'http'].includes(e.type) &&
        !allow.some((re) => re.test(e.text)),
    );
  }
}

/** `test` with an `issues` fixture attached to the page before any navigation. */
export const test = base.extend<{ issues: IssueLog }>({
  issues: async ({ page }, use) => {
    const log = new IssueLog();
    log.attach(page);
    await use(log);
  },
});
export { expect };

/** True in the development build (debug tools available). */
export function isDev(testInfo: TestInfo): boolean {
  return testInfo.project.name === 'dev';
}

/** Opens the game (optionally with a query, e.g. `?quality=ultra`) and waits for a few frames. */
export async function openGame(page: Page, query = ''): Promise<void> {
  await page.goto(`/${query}`);
  await page.locator('canvas.game-canvas').waitFor();
  await frames(page, 10);
}

/** Resolves after `n` browser animation frames. */
export async function frames(page: Page, n = 4): Promise<void> {
  await page.evaluate(
    (count) =>
      new Promise<void>((resolve) => {
        let i = 0;
        const tick = (): void => {
          if (++i >= count) {
            resolve();
          } else {
            requestAnimationFrame(tick);
          }
        };
        requestAnimationFrame(tick);
      }),
    n,
  );
}

export async function canvasSize(page: Page) {
  return page.evaluate(() => {
    const c = document.querySelector<HTMLCanvasElement>('canvas.game-canvas');
    return c
      ? { width: c.width, height: c.height, cssWidth: c.clientWidth, cssHeight: c.clientHeight }
      : null;
  });
}

export async function lockPrompt(page: Page) {
  return page.evaluate(() => {
    const p = document.querySelector<HTMLElement>('.lock-prompt');
    return p ? { mode: p.dataset.mode ?? null, hidden: p.hidden } : null;
  });
}

export async function statusScreen(page: Page) {
  return page.evaluate(() => {
    const s = document.querySelector<HTMLElement>('.status-screen');
    if (!s) {
      return null;
    }
    const text = (selector: string): string | null => {
      const el = s.querySelector<HTMLElement>(selector);
      return el && !el.hidden ? el.textContent : null;
    };
    return {
      mode: s.dataset.mode ?? null,
      hidden: s.hidden,
      title: text('.status-screen__title'),
      message: text('.status-screen__message'),
      details: text('.status-screen__details') !== null,
      steps: s.querySelectorAll('.status-screen__steps li').length,
      action: text('.status-screen__action'),
    };
  });
}

export async function isPointerLocked(page: Page): Promise<boolean> {
  return page.evaluate(() => document.pointerLockElement === document.querySelector('canvas'));
}

/**
 * Colour statistics of a screenshot, decoded inside the browser (no image library needed):
 * `colors` = distinct coarse colours, `red` = pixels of the red signal beacon, `redX` = their mean
 * horizontal position (0 = left edge, 1 = right edge; NaN when there are none).
 */
export async function pixelStats(
  page: Page,
): Promise<{ colors: number; red: number; redX: number }> {
  const png = (await page.screenshot()).toString('base64');
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('2D canvas unavailable');
    }
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, img.width, img.height).data;
    const colors = new Set<string>();
    let red = 0;
    let redXSum = 0;
    for (let i = 0; i < data.length; i += 4 * 97) {
      const r = data[i] ?? 0;
      const g = data[i + 1] ?? 0;
      const b = data[i + 2] ?? 0;
      colors.add(`${r >> 3},${g >> 3},${b >> 3}`);
      if (r > 120 && g < 90) {
        red++;
        redXSum += ((i / 4) % img.width) / img.width;
      }
    }
    return { colors: colors.size, red, redX: red > 0 ? redXSum / red : Number.NaN };
  }, png);
}

/** Holds `keys` down for `ms` of real time, then releases them. */
export async function holdKeys(page: Page, keys: readonly string[], ms: number): Promise<void> {
  for (const key of keys) {
    await page.keyboard.down(key);
  }
  await page.waitForTimeout(ms);
  for (const key of [...keys].reverse()) {
    await page.keyboard.up(key);
  }
}

/** Puts the dev build into a run (WAVE_START) without capturing the mouse. */
export async function enterRun(page: Page): Promise<void> {
  await page.evaluate(() => {
    const { game } = window.tls!.inspect();
    game.state.transition('LOADING');
    game.state.transition('PLAYING');
  });
}
