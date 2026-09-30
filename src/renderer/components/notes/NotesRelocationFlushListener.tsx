import type { FC } from 'react'

import { flushAllNotesEdits } from '@renderer/hooks/notesFileEditFlush'
import { ipcApi, useIpcOn } from '@renderer/ipc'

export const NotesRelocationFlushListener: FC = () => {
  useIpcOn('app.notes_relocation.flush_edits', async ({ requestId }) => {
    await flushAllNotesEdits()
    await ipcApi.request('app.notes_relocation.flush_edits_ack', { requestId })
  })

  return null
}
