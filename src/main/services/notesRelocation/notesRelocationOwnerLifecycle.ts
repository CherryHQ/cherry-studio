import { application } from '@application'

import { getActiveNotesRelocationSession, releaseNotesRelocationSession } from './notesRelocationSession'
import { unregisterRendererNotesEditsFlushWindow } from './requestRendererNotesEditsFlush'

let ownerWindowClosedCleanup: (() => void) | null = null

export function isNotesRelocationOwnerWindowAlive(ownerId: string): boolean {
  const window = application.get('WindowManager').getWindow(ownerId)
  return window != null && !window.isDestroyed()
}

export function bindNotesRelocationSessionOwnerWindow(ownerId: string, onOwnerGone: () => void): void {
  ownerWindowClosedCleanup?.()
  ownerWindowClosedCleanup = null

  const window = application.get('WindowManager').getWindow(ownerId)
  if (window == null || window.isDestroyed()) {
    return
  }

  const handleClosed = () => {
    onOwnerGone()
  }
  window.once('closed', handleClosed)
  ownerWindowClosedCleanup = () => {
    if (!window.isDestroyed()) {
      window.removeListener('closed', handleClosed)
    }
  }
}

export function clearNotesRelocationSessionOwnerWindowBinding(): void {
  ownerWindowClosedCleanup?.()
  ownerWindowClosedCleanup = null
}

export function handleNotesRelocationOwnerWindowGone(ownerId: string, onSessionReleased: () => void): void {
  clearNotesRelocationSessionOwnerWindowBinding()
  const session = getActiveNotesRelocationSession()
  if (session?.ownerId !== ownerId) {
    return
  }
  unregisterRendererNotesEditsFlushWindow(ownerId)
  if (releaseNotesRelocationSession(ownerId, session.epoch)) {
    onSessionReleased()
  }
}

/** Resets module state for unit tests. */
export function resetNotesRelocationOwnerLifecycleForTests(): void {
  clearNotesRelocationSessionOwnerWindowBinding()
}
