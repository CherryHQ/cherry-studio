export class DatabaseLockedError extends Error {
  constructor(account: string) {
    super(`The database for account "${account}" is open in another tab`)
    this.name = 'DatabaseLockedError'
  }
}

/**
 * Holds an exclusive Web Lock per account for as long as the returned release
 * function is not called, or until the Worker dies. The non-pooled OPFS VFS lets
 * a second tab open the same file, so this lock is the only single-writer guard.
 *
 * It waits up to `timeoutMs` rather than failing at once: after a reload the
 * previous page's Worker may still be releasing the lock.
 */
export function acquireAccountLock(account: string, timeoutMs: number): Promise<() => void> {
  return new Promise((resolve, reject) => {
    navigator.locks
      .request(`cherry-studio:database:${account}`, { signal: AbortSignal.timeout(timeoutMs) }, () => {
        return new Promise<void>((release) => resolve(release))
      })
      .catch((error: unknown) => {
        reject(
          error instanceof DOMException && error.name === 'TimeoutError' ? new DatabaseLockedError(account) : error
        )
      })
  })
}
