import { use, useEffect, useRef } from 'react'

import { loggerService } from '@logger'
import { FileEditSessionContext } from '@renderer/hooks/useFileEditSession'
import { ipcApi, useIpcOn } from '@renderer/ipc'
import type { PreparedFileMutation } from '@renderer/services/fileEdit/FileEditSessionManager'
import { notesMigrationLock } from '@renderer/services/notesMigrationLock'

const logger = loggerService.withContext('NotesMigrationHost')

/**
 * Wires the main-process notes-migration handshake into this window's
 * FileEditSessionManager. Mounted once per window under FileEditSessionProvider.
 *
 * Protocol (main orchestrates, every notes-capable window acknowledges):
 * - migration_started: engage the local lock (UI notes actions block with a toast)
 *   and acknowledge.
 * - flush_requested: prepareMutation() seals every file-edit session in this window
 *   (leases refuse edits) and flushes dirty sessions; acknowledge ok, or not-ok when
 *   a flush fails - the manager unseals itself in that case and the migration aborts.
 * - migration_finished: finish() invalidates stale sessions and unseals; reset the lock.
 */
export function NotesMigrationHost(): null {
  const manager = use(FileEditSessionContext)
  const preparedRef = useRef<PreparedFileMutation | null>(null)

  useEffect(() => {
    void ipcApi
      .request('app.notes_relocation.sync_state')
      .then(({ migrationLocked }) => {
        if (migrationLocked && !notesMigrationLock.isLocked()) {
          notesMigrationLock.begin()
        }
      })
      .catch((error) => logger.warn('Failed to sync notes migration lock state', error as Error))
  }, [])

  useIpcOn('app.notes_relocation.migration_started', ({ batchId }) => {
    notesMigrationLock.begin()
    void ipcApi
      .request('app.notes_relocation.migration_lock_ack', { batchId, ok: true })
      .catch((error) => logger.warn('Failed to acknowledge notes migration lock', error as Error))
  })

  useIpcOn('app.notes_relocation.flush_requested', ({ batchId }) => {
    const ack = (ok: boolean) =>
      ipcApi
        .request('app.notes_relocation.flush_ack', { batchId, ok })
        .catch((error) => logger.warn('Failed to acknowledge notes edit flush', error as Error))
    if (preparedRef.current) {
      // Already sealed and flushed for this migration.
      void ack(true)
      return
    }
    if (!manager) {
      // No session manager in this window: nothing to seal or flush.
      void ack(true)
      return
    }
    void notesMigrationLock
      .settleEditorMutations()
      .then(() => manager.prepareMutation())
      .then(
        (prepared) => {
          preparedRef.current = prepared
          return ack(true)
        },
        (error) => {
          logger.error('Failed to seal and flush file edits before notes migration', error as Error)
          return ack(false)
        }
      )
  })

  useIpcOn('app.notes_relocation.migration_finished', () => {
    const prepared = preparedRef.current
    preparedRef.current = null
    if (prepared) {
      prepared
        .finish()
        .catch((error) => logger.warn('Failed to release file edit sessions after migration', error as Error))
    }
    notesMigrationLock.reset()
  })

  return null
}
