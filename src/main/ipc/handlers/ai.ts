import { application } from '@application'
import { IpcError } from '@shared/ipc/errors'
import { aiErrorCodes } from '@shared/ipc/errors/ai'
import type { aiRequestSchemas } from '@shared/ipc/schemas/ai'
import type { IpcHandlersFor } from '@shared/ipc/types'
import { serializeError } from '@shared/utils/error'

/**
 * Thin adapters for the non-streaming AI routes — each delegates to a stateful
 * `AiService` method (business logic, provider resolution and the image abort
 * registry stay in that service). These act on provider/model capabilities, not
 * the caller's window, so they ignore `IpcContext`.
 *
 * Every generating call is wrapped by {@link exposeAiError}: a provider/SDK failure
 * is re-thrown as an `AI_REQUEST_FAILED` IpcError carrying the full SerializedError
 * in `data`. Without this the renderer would only ever see `message` (Electron's
 * invoke reject drops `code`/`data`) — the detail this migration exists to surface.
 */
async function exposeAiError<T>(op: () => Promise<T>): Promise<T> {
  try {
    return await op()
  } catch (e) {
    throw new IpcError(aiErrorCodes.AI_REQUEST_FAILED, e instanceof Error ? e.message : String(e), serializeError(e))
  }
}

export const aiHandlers: IpcHandlersFor<typeof aiRequestSchemas> = {
  'ai.generate_text': (request) => exposeAiError(() => application.get('AiService').generateText(request)),
  'ai.check_model': (request) => exposeAiError(() => application.get('AiService').checkModel(request)),
  'ai.embed_many': (request) => exposeAiError(() => application.get('AiService').embedMany(request)),
  'ai.generate_image': ({ requestId, payload }) =>
    exposeAiError(() => application.get('AiService').runImageRequest(requestId, payload)),
  'ai.abort_image': async ({ requestId }) => {
    application.get('AiService').abortImage(requestId)
  },
  'ai.list_models': (request) => exposeAiError(() => application.get('AiService').listModels(request))
}
