import { useEffect, type FC, use } from 'react'

import { loggerService } from '@logger'
import { NOTES_FILE_EDIT_OWNER_ID } from '@renderer/components/notes/NotesFileEditSessionProvider'
import {
  flushAllNotesEdits,
  getNotesRelocationBarrierEpoch,
  lockNotesEditsForRelocation,
  releaseOneNotesRelocationEditLock,
  unlockNotesEditsForRelocation,
  waitForStructuralNotesWritesToSettle
} from '@renderer/hooks/notesFileEditFlush'
import { FileEditSessionContext } from '@renderer/hooks/useFileEditSession'
import { ipcApi, useIpcOn } from '@renderer/ipc'

const logger = loggerService.withContext('NotesRelocationFlushListener')

/**
 * Drives the notes edit barrier for this window. The module lock engages at
 * barrier_engaged (autosave deferred, structural writes blocked, edits still
 * captured); the manager seal engages only inside the flush's drain - after
 * pending pastes and pre-flush text pulls have landed - and is held until
 * migrate_complete, which the main process broadcasts on every session end,
 * including aborts.
 */
export const NotesRelocationFlushListener: FC = () => {
  const manager = use(FileEditSessionContext)
  useEffect(() => {
    void ipcApi
      .request('app.notes_relocation.flush_edits_register')
      .then((result) => {
        if (result.barrierActive) {
          lockNotesEditsForRelocation()
        }
      })
      .catch((error: unknown) => logger.error('Failed to register notes edit flush listener', error as Error))
    return () => {
      void ipcApi
        .request('app.notes_relocation.flush_edits_unregister')
        .catch((error: unknown) =>
          logger.warn('Failed to unregister notes edit flush listener', { error: error as Error })
        )
    }
  }, [])

  useIpcOn('app.notes_relocation.barrier_engaged', () => {
    lockNotesEditsForRelocation()
  })

  useIpcOn('app.notes_relocation.migrate_complete', () => {
    manager?.releaseOwner(NOTES_FILE_EDIT_OWNER_ID)
    unlockNotesEditsForRelocation()
  })

  useIpcOn('app.notes_relocation.flush_edits', async ({ requestId }) => {
    let ok = true
    let lockedForThisFlush = false
    let barrierEpochAtFlushLock = 0
    let acknowledgedThisRequest = false
    const releaseFlushLock = async (afterAck: boolean) => {
      if (!lockedForThisFlush) {
        return
      }
      lockedForThisFlush = false
      if (barrierEpochAtFlushLock !== getNotesRelocationBarrierEpoch()) {
        return
      }
      if (!afterAck) {
        // Fail closed: release only when the request is confirmed still live.
        // A vanished request (!pending) or an unverifiable one (IPC failure)
        // keeps the lock held; migrate_complete clears the barrier lock and
        // bumps its epoch, so a held lock can neither leak past the barrier
        // nor release into a new one.
        let pending: boolean
        try {
          ;({ pending } = await ipcApi.request('app.notes_relocation.flush_edits_pending', { requestId }))
        } catch (error) {
          logger.warn('Flush-lock release could not verify the request settled; holding until migrate_complete', {
            error: error as Error
          })
          return
        }
        if (!pending) {
          return
        }
      }
      releaseOneNotesRelocationEditLock()
    }

    try {
      await waitForStructuralNotesWritesToSettle()
      const { pending } = await ipcApi.request('app.notes_relocation.flush_edits_pending', { requestId })
      if (!pending) {
        return
      }
      lockNotesEditsForRelocation()
      lockedForThisFlush = true
      barrierEpochAtFlushLock = getNotesRelocationBarrierEpoch()
      await flushAllNotesEdits()
    } catch (error) {
      ok = false
      logger.error('Failed to flush notes edits before relocation', error as Error)
    }

    try {
      const { pending } = await ipcApi.request('app.notes_relocation.flush_edits_pending', { requestId })
      if (!pending) {
        await releaseFlushLock(false)
        return
      }
      await ipcApi.request('app.notes_relocation.flush_edits_ack', { requestId, ok })
      acknowledgedThisRequest = true
      await releaseFlushLock(true)
    } catch (error) {
      logger.error('Failed to acknowledge notes edit flush', error as Error)
      if (acknowledgedThisRequest) {
        await releaseFlushLock(true)
      } else {
        await releaseFlushLock(false)
      }
    }
  })

  return null
}
