import { randomUUID } from 'node:crypto'

import { application } from '@application'
import { loggerService } from '@logger'
import { WindowType } from '@main/core/window/types'
import type { WindowId } from '@shared/ipc/types'

const logger = loggerService.withContext('NotesRelocation:RendererEditFlush')

const FLUSH_TIMEOUT_MS = 5_000

interface PendingBatch {
  remaining: Set<WindowId>
  failed: boolean
  timer: NodeJS.Timeout
  resolve: (success: boolean) => void
}

/**
 * Coordinates the "flush unsaved note drafts" handshake between the main
 * process and renderer windows before a notes directory migration: drafts live
 * in renderer memory, so every notes-capable window except the caller (which
 * flushes itself) is asked to flush and must acknowledge. The wait is bounded
 * by a timeout so a gone or unresponsive window cannot block migration.
 */
class RendererEditFlushCoordinator {
  private pending = new Map<string, PendingBatch>()

  async flush(excludeWindowId: WindowId | null): Promise<boolean> {
    const windowManager = application.get('WindowManager')
    const targetIds = [WindowType.Main, WindowType.SubWindow]
      .flatMap((type) => windowManager.getWindowsByType(type))
      .map((window) => windowManager.getWindowId(window))
      .filter((id): id is WindowId => id !== undefined && id !== excludeWindowId)

    if (targetIds.length === 0) {
      return true
    }

    return new Promise<boolean>((resolve) => {
      const batchId = randomUUID()
      const pending: PendingBatch = {
        remaining: new Set(targetIds),
        failed: false,
        timer: undefined as unknown as NodeJS.Timeout,
        resolve: (success) => {
          clearTimeout(pending.timer)
          this.pending.delete(batchId)
          resolve(success)
        }
      }
      pending.timer = setTimeout(() => {
        logger.warn('Notes edit flush timed out for some windows', { windowIds: [...pending.remaining] })
        pending.resolve(!pending.failed)
      }, FLUSH_TIMEOUT_MS)
      pending.timer.unref?.()
      this.pending.set(batchId, pending)

      const ipcApiService = application.get('IpcApiService')
      for (const id of targetIds) {
        ipcApiService.send(id, 'app.notes_relocation.flush_requested', { batchId })
      }
    })
  }

  acknowledge(batchId: string, senderId: WindowId | null, ok: boolean): void {
    const pending = this.pending.get(batchId)
    if (!pending) {
      return
    }
    if (!ok) {
      pending.failed = true
    }
    if (senderId) {
      pending.remaining.delete(senderId)
    }
    if (pending.remaining.size === 0) {
      pending.resolve(!pending.failed)
    }
  }
}

export const rendererEditFlushCoordinator = new RendererEditFlushCoordinator()
