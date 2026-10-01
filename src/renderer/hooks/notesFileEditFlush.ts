type NotesEditFlush = () => Promise<void>

const flushCallbacks = new Set<NotesEditFlush>()
let relocationEditLockDepth = 0

export function lockNotesEditsForRelocation(): void {
  relocationEditLockDepth += 1
}

export function unlockNotesEditsForRelocation(): void {
  relocationEditLockDepth = Math.max(0, relocationEditLockDepth - 1)
}

export function areNotesEditsLockedForRelocation(): boolean {
  return relocationEditLockDepth > 0
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
