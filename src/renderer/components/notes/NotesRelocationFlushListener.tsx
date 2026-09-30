import type { FC } from 'react'

import { loggerService } from '@logger'
import { flushAllNotesEdits } from '@renderer/hooks/notesFileEditFlush'
import { ipcApi, useIpcOn } from '@renderer/ipc'

const logger = loggerService.withContext('NotesRelocationFlushListener')

export const NotesRelocationFlushListener: FC = () => {
  useIpcOn('app.notes_relocation.flush_edits', async ({ requestId }) => {
    try {
      await flushAllNotesEdits()
    } catch (error) {
      logger.error('Failed to flush notes edits before relocation', error as Error)
    } finally {
      await ipcApi.request('app.notes_relocation.flush_edits_ack', { requestId })
    }
  })

  return null
}
