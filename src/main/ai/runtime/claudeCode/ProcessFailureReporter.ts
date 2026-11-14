import {
  type ClaudeCodeProcessDiagnostics,
  createClaudeCodeProcessExitError,
  hasClaudeCodeProcessFailure,
  subscribeClaudeCodeProcessFailure
} from './processExitDiagnostics'

/** The task owns presentation. Process events do not depend on SDK error wording. */
export class ProcessFailureReporter {
  private active = false
  private activityRevision = 0
  private closed = false
  private reported = false
  private readonly unsubscribe: () => void
  private readonly failed: Promise<void>

  constructor(
    private readonly diagnostics: ClaudeCodeProcessDiagnostics,
    private readonly emit: (error: unknown) => void
  ) {
    let resolveFailure!: () => void
    this.failed = new Promise<void>((resolve) => {
      resolveFailure = resolve
    })
    this.unsubscribe = subscribeClaudeCodeProcessFailure(diagnostics, () => {
      resolveFailure()
      if (this.active) this.report(this.error())
    })
  }

  private error(): Error {
    return createClaudeCodeProcessExitError(new Error('Process failure'), this.diagnostics)
  }

  assertAvailable(): void {
    if (hasClaudeCodeProcessFailure(this.diagnostics)) throw this.error()
  }

  beginTurn(): () => void {
    this.assertAvailable()
    const wasActive = this.active
    const revision = ++this.activityRevision
    this.active = true
    // Refused/throwing submissions must not cancel a previously active turn or revive
    // a turn that completed while the submission was awaiting acknowledgement.
    return () => {
      if (this.activityRevision !== revision) return
      this.activityRevision++
      this.active = wasActive
    }
  }

  completeTurn(): void {
    this.activityRevision++
    this.active = false
  }

  private report(error: unknown): void {
    if (this.closed || this.reported) return
    this.reported = true
    this.active = false
    this.emit(error)
  }

  /** The SDK can close before the manager finishes its bounded stderr drain (200ms). */
  async sourceClosed(error: unknown, aborted: boolean, fallback?: () => void): Promise<void> {
    if (this.closed || this.reported || !this.active) return
    if (aborted) {
      this.reported = true
      this.active = false
      fallback?.()
      return
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        this.failed,
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, 250)
        })
      ])
    } finally {
      clearTimeout(timer)
    }
    if (this.closed || this.reported) return
    if (hasClaudeCodeProcessFailure(this.diagnostics) || !fallback) {
      this.report(hasClaudeCodeProcessFailure(this.diagnostics) ? this.error() : error)
    } else {
      this.reported = true
      this.active = false
      fallback()
    }
  }

  close(): void {
    this.closed = true
    this.active = false
    this.unsubscribe()
  }
}
