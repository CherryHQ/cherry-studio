import { useEffect, type FC } from 'react'

import { loggerService } from '@logger'
import {
  flushAllNotesEdits,
  lockNotesEditsForRelocation,
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
    try {
      await waitForStructuralNotesWritesToSettle()
      const { pending } = await ipcApi.request('app.notes_relocation.flush_edits_pending', { requestId })
      if (!pending) {
        return
      }
      lockNotesEditsForRelocation()
      lockedForThisFlush = true
      await flushAllNotesEdits()
    } catch (error) {
      ok = false
      logger.error('Failed to flush notes edits before relocation', error as Error)
    }

    if (lockedForThisFlush && !ok) {
      unlockNotesEditsForRelocation()
    }

    try {
      const { pending } = await ipcApi.request('app.notes_relocation.flush_edits_pending', { requestId })
      if (!pending) {
        if (lockedForThisFlush && ok) {
          unlockNotesEditsForRelocation()
        }
        return
      }
      await ipcApi.request('app.notes_relocation.flush_edits_ack', { requestId, ok })
    } catch (error) {
      logger.error('Failed to acknowledge notes edit flush', error as Error)
      if (lockedForThisFlush) {
        unlockNotesEditsForRelocation()
      }
    }
  })

  return null
}
