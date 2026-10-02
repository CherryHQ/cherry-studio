type NotesEditFlush = () => Promise<void>

const flushCallbacks = new Set<NotesEditFlush>()
let relocationEditLockDepth = 0
let inFlightStructuralWrites = 0
const structuralWriteIdleWaiters: Array<() => void> = []

function notifyStructuralWriteIdleWaiters(): void {
  if (inFlightStructuralWrites > 0) {
    return
  }
  for (const resolve of structuralWriteIdleWaiters) {
    resolve()
  }
  structuralWriteIdleWaiters.length = 0
}

export function lockNotesEditsForRelocation(): void {
  relocationEditLockDepth += 1
}

export function unlockNotesEditsForRelocation(): void {
  relocationEditLockDepth = Math.max(0, relocationEditLockDepth - 1)
}

export function areNotesEditsLockedForRelocation(): boolean {
  return relocationEditLockDepth > 0
}

export async function waitForStructuralNotesWritesToSettle(): Promise<void> {
  while (inFlightStructuralWrites > 0) {
    await new Promise<void>((resolve) => {
      structuralWriteIdleWaiters.push(resolve)
    })
  }
}

export async function runStructuralNotesFilesystemWrite(
  onBlocked: () => void,
  operation: () => Promise<void>
): Promise<void> {
  if (areNotesEditsLockedForRelocation()) {
    onBlocked()
    return
  }

  inFlightStructuralWrites += 1
  try {
    await operation()
  } finally {
    inFlightStructuralWrites -= 1
    notifyStructuralWriteIdleWaiters()
  }
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
