type NotesEditFlush = () => Promise<void>

const flushCallbacks = new Set<NotesEditFlush>()
const autosaveCancelCallbacks = new Set<() => void>()
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
  if (relocationEditLockDepth === 0) {
    for (const cancel of autosaveCancelCallbacks) {
      cancel()
    }
  }
  relocationEditLockDepth += 1
}

export function registerNotesRelocationAutosaveCancel(cancel: () => void): () => void {
  autosaveCancelCallbacks.add(cancel)
  return () => {
    autosaveCancelCallbacks.delete(cancel)
  }
}

export function unlockNotesEditsForRelocation(): void {
  relocationEditLockDepth = 0
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
