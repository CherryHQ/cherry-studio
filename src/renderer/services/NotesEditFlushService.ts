type NotesEditFlush = () => Promise<void>

/**
 * Registry of note-file draft flushers. The notes edit session registers its
 * flush here so a migration started outside the notes page can persist
 * unsaved drafts first. Held per renderer window.
 */
export class NotesEditFlushService {
  private callbacks = new Set<NotesEditFlush>()
  private migrationLockDepth = 0
  private migrationLockListeners = new Set<() => void>()
  private pendingEditorMutations = new Set<Promise<unknown>>()
  private flushing = false

  register(flush: NotesEditFlush): () => void {
    this.callbacks.add(flush)
    return () => {
      this.callbacks.delete(flush)
    }
  }

  trackEditorMutation<T>(work: Promise<T>): Promise<T> {
    const tracked = work.finally(() => {
      this.pendingEditorMutations.delete(tracked)
    })
    this.pendingEditorMutations.add(tracked)
    return tracked
  }

  isFlushing(): boolean {
    return this.flushing
  }

  async flushAll(): Promise<void> {
    this.flushing = true
    try {
      if (this.pendingEditorMutations.size > 0) {
        await Promise.all([...this.pendingEditorMutations])
      }
      await Promise.all([...this.callbacks].map((flush) => flush()))
    } finally {
      this.flushing = false
    }
  }

  subscribeMigrationLock(listener: () => void): () => void {
    this.migrationLockListeners.add(listener)
    return () => {
      this.migrationLockListeners.delete(listener)
    }
  }

  getMigrationLocked(): boolean {
    return this.migrationLockDepth > 0
  }

  beginMigrationLock(): void {
    const wasLocked = this.migrationLockDepth > 0
    this.migrationLockDepth += 1
    if (!wasLocked) {
      for (const listener of this.migrationLockListeners) {
        listener()
      }
    }
  }

  endMigrationLock(): void {
    if (this.migrationLockDepth === 0) {
      return
    }
    this.migrationLockDepth -= 1
    if (this.migrationLockDepth === 0) {
      for (const listener of this.migrationLockListeners) {
        listener()
      }
    }
  }

  resetMigrationLock(): void {
    if (this.migrationLockDepth === 0) {
      return
    }
    this.migrationLockDepth = 0
    for (const listener of this.migrationLockListeners) {
      listener()
    }
  }
}

export const notesEditFlushService = new NotesEditFlushService()
