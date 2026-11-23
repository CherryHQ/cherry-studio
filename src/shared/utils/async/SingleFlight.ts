/** Shares one eagerly started operation until it settles; later runs start fresh. */
export class SingleFlight<T> {
  private active: Promise<T> | undefined

  get isRunning(): boolean {
    return this.active !== undefined
  }

  get promise(): Promise<T> | undefined {
    return this.active
  }

  run(task: () => T | PromiseLike<T>): Promise<T> {
    if (this.active) return this.active
    const { promise, resolve, reject } = Promise.withResolvers<T>()
    this.active = promise

    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Both synchronous task throws and Promise rejections must reject the shared flight with their original value.
    const fail = (error: unknown): void => {
      this.active = undefined
      reject(error)
    }

    try {
      void Promise.resolve(task()).then((value) => {
        this.active = undefined
        resolve(value)
      }, fail)
    } catch (error) {
      fail(error)
    }

    return promise
  }
}
