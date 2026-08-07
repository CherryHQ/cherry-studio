import { diagnosticBundleService } from '@main/services/diagnostics'
import type { diagnosticsRequestSchemas } from '@shared/ipc/schemas/diagnostics'
import type { IpcHandlersFor } from '@shared/ipc/types'

export const diagnosticsHandlers: IpcHandlersFor<typeof diagnosticsRequestSchemas> = {
  'diagnostics.bundle.inspect': async ({ range }) => diagnosticBundleService.inspect(range),
  'diagnostics.bundle.export': async (input, { senderId }) => diagnosticBundleService.exportBundle(input, senderId)
}
