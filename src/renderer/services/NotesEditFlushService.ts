type NotesEditFlush = () => Promise<void>

/**
 * Registry of note-file draft flushers. The notes edit session registers its
 * flush here so a migration started outside the notes page can persist
 * unsaved drafts first. Held per renderer window.
 */
export class NotesEditFlushService {
  private callbacks = new Set<NotesEditFlush>()
  private migrationLocked = false
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
    return this.migrationLocked
  }

  beginMigrationLock(): void {
    if (this.migrationLocked) {
      return
    }
    this.migrationLocked = true
    for (const listener of this.migrationLockListeners) {
      listener()
    }
  }

  endMigrationLock(): void {
    if (!this.migrationLocked) {
      return
    }
    this.migrationLocked = false
    for (const listener of this.migrationLockListeners) {
      listener()
    }
  }
}

export const notesEditFlushService = new NotesEditFlushService()
