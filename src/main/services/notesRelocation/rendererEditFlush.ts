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

let migrationLockBroadcastBatchId: string | null = null
let windowListenerRegistered = false

function registerNotesWindowMigrationLockListener(): void {
  if (windowListenerRegistered) {
    return
  }
  windowListenerRegistered = true
  const windowManager = application.get('WindowManager')
  windowManager.onWindowCreated((managed) => {
    if (managed.type !== WindowType.Main && managed.type !== WindowType.SubWindow) {
      return
    }
    const windowId = windowManager.getWindowId(managed.window)
    if (windowId) {
      rendererEditFlushCoordinator.syncMigrationLockToWindow(windowId)
    }
  })
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
      if (label === 'edit lock') {
        migrationLockBroadcastBatchId = batchId
      }
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

  syncMigrationLockToWindow(windowId: WindowId): void {
    if (!migrationLockBroadcastBatchId) {
      return
    }
    application
      .get('IpcApiService')
      .send(windowId, 'app.notes_relocation.migration_started', { batchId: migrationLockBroadcastBatchId })
  }

  clearMigrationLockBroadcast(): void {
    migrationLockBroadcastBatchId = null
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

  private async lockAllNotesWindows(): Promise<boolean> {
    const locked = new Set<WindowId>()
    while (true) {
      const pending = this.listNotesWindowIds().filter((id) => !locked.has(id))
      if (pending.length === 0) {
        return true
      }
      const ok = await this.waitForAcks(this.lockPending, pending, 'edit lock')
      if (!ok) {
        return false
      }
      for (const id of pending) {
        locked.add(id)
      }
    }
  }

  async prepareForMigration(): Promise<boolean> {
    registerNotesWindowMigrationLockListener()
    const locked = await this.lockAllNotesWindows()
    if (!locked) {
      this.clearMigrationLockBroadcast()
      return false
    }
    const allWindowIds = this.listNotesWindowIds()
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

export function clearRendererMigrationLockBroadcast(): void {
  rendererEditFlushCoordinator.clearMigrationLockBroadcast()
}
