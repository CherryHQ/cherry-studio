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

  useIpcOn('app.notes_relocation.migrate_complete', () => {
    unlockNotesEditsForRelocation()
  })

  useIpcOn('app.notes_relocation.flush_edits', async ({ requestId }) => {
    lockNotesEditsForRelocation()
    let ok = true
    try {
      await waitForStructuralNotesWritesToSettle()
      await flushAllNotesEdits()
    } catch (error) {
      ok = false
      logger.error('Failed to flush notes edits before relocation', error as Error)
    }

    if (!ok) {
      unlockNotesEditsForRelocation()
    }

    try {
      await ipcApi.request('app.notes_relocation.flush_edits_ack', { requestId, ok })
    } catch (error) {
      logger.error('Failed to acknowledge notes edit flush', error as Error)
      unlockNotesEditsForRelocation()
    }
  })

  return null
}
