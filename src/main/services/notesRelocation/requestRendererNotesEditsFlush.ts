import { randomUUID } from 'node:crypto'

import { BrowserWindow } from 'electron'

import { application } from '@application'
import { WindowType } from '@main/core/window/types'
import { IpcError } from '@shared/ipc/errors/IpcError'
import { notesRelocationErrorCodes } from '@shared/ipc/errors/notesRelocation'

type PendingFlush = {
  expected: Set<string>
  resolve: () => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

const pendingByRequestId = new Map<string, PendingFlush>()
const registeredFlushWindowIds = new Set<string>()

const FLUSH_TIMEOUT_MS = 30_000

const NOTES_FLUSH_WINDOW_TYPES = new Set<WindowType>([WindowType.Main, WindowType.SubWindow])

export function registerRendererNotesEditsFlushWindow(windowId: string): void {
  registeredFlushWindowIds.add(windowId)
}

export function isRendererNotesEditsFlushWindowRegistered(windowId: string): boolean {
  return registeredFlushWindowIds.has(windowId)
}

export function unregisterRendererNotesEditsFlushWindow(windowId: string): void {
  registeredFlushWindowIds.delete(windowId)

  for (const [requestId, pending] of pendingByRequestId) {
    if (!pending.expected.has(windowId)) {
      continue
    }
    rejectPendingFlush(
      pending,
      requestId,
      new IpcError(
        notesRelocationErrorCodes.NOTES_RELOCATION_FLUSH_FAILED,
        'renderer unregistered before notes edit flush completed'
      )
    )
  }
}

function listOpenNotesFlushCapableWindowIds(): string[] {
  const windowManager = application.get('WindowManager')
  return BrowserWindow.getAllWindows()
    .filter((window) => !window.isDestroyed())
    .map((window) => {
      const windowId = windowManager.getWindowId(window)
      if (windowId == null) {
        return null
      }
      const windowType = windowManager.getWindowType(windowId)
      if (windowType == null || !NOTES_FLUSH_WINDOW_TYPES.has(windowType)) {
        return null
      }
      return windowId
    })
    .filter((id): id is string => id != null)
}

function listRegisteredFlushTargetWindowIds(): string[] {
  return listOpenNotesFlushCapableWindowIds().filter((windowId) => registeredFlushWindowIds.has(windowId))
}

function assertAllOpenNotesWindowsRegisteredForFlush(): void {
  const openWindowIds = listOpenNotesFlushCapableWindowIds()
  const missingListener = openWindowIds.filter((windowId) => !registeredFlushWindowIds.has(windowId))
  if (missingListener.length > 0) {
    throw new IpcError(
      notesRelocationErrorCodes.NOTES_RELOCATION_FLUSH_FAILED,
      'notes flush listener is not registered on all notes renderer windows'
    )
  }
}

function isFlushTargetWindowAvailable(windowId: string): boolean {
  const windowManager = application.get('WindowManager')
  return BrowserWindow.getAllWindows().some((window) => {
    if (window.isDestroyed()) {
      return false
    }
    return windowManager.getWindowId(window) === windowId
  })
}

function rejectPendingFlush(
  pending: PendingFlush,
  requestId: string,
  error: IpcError
): void {
  clearTimeout(pending.timer)
  pendingByRequestId.delete(requestId)
  pending.reject(error)
}

function dropUnavailablePendingFlushTargets(requestId: string, pending: PendingFlush): void {
  for (const windowId of [...pending.expected]) {
    if (isFlushTargetWindowAvailable(windowId)) {
      continue
    }
    rejectPendingFlush(
      pending,
      requestId,
      new IpcError(
        notesRelocationErrorCodes.NOTES_RELOCATION_FLUSH_FAILED,
        'renderer closed before notes edit flush completed'
      )
    )
    return
  }
}

export async function requestRendererNotesEditsFlush(): Promise<void> {
  assertAllOpenNotesWindowsRegisteredForFlush()

  const windowIds = listRegisteredFlushTargetWindowIds()

  if (windowIds.length === 0) {
    return
  }

  const requestId = randomUUID()
  const expected = new Set(windowIds)

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      const pending = pendingByRequestId.get(requestId)
      if (pending) {
        rejectPendingFlush(
          pending,
          requestId,
          new IpcError(
            notesRelocationErrorCodes.NOTES_RELOCATION_FLUSH_FAILED,
            'timed out waiting for notes edit flush acknowledgements'
          )
        )
        return
      }
      reject(
        new IpcError(
          notesRelocationErrorCodes.NOTES_RELOCATION_FLUSH_FAILED,
          'timed out waiting for notes edit flush acknowledgements'
        )
      )
    }, FLUSH_TIMEOUT_MS)

    const availabilityTimer = setInterval(() => {
      const pending = pendingByRequestId.get(requestId)
      if (!pending) {
        clearInterval(availabilityTimer)
        return
      }
      dropUnavailablePendingFlushTargets(requestId, pending)
    }, 500)

    const pending: PendingFlush = {
      expected,
      resolve: () => {
        clearInterval(availabilityTimer)
        resolve()
      },
      reject: (error) => {
        clearInterval(availabilityTimer)
        reject(error)
      },
      timer
    }

    pendingByRequestId.set(requestId, pending)
    application.get('IpcApiService').broadcast('app.notes_relocation.flush_edits', { requestId })
  })
}

export function acknowledgeRendererNotesEditsFlush(requestId: string, senderId: string | null, ok: boolean): void {
  if (senderId == null) {
    return
  }

  const pending = pendingByRequestId.get(requestId)
  if (!pending) {
    return
  }

  if (!pending.expected.has(senderId)) {
    return
  }

  dropUnavailablePendingFlushTargets(requestId, pending)
  if (!pendingByRequestId.has(requestId)) {
    return
  }

  pending.expected.delete(senderId)

  if (!ok) {
    rejectPendingFlush(
      pending,
      requestId,
      new IpcError(notesRelocationErrorCodes.NOTES_RELOCATION_FLUSH_FAILED, 'notes edit flush failed')
    )
    return
  }

  if (pending.expected.size > 0) {
    return
  }

  clearTimeout(pending.timer)
  pendingByRequestId.delete(requestId)
  pending.resolve()
}
