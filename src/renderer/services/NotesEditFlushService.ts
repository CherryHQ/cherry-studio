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

  register(flush: NotesEditFlush): () => void {
    this.callbacks.add(flush)
    return () => {
      this.callbacks.delete(flush)
    }
  }

  async flushAll(): Promise<void> {
    await Promise.all([...this.callbacks].map((flush) => flush()))
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
}

export const notesEditFlushService = new NotesEditFlushService()
