export class IntegrationOperationScheduler {
  private readonly tails = new Map<string, Promise<void>>()

  async run<T>(resourceKeys: string[], signal: AbortSignal, execute: () => Promise<T>): Promise<T> {
    const keys = [...new Set(resourceKeys)].sort()
    const predecessors = keys.map((key) => this.tails.get(key)).filter((value) => value !== undefined)
    let release!: () => void
    const tail = new Promise<void>((resolve) => {
      release = resolve
    })
    for (const key of keys) this.tails.set(key, tail)

    try {
      await Promise.allSettled(predecessors)
      signal.throwIfAborted()
      return await execute()
    } finally {
      release()
      for (const key of keys) {
        if (this.tails.get(key) === tail) this.tails.delete(key)
      }
    }
  }
}
