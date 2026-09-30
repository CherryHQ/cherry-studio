type NotesEditFlush = () => Promise<void>

const flushCallbacks = new Set<NotesEditFlush>()
let relocationEditLock = false

export function lockNotesEditsForRelocation(): void {
  relocationEditLock = true
}

export function unlockNotesEditsForRelocation(): void {
  relocationEditLock = false
}

export function areNotesEditsLockedForRelocation(): boolean {
  return relocationEditLock
}

export function registerNotesEditFlush(flush: NotesEditFlush): () => void {
  flushCallbacks.add(flush)
  return () => {
    flushCallbacks.delete(flush)
  }
}

export async function flushAllNotesEdits(): Promise<void> {
  await Promise.all([...flushCallbacks].map((flush) => flush()))
}
