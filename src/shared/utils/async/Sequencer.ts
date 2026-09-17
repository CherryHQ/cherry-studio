/** Runs every task in order; a failure is reported to its caller without poisoning successors. */
export class Sequencer {
  private current: Promise<unknown> = Promise.resolve()

  queue<T>(task: () => T | PromiseLike<T>): Promise<T> {
    const next = this.current.then(task, task)
    this.current = next.then(
      () => undefined,
      () => undefined
    )
    return next
  }
}

/** Independent FIFO sequences per key. Idle keys are released; flush waits for a snapshot. */
export class SequencerByKey<K> {
  private readonly pending = new Map<K, Promise<void>>()

  queue<T>(key: K, task: () => T | PromiseLike<T>): Promise<T> {
    const next = (this.pending.get(key) ?? Promise.resolve()).then(task, task)
    const settled = next.then(
      () => undefined,
      () => undefined
    )
    this.pending.set(key, settled)
    void settled.then(() => {
      if (this.pending.get(key) === settled) this.pending.delete(key)
    })
    return next
  }

  async flush(key?: K): Promise<void> {
    await Promise.all(key === undefined ? this.pending.values() : [this.pending.get(key)])
  }
}
