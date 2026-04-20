/**
 * Generic throttled flush controller.
 *
 * A pure scheduling primitive that manages timer-based throttling,
 * mutex-guarded flushing, and reflush-on-conflict. Contains no
 * business logic — the actual flush work is provided via a callback.
 *
 * Inspired by openclaw-lark's FlushController.
 */

/** Default minimum interval between flushes (ms). */
const DEFAULT_THROTTLE_MS = 200

/**
 * After a long gap (e.g. first update or pause in streaming), batch briefly
 * so the first visible update contains meaningful text rather than 1-2 chars.
 */
const LONG_GAP_THRESHOLD_MS = 2000
const BATCH_AFTER_GAP_MS = 300

export class FlushController {
  private flushInProgress = false
  private flushResolvers: Array<() => void> = []
  private needsReflush = false
  private pendingFlushTimer: ReturnType<typeof setTimeout> | null = null
  private lastUpdateTime = 0
  private _completed = false

  constructor(private readonly doFlush: () => Promise<void>) {}

  /** Mark the controller as completed — no more flushes after current one. */
  complete(): void {
    this._completed = true
  }

  get isCompleted(): boolean {
    return this._completed
  }

  /** Cancel any pending deferred flush timer. */
  cancelPendingFlush(): void {
    if (this.pendingFlushTimer) {
      clearTimeout(this.pendingFlushTimer)
      this.pendingFlushTimer = null
    }
  }

  /** Wait for any in-progress flush to finish. */
  waitForFlush(): Promise<void> {
    if (!this.flushInProgress) return Promise.resolve()
    return new Promise<void>((resolve) => this.flushResolvers.push(resolve))
  }

  /**
   * Execute a flush (mutex-guarded, with reflush on conflict).
   *
   * If a flush is already in progress, marks needsReflush so a
   * follow-up flush fires immediately after the current one completes.
   */
  async flush(): Promise<void> {
    if (this.flushInProgress || this._completed) {
      if (this.flushInProgress && !this._completed) this.needsReflush = true
      return
    }
    this.flushInProgress = true
    this.needsReflush = false
    // Update timestamp BEFORE the API call to prevent concurrent callers
    // from also entering the flush.
    this.lastUpdateTime = Date.now()
    try {
      await this.doFlush()
      this.lastUpdateTime = Date.now()
    } finally {
      this.flushInProgress = false
      const resolvers = this.flushResolvers
      this.flushResolvers = []
      for (const resolve of resolvers) resolve()

      // If events arrived while the API call was in flight,
      // schedule an immediate follow-up flush.
      if (this.needsReflush && !this._completed && !this.pendingFlushTimer) {
        this.needsReflush = false
        this.pendingFlushTimer = setTimeout(() => {
          this.pendingFlushTimer = null
          void this.flush()
        }, 0)
      }
    }
  }

  /**
   * Throttled update entry point.
   *
   * @param throttleMs - Minimum interval between flushes. Defaults to 200ms.
   */
  async throttledUpdate(throttleMs = DEFAULT_THROTTLE_MS): Promise<void> {
    const now = Date.now()
    const elapsed = now - this.lastUpdateTime

    if (elapsed >= throttleMs) {
      this.cancelPendingFlush()
      if (elapsed > LONG_GAP_THRESHOLD_MS) {
        // After a long gap, batch briefly so the first visible update
        // contains meaningful text rather than just 1-2 characters.
        this.lastUpdateTime = now
        this.pendingFlushTimer = setTimeout(() => {
          this.pendingFlushTimer = null
          void this.flush()
        }, BATCH_AFTER_GAP_MS)
      } else {
        await this.flush()
      }
    } else if (!this.pendingFlushTimer) {
      // Inside throttle window — schedule a deferred flush
      const delay = throttleMs - elapsed
      this.pendingFlushTimer = setTimeout(() => {
        this.pendingFlushTimer = null
        void this.flush()
      }, delay)
    }
  }

  /** Reset for reuse (e.g. new streaming session). */
  reset(): void {
    this.cancelPendingFlush()
    this.flushInProgress = false
    this.needsReflush = false
    this._completed = false
    this.lastUpdateTime = 0
    this.flushResolvers = []
  }
}
