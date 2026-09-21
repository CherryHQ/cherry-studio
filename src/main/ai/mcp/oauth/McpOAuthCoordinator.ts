export class McpAuthorizationCompleted extends Error {}

export interface McpAuthorizationLease {
  signal: AbortSignal
  finish(error?: unknown): void
}

/** Coalesces interactive authorization before the SDK writes shared state and PKCE credentials. */
export class McpOAuthCoordinator {
  private readonly pending = new Map<string, { done: Promise<void>; lease: McpAuthorizationLease }>()

  async begin(target: string, signal: AbortSignal): Promise<McpAuthorizationLease> {
    signal.throwIfAborted()
    const existing = this.pending.get(target)
    if (existing) {
      await new Promise<void>((resolve, reject) => {
        const abort = () => reject(signal.reason)
        signal.addEventListener('abort', abort, { once: true })
        existing.done.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
      })
      throw new McpAuthorizationCompleted('MCP credentials changed; retry the rejected request')
    }
    const controller = new AbortController()
    const effectiveSignal = AbortSignal.any([signal, controller.signal])
    let resolve!: () => void
    let reject!: (error: unknown) => void
    const done = new Promise<void>((res, rej) => {
      resolve = res
      reject = rej
    })
    void done.catch(() => undefined)
    const abort = () => lease.finish(effectiveSignal.reason)
    const lease: McpAuthorizationLease = {
      signal: effectiveSignal,
      finish: (error) => {
        if (this.pending.get(target)?.lease !== lease) return
        this.pending.delete(target)
        effectiveSignal.removeEventListener('abort', abort)
        if (error === undefined) resolve()
        else reject(error)
        controller.abort(error)
      }
    }
    this.pending.set(target, { done, lease })
    effectiveSignal.addEventListener('abort', abort, { once: true })
    return lease
  }

  close(): void {
    for (const { lease } of this.pending.values()) lease.finish(new Error('MCP authorization stopped'))
  }
}
