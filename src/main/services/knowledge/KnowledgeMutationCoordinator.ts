import { Mutex } from 'async-mutex'

export class KnowledgeMutationCoordinator {
  private readonly baseMutexes = new Map<string, Mutex>()

  async withBaseMutationLock<T>(baseId: string, task: () => Promise<T>): Promise<T> {
    const mutex = this.getBaseMutex(baseId)
    const release = await mutex.acquire()

    try {
      return await task()
    } finally {
      release()
      this.deleteIdleBaseMutex(baseId, mutex)
    }
  }

  private getBaseMutex(baseId: string): Mutex {
    let mutex = this.baseMutexes.get(baseId)
    if (!mutex) {
      mutex = new Mutex()
      this.baseMutexes.set(baseId, mutex)
    }
    return mutex
  }

  private deleteIdleBaseMutex(baseId: string, mutex: Mutex): void {
    if (!mutex.isLocked() && this.baseMutexes.get(baseId) === mutex) {
      this.baseMutexes.delete(baseId)
    }
  }
}
