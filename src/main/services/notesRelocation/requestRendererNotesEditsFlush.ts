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

export function unregisterRendererNotesEditsFlushWindow(windowId: string): void {
  registeredFlushWindowIds.delete(windowId)
}

function listRegisteredFlushTargetWindowIds(): string[] {
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
      if (!registeredFlushWindowIds.has(windowId)) {
        return null
      }
      return windowId
    })
    .filter((id): id is string => id != null)
}

export async function requestRendererNotesEditsFlush(): Promise<void> {
  const windowIds = listRegisteredFlushTargetWindowIds()

  if (windowIds.length === 0) {
    return
  }

  const requestId = randomUUID()
  const expected = new Set(windowIds)

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingByRequestId.delete(requestId)
      reject(
        new IpcError(
          notesRelocationErrorCodes.NOTES_RELOCATION_FLUSH_FAILED,
          'timed out waiting for notes edit flush acknowledgements'
        )
      )
    }, FLUSH_TIMEOUT_MS)

    pendingByRequestId.set(requestId, { expected, resolve, reject, timer })
    application.get('IpcApiService').broadcast('app.notes_relocation.flush_edits', { requestId })
  })
}

export function acknowledgeRendererNotesEditsFlush(
  requestId: string,
  senderId: string | null,
  ok: boolean
): void {
  if (senderId == null) {
    return
  }

  const pending = pendingByRequestId.get(requestId)
  if (!pending) {
    return
  }

  pending.expected.delete(senderId)

  if (!ok) {
    clearTimeout(pending.timer)
    pendingByRequestId.delete(requestId)
    pending.reject(
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
