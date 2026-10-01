/**
 * Global error handling (ARCHITECTURE.md §7.17, D-035).
 *
 * Any uncaught error or unhandled promise rejection is treated as fatal: the game stops and the
 * player sees a safe screen offering a reload, instead of a frozen or half-working game.
 * Nothing is swallowed:
 * - For uncaught `error` / `unhandledrejection` events the browser's default handling is left in
 *   place, so the browser still logs them to the console with their original stack.
 * - Errors reported directly with `report()` (caught somewhere, but still fatal) are logged by
 *   this handler, because nothing else would.
 *
 * The event source is injected (`window` in the browser), so this is simulation-layer code that
 * runs in Node tests.
 */

import { ENGINE_CONFIG } from './Config';

export type ErrorSource = 'error' | 'unhandledrejection' | 'report';

export interface ErrorReport {
  /** 1-based order of arrival. */
  readonly id: number;
  readonly source: ErrorSource;
  /** Short, player-safe description: error name and message, trimmed. No stack. */
  readonly message: string;
  /** The original thrown value, for developer tools. */
  readonly error: unknown;
}

export interface ErrorHandlerOptions {
  /** Called once, with the first error. Should stop the game and show the error screen. */
  readonly onFatal: (report: ErrorReport) => void;
  /** Logs errors passed to `report()`. Default: `console.error`. */
  readonly log?: (report: ErrorReport) => void;
  readonly maxReports?: number;
  readonly maxMessageLength?: number;
}

export class ErrorHandler {
  private readonly options: ErrorHandlerOptions;
  private readonly maxReports: number;
  private readonly maxMessageLength: number;
  private readonly kept: ErrorReport[] = [];
  private total = 0;
  private fatalReport: ErrorReport | null = null;

  constructor(options: ErrorHandlerOptions) {
    this.options = options;
    this.maxReports = options.maxReports ?? ENGINE_CONFIG.errors.maxReports;
    this.maxMessageLength = options.maxMessageLength ?? ENGINE_CONFIG.errors.maxMessageLength;
  }

  /** The first (fatal) error, or null while everything is fine. */
  get fatal(): ErrorReport | null {
    return this.fatalReport;
  }

  /** The most recent reports (at most `maxReports`). */
  get reports(): readonly ErrorReport[] {
    return this.kept;
  }

  /** Every error seen, including those no longer kept. */
  get count(): number {
    return this.total;
  }

  /**
   * Listens for uncaught errors and unhandled rejections on `target` (normally `window`).
   * Returns a function that stops listening.
   */
  attach(target: EventTarget): () => void {
    const onError = (event: Event): void => {
      const e = event as Event & { error?: unknown; message?: unknown };
      this.handle(e.error ?? e.message ?? 'Unknown error', 'error');
    };
    const onRejection = (event: Event): void => {
      this.handle((event as Event & { reason?: unknown }).reason, 'unhandledrejection');
    };
    target.addEventListener('error', onError);
    target.addEventListener('unhandledrejection', onRejection);
    return () => {
      target.removeEventListener('error', onError);
      target.removeEventListener('unhandledrejection', onRejection);
    };
  }

  /** Reports an error that was caught but must still stop the game. It is logged and shown. */
  report(error: unknown): ErrorReport {
    const report = this.handle(error, 'report');
    this.log(report);
    return report;
  }

  private handle(error: unknown, source: ErrorSource): ErrorReport {
    this.total++;
    const report: ErrorReport = {
      id: this.total,
      source,
      message: describeError(error, this.maxMessageLength),
      error,
    };
    this.kept.push(report);
    if (this.kept.length > this.maxReports) {
      this.kept.shift();
    }
    if (this.fatalReport === null) {
      this.fatalReport = report;
      try {
        this.options.onFatal(report);
      } catch (handlerError) {
        // The error screen itself failed: make sure both errors are still visible.
        console.error('ErrorHandler: onFatal threw', handlerError);
      }
    }
    return report;
  }

  private log(report: ErrorReport): void {
    if (this.options.log) {
      this.options.log(report);
    } else {
      console.error(`[${report.source}] ${report.message}`, report.error);
    }
  }
}

/** A short, player-safe description of any thrown value. Never throws. */
export function describeError(
  error: unknown,
  maxLength: number = ENGINE_CONFIG.errors.maxMessageLength,
): string {
  let text: string;
  try {
    if (error instanceof Error) {
      text = error.message ? `${error.name}: ${error.message}` : error.name;
    } else if (typeof error === 'string') {
      text = error;
    } else if (error === undefined || error === null) {
      text = 'Unknown error';
    } else {
      text = JSON.stringify(error);
    }
  } catch {
    text = 'Unknown error';
  }
  text = text.trim() || 'Unknown error';
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}
