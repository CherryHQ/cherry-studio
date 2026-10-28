/**
 * Renderer-side notes-migration lock. While the main process copies the notes
 * directory, notes actions are blocked (see notesMigrationGuard) and each
 * window's FileEditSessionManager is sealed and flushed (see NotesMigrationHost).
 * This store tracks only the lock depth and its listeners; draft persistence and
 * edit sealing belong to the window's session manager.
 */
class NotesMigrationLockStore {
  private depth = 0
  private readonly listeners = new Set<() => void>()
  private readonly pendingEditorMutations = new Set<Promise<unknown>>()

  /** Track an in-flight editor mutation (e.g. an image paste) so a migration flush waits for it. */
  trackEditorMutation<T>(work: Promise<T>): Promise<T> {
    const tracked = work.finally(() => {
      this.pendingEditorMutations.delete(tracked)
    })
    this.pendingEditorMutations.add(tracked)
    return tracked
  }

  /** Resolve when every tracked editor mutation has settled. */
  async settleEditorMutations(): Promise<void> {
    if (this.pendingEditorMutations.size > 0) {
      await Promise.allSettled([...this.pendingEditorMutations])
    }
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  isLocked(): boolean {
    return this.depth > 0
  }

  begin(): void {
    const wasLocked = this.depth > 0
    this.depth += 1
    if (!wasLocked) {
      for (const listener of this.listeners) listener()
    }
  }

  end(): void {
    if (this.depth === 0) return
    this.depth -= 1
    if (this.depth === 0) {
      for (const listener of this.listeners) listener()
    }
  }

  reset(): void {
    if (this.depth === 0) return
    this.depth = 0
    for (const listener of this.listeners) listener()
  }
}

export const notesMigrationLock = new NotesMigrationLockStore()
