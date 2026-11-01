export class McpAuthorizationCompleted extends Error {}

export interface McpAuthorizationLease {
  signal: AbortSignal
  finish(error?: unknown): void
}

function waitForAuthorization(done: Promise<unknown>, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted()
  return new Promise<void>((resolve, reject) => {
    const abort = () => reject(signal.reason)
    signal.addEventListener('abort', abort, { once: true })
    void done.then(() => resolve(), reject).finally(() => signal.removeEventListener('abort', abort))
  })
}

/** Coalesces one account's challenges and serializes accounts sharing the loopback callback port. */
export class McpOAuthCoordinator {
  private readonly pending = new Map<string, { done: Promise<void>; lease: McpAuthorizationLease }>()

  async begin(target: string, signal: AbortSignal, release?: () => Promise<void>): Promise<McpAuthorizationLease> {
    signal.throwIfAborted()
    const existing = this.pending.get(target)
    if (existing) {
      await waitForAuthorization(existing.done, signal)
      throw new McpAuthorizationCompleted('MCP credentials changed; retry the rejected request')
    }
    const predecessors = [...this.pending.values()].map(({ done }) => done)
    const controller = new AbortController()
    const effectiveSignal = AbortSignal.any([signal, controller.signal])
    const { promise: done, resolve, reject } = Promise.withResolvers<void>()
    void done.catch(() => undefined)
    const abort = () => lease.finish(effectiveSignal.reason)
    let finishing = false
    const lease: McpAuthorizationLease = {
      signal: effectiveSignal,
      finish: (error) => {
        if (finishing) return
        finishing = true
        effectiveSignal.removeEventListener('abort', abort)
        controller.abort(error)
        const complete = (failure?: unknown) => {
          this.pending.delete(target)
          if (failure === undefined) resolve()
          else reject(failure)
        }
        void Promise.resolve()
          .then(release)
          .then(() => complete(error), complete)
      }
    }
    this.pending.set(target, { done, lease })
    effectiveSignal.addEventListener('abort', abort, { once: true })
    await waitForAuthorization(Promise.allSettled(predecessors), effectiveSignal)
    effectiveSignal.throwIfAborted()
    return lease
  }

  close(): void {
    for (const { lease } of this.pending.values()) lease.finish(new Error('MCP authorization stopped'))
  }
}
