import { application } from '@application'
import type { notesRequestSchemas } from '@shared/ipc/schemas/notes'
import type { IpcHandlersFor } from '@shared/ipc/types'

export const notesHandlers: IpcHandlersFor<typeof notesRequestSchemas> = {
  'notes.full_text.search': async ({ requestId, nodes, keyword, options, maxResults }, { senderId }) => {
    if (senderId === null) {
      return []
    }

    return application
      .get('NotesSearchService')
      .search({ nodes, keyword, options, maxResults }, { requestId, senderId })
  },
  'notes.full_text.cancel': async ({ requestId }, { senderId }) => {
    if (senderId === null) {
      return
    }

    application.get('NotesSearchService').cancel({ requestId, senderId })
  }
}
