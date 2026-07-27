import { application } from '@application'
import type { fileProcessingRequestSchemas } from '@shared/ipc/schemas/fileProcessing'
import type { IpcHandlersFor } from '@shared/ipc/types'

/**
 * Thin adapters for the file-processing request routes: each one translates a parsed
 * route call into a `FileProcessingService` method (business logic + resource lifecycle
 * stay in that service). These routes act on shared business data, not the caller's
 * window, so they ignore `IpcContext` — there is no `senderId` addressing here
 * (contrast window.ts).
 */
export const fileProcessingHandlers: IpcHandlersFor<typeof fileProcessingRequestSchemas> = {
  'file_processing.start_job': async (input) =>
    application.get('FileProcessingService').startJob({ ...input, file: input.file }),
  'file_processing.list_available_processors': async () =>
    application.get('FileProcessingService').listAvailableProcessors()
}
