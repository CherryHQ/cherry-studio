import { useEffect, type FC } from 'react'

import { loggerService } from '@logger'
import {
  flushAllNotesEdits,
  getNotesRelocationBarrierEpoch,
  lockNotesEditsForRelocation,
  releaseOneNotesRelocationEditLock,
  unlockNotesEditsForRelocation,
  waitForStructuralNotesWritesToSettle
} from '@renderer/hooks/notesFileEditFlush'
import { ipcApi, useIpcOn } from '@renderer/ipc'

const logger = loggerService.withContext('NotesRelocationFlushListener')

export const NotesRelocationFlushListener: FC = () => {
  useEffect(() => {
    void ipcApi.request('app.notes_relocation.flush_edits_register').then((result) => {
      if (result.barrierActive) {
        lockNotesEditsForRelocation()
      }
    })
    return () => {
      void ipcApi.request('app.notes_relocation.flush_edits_unregister')
    }
  }, [])

  useIpcOn('app.notes_relocation.barrier_engaged', () => {
    lockNotesEditsForRelocation()
  })

  useIpcOn('app.notes_relocation.migrate_complete', () => {
    unlockNotesEditsForRelocation()
  })

  useIpcOn('app.notes_relocation.flush_edits', async ({ requestId }) => {
    let ok = true
    let lockedForThisFlush = false
    let barrierEpochAtFlushLock = 0
    const releaseFlushLock = () => {
      if (!lockedForThisFlush) {
        return
      }
      lockedForThisFlush = false
      if (barrierEpochAtFlushLock !== getNotesRelocationBarrierEpoch()) {
        return
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
        releaseFlushLock()
        return
      }
      await ipcApi.request('app.notes_relocation.flush_edits_ack', { requestId, ok })
      releaseFlushLock()
    } catch (error) {
      logger.error('Failed to acknowledge notes edit flush', error as Error)
      releaseFlushLock()
    }
  })

  return null
}
