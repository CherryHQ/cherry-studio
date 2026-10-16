import { useSyncExternalStore } from 'react'

type NotesEditFlush = () => Promise<void>

const flushCallbacks = new Set<NotesEditFlush>()
const preFlushCallbacks = new Set<() => void | Promise<void>>()
const departingWriteChains = new Set<Promise<void>>()
const pendingImagePasteOperations = new Set<Promise<void>>()
const autosaveCancelCallbacks = new Set<() => void>()
const relocationEditLockListeners = new Set<() => void>()
let relocationEditLockDepth = 0
let relocationBarrierEpoch = 0
let inFlightStructuralWrites = 0
const structuralWriteIdleWaiters: Array<() => void> = []

function notifyRelocationEditLockChanged(): void {
  for (const listener of relocationEditLockListeners) {
    listener()
  }
}

function subscribeNotesRelocationEditLock(listener: () => void): () => void {
  relocationEditLockListeners.add(listener)
  return () => {
    relocationEditLockListeners.delete(listener)
  }
}

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
  notifyRelocationEditLockChanged()
}

export function registerNotesRelocationAutosaveCancel(cancel: () => void): () => void {
  autosaveCancelCallbacks.add(cancel)
  return () => {
    autosaveCancelCallbacks.delete(cancel)
  }
}

export function releaseOneNotesRelocationEditLock(): void {
  if (relocationEditLockDepth === 0) {
    return
  }
  relocationEditLockDepth -= 1
  notifyRelocationEditLockChanged()
}

export function getNotesRelocationBarrierEpoch(): number {
  return relocationBarrierEpoch
}

export function unlockNotesEditsForRelocation(): void {
  if (relocationEditLockDepth === 0) {
    return
  }
  relocationEditLockDepth = 0
  relocationBarrierEpoch += 1
  notifyRelocationEditLockChanged()
}

export function areNotesEditsLockedForRelocation(): boolean {
  return relocationEditLockDepth > 0
}

export function useNotesEditsLockedForRelocation(): boolean {
  return useSyncExternalStore(
    subscribeNotesRelocationEditLock,
    areNotesEditsLockedForRelocation,
    areNotesEditsLockedForRelocation
  )
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

export function registerNotesEditPreFlush(preFlush: () => void | Promise<void>): () => void {
  preFlushCallbacks.add(preFlush)
  return () => {
    preFlushCallbacks.delete(preFlush)
  }
}

export function trackDepartingNotesFileWrite(chain: Promise<void>): void {
  departingWriteChains.add(chain)
}

export function trackPendingNotesImagePaste<T>(operation: Promise<T>): Promise<T> {
  const tracked = operation.then(
    () => undefined,
    () => undefined
  )
  pendingImagePasteOperations.add(tracked)
  void tracked.finally(() => {
    pendingImagePasteOperations.delete(tracked)
  })
  return operation
}

export function hasPendingNotesImagePastes(): boolean {
  return pendingImagePasteOperations.size > 0
}

export async function waitForPendingNotesImagePastes(): Promise<void> {
  while (pendingImagePasteOperations.size > 0) {
    await Promise.all([...pendingImagePasteOperations])
  }
}

export async function flushAllNotesEdits(): Promise<void> {
  await waitForPendingNotesImagePastes()
  for (const preFlush of preFlushCallbacks) {
    await preFlush()
  }
  // A departing chain leaves the set only once it has succeeded. A failed departing save stays tracked and
  // keeps rejecting every later flush, so a retried migration can't proceed past unsaved content.
  const departing = [...departingWriteChains].map((chain) =>
    chain.then(() => {
      departingWriteChains.delete(chain)
    })
  )
  await Promise.all([...[...flushCallbacks].map((flush) => flush()), ...departing])
}
