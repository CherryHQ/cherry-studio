import { Mutex } from 'async-mutex'

/**
 * One mutex per key, created lazily and dropped when idle. Serialises tasks that share a
 * key while letting different keys run concurrently. Use it when independent items (a topic,
 * a knowledge base, a file) each need their own critical section and a single global mutex
 * would serialise unrelated work.
 *
 * Prefer scoped `runExclusive`. `acquire` exists for resources whose critical section ends on
 * an event (for example a writable stream); its release callback is idempotent. Idle mutexes
 * self-delete.
 */
export class KeyedMutex {
  private readonly mutexes = new Map<string, Mutex>()

  async acquire(key: string): Promise<() => void> {
    let mutex = this.mutexes.get(key)
    if (!mutex) {
      mutex = new Mutex()
      this.mutexes.set(key, mutex)
    }
    const releaseMutex = await mutex.acquire()
    let released = false
    return () => {
      if (released) return
      released = true
      releaseMutex()
      if (!mutex.isLocked() && this.mutexes.get(key) === mutex) {
        this.mutexes.delete(key)
      }
    }
  }

  async runExclusive<T>(key: string, task: () => T | Promise<T>): Promise<T> {
    const release = await this.acquire(key)
    try {
      return await task()
    } finally {
      release()
    }
  }
}
