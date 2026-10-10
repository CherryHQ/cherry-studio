import { application } from '@application'

import {
  getActiveNotesRelocationSession,
  isNotesRelocationMigrateInFlight,
  releaseNotesRelocationSession
} from './notesRelocationSession'
import {
  isRendererNotesEditsFlushWindowRegistered,
  unregisterRendererNotesEditsFlushWindow
} from './requestRendererNotesEditsFlush'

let ownerWindowClosedCleanup: (() => void) | null = null
let ownerUnavailableDuringMigrate = false

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

  let notified = false
  const notifyOwnerGone = () => {
    if (notified) {
      return
    }
    notified = true
    onOwnerGone()
  }

  window.once('closed', notifyOwnerGone)

  const { webContents } = window
  const handleRenderProcessGone = () => {
    notifyOwnerGone()
  }
  const handleMainFrameNavigation = (
    _event: Electron.Event,
    _url: string,
    isInPlace: boolean,
    isMainFrame: boolean
  ) => {
    if (isMainFrame && !isInPlace) {
      notifyOwnerGone()
    }
  }

  if (webContents != null && !webContents.isDestroyed()) {
    webContents.on('render-process-gone', handleRenderProcessGone)
    webContents.on('did-start-navigation', handleMainFrameNavigation)
  }

  ownerWindowClosedCleanup = () => {
    if (!window.isDestroyed()) {
      window.removeListener('closed', notifyOwnerGone)
    }
    if (webContents != null && !webContents.isDestroyed()) {
      webContents.removeListener('render-process-gone', handleRenderProcessGone)
      webContents.removeListener('did-start-navigation', handleMainFrameNavigation)
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
  if (isNotesRelocationMigrateInFlight()) {
    ownerUnavailableDuringMigrate = true
    return
  }
  if (releaseNotesRelocationSession(ownerId, session.epoch)) {
    onSessionReleased()
  }
}

export function finalizeNotesRelocationAfterMigrate(ownerId: string, onSessionReleased: () => void): void {
  const session = getActiveNotesRelocationSession()
  if (session?.ownerId !== ownerId) {
    return
  }

  const ownerUnavailable =
    ownerUnavailableDuringMigrate ||
    !isNotesRelocationOwnerWindowAlive(ownerId) ||
    !isRendererNotesEditsFlushWindowRegistered(ownerId)
  ownerUnavailableDuringMigrate = false
  if (!ownerUnavailable) {
    return
  }

  if (releaseNotesRelocationSession(ownerId, session.epoch)) {
    clearNotesRelocationSessionOwnerWindowBinding()
    onSessionReleased()
  }
}

/** Resets module state for unit tests. */
export function resetNotesRelocationOwnerLifecycleForTests(): void {
  clearNotesRelocationSessionOwnerWindowBinding()
  ownerUnavailableDuringMigrate = false
}
