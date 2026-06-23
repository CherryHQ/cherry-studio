import { application } from '@application'
import type { fileProcessingRequestSchemas } from '@shared/ipc/schemas/fileProcessing'
import type { IpcHandlersFor } from '@shared/ipc/types'
import type { FileHandle } from '@shared/types/file'

/**
 * Thin adapters for the file-processing request routes: each one translates a parsed
 * route call into a `FileProcessingService` method (business logic + resource lifecycle
 * stay in that service). These routes act on shared business data, not the caller's
 * window, so they ignore `IpcContext` — there is no `senderId` addressing here
 * (contrast window.ts).
 *
 * `start_job` casts the parsed `file` to `FileHandle`: `FileHandleSchema` validates the
 * shape at runtime but infers `path: string`, whereas `FileHandle.path` is the
 * template-literal `FilePath`. The cast bridges that template-literal-vs-`string` gap
 * (the repo convention — see FileManager.ts).
 */
export const fileProcessingHandlers: IpcHandlersFor<typeof fileProcessingRequestSchemas> = {
  'file_processing.start_job': async (input) =>
    application.get('FileProcessingService').startJob({ ...input, file: input.file as FileHandle }),
  'file_processing.list_available_processors': async () =>
    application.get('FileProcessingService').listAvailableProcessors()
}
