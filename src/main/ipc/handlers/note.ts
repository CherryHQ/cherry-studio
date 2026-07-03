import { notePrintService } from '@main/services/NotePrintService'
import type { noteRequestSchemas } from '@shared/ipc/schemas/note'
import type { IpcHandlersFor } from '@shared/ipc/types'

export const noteHandlers: IpcHandlersFor<typeof noteRequestSchemas> = {
  'note.export_pdf': async (payload) => notePrintService.exportToPDF(payload),
  'note.print': async (payload) => notePrintService.print(payload)
}
