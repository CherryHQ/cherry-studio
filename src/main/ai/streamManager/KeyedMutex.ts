import { Mutex } from 'async-mutex'

/**
 * One mutex per key, created lazily and dropped when idle. Serialises async tasks that share a
 * key while letting different keys run concurrently. Used to serialise per-topic dispatch so
 * the async `prepareDispatch → send` window can't race a concurrent `Ai_Stream_Open`.
 */
export class KeyedMutex {
  private readonly mutexes = new Map<string, Mutex>()

  async runExclusive<T>(key: string, task: () => Promise<T>): Promise<T> {
    let mutex = this.mutexes.get(key)
    if (!mutex) {
      mutex = new Mutex()
      this.mutexes.set(key, mutex)
    }
    const release = await mutex.acquire()
    try {
      return await task()
    } finally {
      release()
      // Only drop the exact mutex we released; a queued waiter may have already replaced it for
      // the same key after this task released.
      if (!mutex.isLocked() && this.mutexes.get(key) === mutex) {
        this.mutexes.delete(key)
      }
    }
  }
}
