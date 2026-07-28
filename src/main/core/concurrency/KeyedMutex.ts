import { Mutex } from 'async-mutex'

/**
 * One mutex per key, created lazily and dropped when idle. Serialises tasks that share a
 * key while letting different keys run concurrently. Use it when independent items (a topic,
 * a knowledge base, a file) each need their own critical section and a single global mutex
 * would serialise unrelated work.
 *
 * Deliberately minimal — the scoped `runExclusive` is the whole API (no bare acquire/release,
 * no cleanup surface; idle mutexes self-delete). async-mutex ships tryAcquire / withTimeout /
 * priority / isLocked: pass one through only when a real consumer needs it, don't pre-expand.
 */
export class KeyedMutex {
  private readonly mutexes = new Map<string, Mutex>()

  async runExclusive<T>(key: string, task: () => T | Promise<T>): Promise<T> {
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
