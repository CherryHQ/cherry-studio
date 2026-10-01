import { randomUUID } from 'node:crypto'

import { application } from '@application'
import { loggerService } from '@logger'
import { WindowType } from '@main/core/window/types'
import type { WindowId } from '@shared/ipc/types'

const logger = loggerService.withContext('NotesRelocation:RendererEditFlush')

const HANDSHAKE_TIMEOUT_MS = 5_000

interface PendingBatch {
  remaining: Set<WindowId>
  failed: boolean
  timer: NodeJS.Timeout
  resolve: (success: boolean) => void
}

/**
 * Coordinates renderer handshakes before a notes directory migration: every
 * notes-capable window must lock edits, then persist in-memory drafts (except
 * the caller, which flushes itself) before main copies files on disk.
 */
class RendererEditFlushCoordinator {
  private flushPending = new Map<string, PendingBatch>()
  private lockPending = new Map<string, PendingBatch>()

  private listNotesWindowIds(): WindowId[] {
    const windowManager = application.get('WindowManager')
    return [WindowType.Main, WindowType.SubWindow]
      .flatMap((type) => windowManager.getWindowsByType(type))
      .map((window) => windowManager.getWindowId(window))
      .filter((id): id is WindowId => id !== undefined)
  }

  private waitForAcks(store: Map<string, PendingBatch>, windowIds: WindowId[], label: string): Promise<boolean> {
    if (windowIds.length === 0) {
      return Promise.resolve(true)
    }

    return new Promise<boolean>((resolve) => {
      const batchId = randomUUID()
      const pending: PendingBatch = {
        remaining: new Set(windowIds),
        failed: false,
        timer: undefined as unknown as NodeJS.Timeout,
        resolve: (success) => {
          clearTimeout(pending.timer)
          store.delete(batchId)
          resolve(success)
        }
      }
      pending.timer = setTimeout(() => {
        logger.warn(`Notes migration ${label} timed out for some windows`, {
          windowIds: [...pending.remaining]
        })
        pending.resolve(false)
      }, HANDSHAKE_TIMEOUT_MS)
      pending.timer.unref?.()
      store.set(batchId, pending)

      const ipcApiService = application.get('IpcApiService')
      for (const id of windowIds) {
        ipcApiService.send(id, 'app.notes_relocation.migration_started', { batchId })
      }
    })
  }

  acknowledgeMigrationLock(batchId: string, senderId: WindowId | null, ok: boolean): void {
    this.resolveBatch(this.lockPending, batchId, senderId, ok)
  }

  acknowledgeFlush(batchId: string, senderId: WindowId | null, ok: boolean): void {
    this.resolveBatch(this.flushPending, batchId, senderId, ok)
  }

  private resolveBatch(
    store: Map<string, PendingBatch>,
    batchId: string,
    senderId: WindowId | null,
    ok: boolean
  ): void {
    const pending = store.get(batchId)
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

  async prepareForMigration(): Promise<boolean> {
    const allWindowIds = this.listNotesWindowIds()
    const locked = await this.waitForAcks(this.lockPending, allWindowIds, 'edit lock')
    if (!locked) {
      return false
    }
    if (allWindowIds.length === 0) {
      return true
    }

    return new Promise<boolean>((resolve) => {
      const batchId = randomUUID()
      const pending: PendingBatch = {
        remaining: new Set(allWindowIds),
        failed: false,
        timer: undefined as unknown as NodeJS.Timeout,
        resolve: (success) => {
          clearTimeout(pending.timer)
          this.flushPending.delete(batchId)
          resolve(success)
        }
      }
      pending.timer = setTimeout(() => {
        logger.warn('Notes edit flush timed out for some windows', { windowIds: [...pending.remaining] })
        pending.resolve(false)
      }, HANDSHAKE_TIMEOUT_MS)
      pending.timer.unref?.()
      this.flushPending.set(batchId, pending)

      const ipcApiService = application.get('IpcApiService')
      for (const id of allWindowIds) {
        ipcApiService.send(id, 'app.notes_relocation.flush_requested', { batchId })
      }
    })
  }
}

export const rendererEditFlushCoordinator = new RendererEditFlushCoordinator()
