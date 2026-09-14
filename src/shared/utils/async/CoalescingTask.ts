type Task = () => void | PromiseLike<void>

/** Runs the latest pending task until idle; any failure rejects the drain and discards pending work. */
export class CoalescingTask {
  private active: Promise<void> | undefined
  private pending: Task | undefined

  get isRunning(): boolean {
    return this.active !== undefined
  }

  get promise(): Promise<void> | undefined {
    return this.active
  }

  run(task: Task): Promise<void> {
    if (this.active) {
      this.pending = task
      return this.active
    }
    const result = Promise.withResolvers<void>()
    this.active = result.promise
    void this.drain(task, result)
    return result.promise
  }

  private async drain(task: Task, result: PromiseWithResolvers<void>): Promise<void> {
    try {
      let current: Task | undefined = task
      while (current) {
        this.pending = undefined
        await current()
        current = this.pending
      }
      this.active = undefined
      result.resolve()
    } catch (error) {
      this.pending = undefined
      this.active = undefined
      result.reject(error)
    }
  }
}
