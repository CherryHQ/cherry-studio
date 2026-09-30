import { randomUUID } from 'node:crypto'

import { BrowserWindow } from 'electron'

import { application } from '@application'

type PendingFlush = {
  expected: Set<string>
  resolve: () => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

const pendingByRequestId = new Map<string, PendingFlush>()

const FLUSH_TIMEOUT_MS = 30_000

export async function requestRendererNotesEditsFlush(): Promise<void> {
  const windowManager = application.get('WindowManager')
  const windowIds = BrowserWindow.getAllWindows()
    .filter((window) => !window.isDestroyed())
    .map((window) => windowManager.getWindowId(window))
    .filter((id): id is string => id != null)

  if (windowIds.length === 0) {
    return
  }

  const requestId = randomUUID()
  const expected = new Set(windowIds)

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingByRequestId.delete(requestId)
      reject(new Error('timed out waiting for notes edit flush acknowledgements'))
    }, FLUSH_TIMEOUT_MS)

    pendingByRequestId.set(requestId, { expected, resolve, reject, timer })
    application.get('IpcApiService').broadcast('app.notes_relocation.flush_edits', { requestId })
  })
}

export function acknowledgeRendererNotesEditsFlush(requestId: string, senderId: string | null): void {
  if (senderId == null) {
    return
  }

  const pending = pendingByRequestId.get(requestId)
  if (!pending) {
    return
  }

  pending.expected.delete(senderId)
  if (pending.expected.size > 0) {
    return
  }

  clearTimeout(pending.timer)
  pendingByRequestId.delete(requestId)
  pending.resolve()
}
