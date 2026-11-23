/** Bridges a push-based producer onto the `AsyncIterable` event contract. */
export class AsyncEventQueue<T> implements AsyncIterable<T> {
  private readonly items: T[] = []
  private readonly waiters: Array<(result: IteratorResult<T>) => void> = []
  private closed = false

  push(item: T): void {
    if (this.closed) return
    const waiter = this.waiters.shift()

    if (waiter) {
      waiter({ value: item, done: false })

      return
    }

    this.items.push(item)
  }

  close(): void {
    if (this.closed) return
    this.closed = true

    while (this.waiters.length > 0) {
      this.waiters.shift()?.({ value: undefined, done: true })
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        if (this.items.length > 0) {
          // SAFETY: The private queue is nonempty and shift runs synchronously; undefined remains a valid item when T includes it.
          return Promise.resolve({ value: this.items.shift() as T, done: false })
        }

        if (this.closed) return Promise.resolve({ value: undefined, done: true })

        return new Promise<IteratorResult<T>>((resolve) => {
          this.waiters.push(resolve)
        })
      }
    }
  }
}
