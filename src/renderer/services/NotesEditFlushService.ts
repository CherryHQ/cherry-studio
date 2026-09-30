type NotesEditFlush = () => Promise<void>

/**
 * Registry of note-file draft flushers. The notes edit session registers its
 * flush here so a migration started outside the notes page can persist
 * unsaved drafts first. Held per renderer window.
 */
export class NotesEditFlushService {
  private callbacks = new Set<NotesEditFlush>()

  register(flush: NotesEditFlush): () => void {
    this.callbacks.add(flush)
    return () => {
      this.callbacks.delete(flush)
    }
  }

  async flushAll(): Promise<void> {
    await Promise.all([...this.callbacks].map((flush) => flush()))
  }
}

export const notesEditFlushService = new NotesEditFlushService()
