/**
 * Simple semaphore-based concurrency limiter.
 *
 * When `max` is 0 or negative, the semaphore acts as a no-op (unlimited concurrency).
 * When `max` is positive, at most `max` calls can hold an acquired permit simultaneously;
 * further callers will queue until a permit is released.
 */

import { logger } from "./logger.js";

export class Semaphore {
  private _current = 0;
  private readonly _waiters: Array<() => void> = [];

  constructor(private readonly _max: number) {}

  /**
   * Acquire a permit. Resolves immediately when a slot is available;
   * otherwise queues the caller until a permit is released.
   */
  async acquire(): Promise<void> {
    if (this._max <= 0) {
      return;
    }

    if (this._current < this._max) {
      this._current += 1;
      return;
    }

    const queueStart = Date.now();
    logger.trace({ current: this._current, max: this._max, queueLength: this._waiters.length }, "semaphore: waiting for slot");

    return new Promise<void>((resolve) => {
      this._waiters.push(() => {
        const waitedMs = Date.now() - queueStart;
        logger.trace({ waitedMs, current: this._current, max: this._max }, "semaphore: slot acquired after wait");
        this._current += 1;
        resolve();
      });
    });
  }

  /**
   * Release a permit, waking the next queued caller (if any).
   */
  release(): void {
    if (this._max <= 0) {
      return;
    }

    this._current -= 1;
    const next = this._waiters.shift();
    if (next) {
      next();
    }
  }

  /** Exposed for testing — number of currently held permits. */
  get current(): number {
    return this._current;
  }

  /** Exposed for testing — number of queued waiters. */
  get queueLength(): number {
    return this._waiters.length;
  }

  /** Exposed for testing — the configured max. */
  get max(): number {
    return this._max;
  }
}
