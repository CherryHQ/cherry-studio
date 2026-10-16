import { printService } from '@main/services/PrintService'
import { IpcError, IpcErrorCode } from '@shared/ipc/errors/IpcError'
import type { printRequestSchemas } from '@shared/ipc/schemas/print'
import type { IpcHandlersFor } from '@shared/ipc/types'

export const printHandlers: IpcHandlersFor<typeof printRequestSchemas> = {
  'print.document.ready': async ({ error }, { senderId }) => {
    if (!senderId) throw new IpcError(IpcErrorCode.FORBIDDEN_SENDER)
    printService.completeDocumentRender(senderId, error)
  },
  'print.export_pdf': async (payload) => printService.exportToPdf(payload),
  'print.print': async (payload) => printService.print(payload)
}
