import { loggerService } from '@logger'
import { createTimeout, SingleFlight } from '@shared/utils/async'

const logger = loggerService.withContext('FlushController')

/** Channel update timing, including batching after a quiet period and final-flush coordination. */
export class FlushController {
  private readonly active = new SingleFlight<void>()
  private needsReflush = false
  private pendingFlushTimer: ReturnType<typeof createTimeout<void>> | undefined
  private lastUpdateTime = 0
  private completed = false

  constructor(private readonly doFlush: () => Promise<void>) {}

  /** Stop future updates and release their timer; an active flush can still be awaited. */
  complete(): void {
    this.completed = true
    this.needsReflush = false
    this.cancelPendingFlush()
  }

  get isCompleted(): boolean {
    return this.completed
  }

  cancelPendingFlush(): void {
    this.pendingFlushTimer?.dispose()
    this.pendingFlushTimer = undefined
  }

  /** Join only the current callback, absorbing failure so the owner can publish its final message. */
  async waitForFlush(): Promise<void> {
    await this.active.promise?.catch(() => {})
  }

  /** A busy call returns immediately and requests a rerun, rather than joining the active flush. */
  async flush(): Promise<void> {
    if (this.completed) return
    if (this.active.isRunning) {
      this.needsReflush = true
      return
    }
    this.needsReflush = false
    this.lastUpdateTime = Date.now()
    try {
      await this.active.run(async () => {
        await this.doFlush()
        this.lastUpdateTime = Date.now()
      })
    } finally {
      if (this.needsReflush && !this.completed && !this.pendingFlushTimer) {
        this.needsReflush = false
        this.scheduleFlush(0)
      }
    }
  }

  /** Schedule channel edits at the adapter's interval; batch the first burst after a two-second gap. */
  async throttledUpdate(throttleMs = 200): Promise<void> {
    if (this.completed) return
    const now = Date.now()
    const elapsed = now - this.lastUpdateTime

    if (elapsed >= throttleMs) {
      this.cancelPendingFlush()
      if (elapsed > 2000) {
        this.lastUpdateTime = now
        this.scheduleFlush(300)
      } else {
        await this.flush()
      }
    } else if (!this.pendingFlushTimer) {
      this.scheduleFlush(throttleMs - elapsed)
    }
  }

  private scheduleFlush(delay: number): void {
    this.pendingFlushTimer = createTimeout(delay, () => {
      this.pendingFlushTimer = undefined
      void this.flush().catch((error) => logger.error('Failed to flush channel update', error))
    })
  }

  /** Reset pending scheduling for reuse; retain any active callback and its waiters. */
  reset(): void {
    this.cancelPendingFlush()
    this.needsReflush = false
    this.completed = false
    this.lastUpdateTime = 0
  }
}
