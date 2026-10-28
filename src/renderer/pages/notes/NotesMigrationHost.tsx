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
 *
 * Lifecycle hardening (verified against the main-side orchestrator):
 * - main ALWAYS terminates a migration with migration_finished: commit, abort after a
 *   failed handshake, the 5s handshake timeout, the 60s commit timeout, and the caller
 *   window closing all end in releaseNotesMigrationSession() -> broadcast. So
 *   migration_finished can arrive while a prepareMutation is still in flight; the
 *   finished flag is then deferred until the prepare settles and finish() runs on the
 *   result, otherwise the late resolution would leave sessions sealed forever.
 * - flush_requested is single-shot per batch. A duplicate for the same in-flight batch
 *   coalesces onto the running prepare (the manager throws on a concurrent second
 *   prepareMutation); a different batch id means the previous batch aborted without this
 *   window observing it, so the stale prepared state is finished before starting fresh.
 */
interface MigrationBatchState {
  batchId: string | null
  preparing: Promise<PreparedFileMutation> | null
  prepared: PreparedFileMutation | null
  finishAfterPrepare: boolean
}

const IDLE_BATCH: MigrationBatchState = {
  batchId: null,
  preparing: null,
  prepared: null,
  finishAfterPrepare: false
}

export function NotesMigrationHost(): null {
  const manager = use(FileEditSessionContext)
  const batchRef = useRef<MigrationBatchState>({ ...IDLE_BATCH })

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

    const finishBatch = async () => {
      const state = batchRef.current
      const prepared = state.prepared
      batchRef.current = { ...IDLE_BATCH }
      if (prepared) {
        try {
          await prepared.finish()
        } catch (error) {
          logger.warn('Failed to release file edit sessions after migration', error as Error)
        }
      }
      notesMigrationLock.reset()
    }

    const startPrepare = () => {
      if (!manager) {
        // No session manager in this window: nothing to seal or flush.
        void ack(true)
        return
      }
      const state = batchRef.current
      state.batchId = batchId
      const preparing = notesMigrationLock.settleEditorMutations().then(() => manager.prepareMutation())
      state.preparing = preparing
      preparing.then(
        (prepared) => {
          if (batchRef.current.preparing !== preparing) return
          batchRef.current.preparing = null
          batchRef.current.prepared = prepared
          if (batchRef.current.finishAfterPrepare) {
            // The migration already ended while the flush was in flight: release the
            // seal immediately instead of storing a prepared nobody will finish.
            void finishBatch()
          } else {
            void ack(true)
          }
        },
        (error) => {
          if (batchRef.current.preparing !== preparing) return
          const deferred = batchRef.current.finishAfterPrepare
          batchRef.current.preparing = null
          batchRef.current.batchId = null
          batchRef.current.finishAfterPrepare = false
          logger.error('Failed to seal and flush file edits before notes migration', error as Error)
          // prepareMutation unseals itself on failure; only the deferred reset remains.
          if (deferred) notesMigrationLock.reset()
          void ack(false)
        }
      )
    }

    const state = batchRef.current
    if (state.prepared || state.preparing) {
      if (state.batchId === batchId) {
        // Duplicate request for the batch already sealing/flushing: coalesce onto it.
        if (state.prepared) {
          void ack(true)
        } else {
          void state.preparing!.then(
            () => ack(true),
            () => ack(false)
          )
        }
        return
      }
      // A different batch means the previous one ended without this window observing
      // migration_finished: release the stale seal before starting the new batch.
      logger.warn('Notes migration flush requested for a new batch while one is in flight', {
        previous: state.batchId,
        next: batchId
      })
      const stale = state.preparing ?? Promise.resolve(state.prepared)
      batchRef.current = { ...IDLE_BATCH }
      void stale
        .catch(() => {})
        .then((prepared) => prepared?.finish().catch(() => {}))
        .then(startPrepare)
      return
    }
    startPrepare()
  })

  useIpcOn('app.notes_relocation.migration_finished', () => {
    const state = batchRef.current
    if (state.preparing) {
      // The prepare owns the unseal path once it settles; keep the UI lock until then.
      state.finishAfterPrepare = true
      return
    }
    const prepared = state.prepared
    batchRef.current = { ...IDLE_BATCH }
    if (prepared) {
      prepared
        .finish()
        .catch((error) => logger.warn('Failed to release file edit sessions after migration', error as Error))
        .finally(() => notesMigrationLock.reset())
    } else {
      notesMigrationLock.reset()
    }
  })

  return null
}
