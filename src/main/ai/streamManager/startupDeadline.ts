export type StartupDeadlinePhase = 'preparation'

export interface StartupDeadlineOptions {
  startupMs: number
  preparationBudgetMs: number
  onExpire: () => void
  now?: () => number
}

/** Startup time excludes preparation only until its aggregate allowance is exhausted. */
export class StartupDeadline {
  private didExpire = false
  private stopped = false
  private phases: StartupDeadlinePhase[] = []
  private remaining: number
  private preparationRemaining: number
  private updatedAt: number
  private timer?: ReturnType<typeof setTimeout>
  private readonly now: () => number

  constructor(private readonly options: StartupDeadlineOptions) {
    this.now = options.now ?? Date.now
    this.remaining = options.startupMs
    this.preparationRemaining = options.preparationBudgetMs
    this.updatedAt = this.now()
    this.arm()
  }

  get expired(): boolean {
    return this.didExpire
  }

  notifyOutput(): void {
    this.dispose()
  }

  beginPreparation(phase: StartupDeadlinePhase): void {
    if (this.stopped) return
    this.accountElapsed()
    this.phases.push(phase)
    this.arm()
  }

  endPreparation(phase: StartupDeadlinePhase): void {
    const index = this.phases.lastIndexOf(phase)
    if (this.stopped || index === -1) return
    this.accountElapsed()
    this.phases.splice(index, 1)
    this.arm()
  }

  dispose(): void {
    this.stopped = true
    clearTimeout(this.timer)
    this.timer = undefined
  }

  private accountElapsed(): void {
    const now = this.now()
    const elapsed = Math.max(0, now - this.updatedAt)
    const suspended = this.phases.length > 0 ? Math.min(elapsed, this.preparationRemaining) : 0
    this.preparationRemaining -= suspended
    this.remaining -= elapsed - suspended
    this.updatedAt = now
  }

  private arm(): void {
    clearTimeout(this.timer)
    const suspension = this.phases.length > 0 ? this.preparationRemaining : 0
    this.timer = setTimeout(
      () => {
        this.accountElapsed()
        if (this.remaining > 0) {
          this.arm()
          return
        }
        this.didExpire = true
        this.dispose()
        this.options.onExpire()
      },
      Math.max(0, suspension || this.remaining)
    )
  }
}
