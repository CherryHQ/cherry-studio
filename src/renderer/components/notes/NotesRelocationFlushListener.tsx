import { useEffect, type FC } from 'react'

import { loggerService } from '@logger'
import { flushAllNotesEdits } from '@renderer/hooks/notesFileEditFlush'
import { ipcApi, useIpcOn } from '@renderer/ipc'

const logger = loggerService.withContext('NotesRelocationFlushListener')

export const NotesRelocationFlushListener: FC = () => {
  useEffect(() => {
    void ipcApi.request('app.notes_relocation.flush_edits_register')
    return () => {
      void ipcApi.request('app.notes_relocation.flush_edits_unregister')
    }
  }, [])

  useIpcOn('app.notes_relocation.flush_edits', async ({ requestId }) => {
    let ok = true
    try {
      await flushAllNotesEdits()
    } catch (error) {
      ok = false
      logger.error('Failed to flush notes edits before relocation', error as Error)
    }

    try {
      await ipcApi.request('app.notes_relocation.flush_edits_ack', { requestId, ok })
    } catch (error) {
      logger.error('Failed to acknowledge notes edit flush', error as Error)
    }
  })

  return null
}
