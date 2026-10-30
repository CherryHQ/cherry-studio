import { printService } from '@main/services/PrintService'
import type { printRequestSchemas } from '@shared/ipc/schemas/print'
import type { IpcHandlersFor } from '@shared/ipc/types'

export const printHandlers: IpcHandlersFor<typeof printRequestSchemas> = {
  'print.export_pdf': async (payload, ctx) => printService.exportToPdf(payload, ctx.senderId),
  'print.print': async (payload) => printService.print(payload)
}
