import {
  MARKDOWN_RENDER_STREAM_CADENCE_MS,
  markdownRenderInterval,
  nextMarkdownRenderDelay
} from './markdownRenderPacing'

/**
 * Scheduling state machine for the Translate page's paced markdown rendering.
 * Owns every interleaving decision (stream pacing, discrete-swap immediacy,
 * trailing final render, epoch invalidation on clear, pending-immediate
 * catch-up); the host adapter only executes renders/timers, which makes the
 * full event space unit-testable without React.
 */
export interface MarkdownRenderSchedulerHost {
  now(): number
  armTimer(delayMs: number): void
  clearTimer(): void
  /** Fire armed timer callbacks by calling back into onTimerFired(). */
  requestRender(): void
  requestPaneClear(): void
}

export interface RenderTicket {
  epoch: number
  content: string
}

export class MarkdownRenderScheduler {
  private previousContent: string | undefined = undefined
  private lastContentChangeAt: number | undefined = undefined
  private lastRenderAt = 0
  private epoch = 0
  private latestContent = ''
  private inFlight = false
  private pendingImmediateEpoch: number | null = null
  private timerArmed = false

  constructor(private readonly host: MarkdownRenderSchedulerHost) {}

  /** Effect entry for every dep change (content, markdown toggle, theme). */
  onOutputChange(content: string, markdownEnabled: boolean): void {
    this.latestContent = content
    if (!markdownEnabled || !content) {
      this.host.clearTimer()
      this.timerArmed = false
      this.pendingImmediateEpoch = null
      if (!content) {
        // Invalidate in-flight renders...
        this.epoch += 1
      }
      // Reset cadence state so the next enabled/first render is immediate.
      this.previousContent = undefined
      this.lastContentChangeAt = undefined
      this.lastRenderAt = 0
      this.host.requestPaneClear()
      return
    }

    const now = this.host.now()
    const contentChanged = content !== this.previousContent
    // Discrete = this change did not follow the previous one within cadence.
    const discreteSwap =
      contentChanged &&
      (this.lastContentChangeAt === undefined || now - this.lastContentChangeAt > MARKDOWN_RENDER_STREAM_CADENCE_MS)
    const delay = nextMarkdownRenderDelay(
      content,
      this.previousContent,
      this.lastRenderAt,
      now,
      this.lastContentChangeAt
    )
    if (contentChanged) {
      this.lastContentChangeAt = now
    }
    this.previousContent = content

    if (delay === 0) {
      // The immediate render supersedes any armed trailing timer.
      if (this.timerArmed) {
        this.host.clearTimer()
        this.timerArmed = false
      }
      // Immediate requests skipped mid-flight (dep change or discrete swap)
      // are caught up after the render; paced-due stream frames are not.
      if (this.inFlight && (!contentChanged || discreteSwap)) {
        this.pendingImmediateEpoch = this.epoch
      } else {
        this.requestRender()
      }
    } else if (!this.timerArmed) {
      this.host.armTimer(delay)
      this.timerArmed = true
    }
  }

  /** Host fired the armed timer. */
  onTimerFired(): void {
    this.timerArmed = false
    this.requestRender()
  }

  /** Start of a render the host was asked for; returns its invalidation ticket. */
  renderStarted(): RenderTicket {
    this.inFlight = true
    return { epoch: this.epoch, content: this.latestContent }
  }

  /**
   * Host finished a render. Returns whether the caller may commit it.
   * Handles pending-immediate consumption and follow-up timer arming.
   */
  renderCompleted(ticket: RenderTicket): 'commit' | 'drop' {
    this.inFlight = false
    // Update the pacing anchor before pending handling: a catch-up render
    // must pace from this render's resolution, matching the inline version.
    if (ticket.epoch === this.epoch) this.lastRenderAt = this.host.now()
    // A pending immediate request from the current epoch still renders even
    // when this render itself is stale (its output was cleared mid-flight).
    const pendingEpoch = this.pendingImmediateEpoch
    this.pendingImmediateEpoch = null
    if (pendingEpoch === this.epoch) {
      if (this.timerArmed) {
        this.host.clearTimer()
        this.timerArmed = false
      }
      this.requestRender()
      return ticket.epoch === this.epoch ? 'commit' : 'drop'
    }
    if (ticket.epoch !== this.epoch) return 'drop'
    if (this.latestContent !== ticket.content && !this.timerArmed) {
      this.host.armTimer(markdownRenderInterval(this.latestContent))
      this.timerArmed = true
    }
    return 'commit'
  }

  /** Terminal for renders that resolve while unmounted or markdown-disabled. */
  renderAborted(): void {
    this.inFlight = false
  }

  /** Unmount: drop pending work; host clears the real timer. */
  dispose(): void {
    this.pendingImmediateEpoch = null
    if (this.timerArmed) {
      this.host.clearTimer()
      this.timerArmed = false
    }
  }

  private requestRender(): void {
    if (this.inFlight) return
    this.host.requestRender()
  }
}
