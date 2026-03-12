/**
 * ConcurrencyPool - A reusable concurrency limiter for async tasks
 *
 * Manages a pool of concurrent task slots, queuing tasks when the limit is reached.
 */

export class ConcurrencyPool {
  private active = 0
  private waiters: Array<() => void> = []

  constructor(private readonly limit: number) {}

  /**
   * Run a task within the concurrency pool
   * @param task The async task to execute
   * @returns The result of the task
   */
  async run<T>(task: () => Promise<T>): Promise<T> {
    await this.acquire()
    try {
      return await task()
    } finally {
      this.release()
    }
  }

  private acquire(): Promise<void> {
    if (this.limit <= 0) {
      return Promise.resolve()
    }

    if (this.active < this.limit) {
      this.active += 1
      return Promise.resolve()
    }

    return new Promise((resolve) => {
      this.waiters.push(resolve)
    })
  }

  private release(): void {
    if (this.limit <= 0) {
      return
    }

    const next = this.waiters.shift()
    if (next) {
      // Transfer the slot to the next waiter without decrementing active count.
      // The waiter will use this slot, so active count remains the same.
      next()
      return
    }

    this.active = Math.max(0, this.active - 1)
  }
}
