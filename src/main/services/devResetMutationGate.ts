import { IpcError } from '@shared/ipc/errors/IpcError'

/**
 * Lightweight process-wide mutation admission + in-flight drain for dev reset.
 * Owners wrap mutating entry points with `run()`; the coordinator calls
 * `acquire()` then `drain()`.
 */
export class DevResetMutationGate {
  private closed = false
  private readonly inFlight = new Set<Promise<unknown>>()

  acquire(): void {
    this.closed = true
  }

  release(): void {
    this.closed = false
  }

  get isClosed(): boolean {
    return this.closed
  }

  assertOpen(label: string): void {
    if (this.closed) {
      throw new IpcError('DEV_RESET_MUTATION_IN_PROGRESS', `${label} refused: dev reset mutation gate is closed`)
    }
  }

  async run<T>(label: string, fn: () => T | Promise<T>): Promise<T> {
    this.assertOpen(label)
    const pending = Promise.resolve().then(fn)
    this.inFlight.add(pending)
    try {
      return await pending
    } finally {
      this.inFlight.delete(pending)
    }
  }

  async drain(): Promise<void> {
    const pending = [...this.inFlight]
    if (pending.length === 0) return
    const results = await Promise.allSettled(pending)
    const failures = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    if (failures.length > 0) {
      throw new Error(
        `Dev reset mutation drain failed for ${failures.length} operation(s): ${failures
          .map((failure) => (failure.reason instanceof Error ? failure.reason.message : String(failure.reason)))
          .join('; ')}`
      )
    }
  }
}
