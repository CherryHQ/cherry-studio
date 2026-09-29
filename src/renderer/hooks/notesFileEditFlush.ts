type NotesEditFlush = () => Promise<void>

const flushCallbacks = new Set<NotesEditFlush>()

export function registerNotesEditFlush(flush: NotesEditFlush): () => void {
  flushCallbacks.add(flush)
  return () => {
    flushCallbacks.delete(flush)
  }
}

export async function flushAllNotesEdits(): Promise<void> {
  await Promise.all([...flushCallbacks].map((flush) => flush()))
}
