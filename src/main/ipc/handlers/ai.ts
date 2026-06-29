import { application } from '@application'
import { loggerService } from '@logger'
import { WebContentsListener } from '@main/ai/streamManager/listeners/WebContentsListener'
import type { AiStreamOpenRequest } from '@shared/ai/transport'
import { IpcError } from '@shared/ipc/errors'
import { aiErrorCodes } from '@shared/ipc/errors/ai'
import type { aiRequestSchemas } from '@shared/ipc/schemas/ai'
import type { IpcHandlersFor, WindowId } from '@shared/ipc/types'
import { serializeError } from '@shared/utils/error'

const logger = loggerService.withContext('ipc/ai')

/**
 * Thin adapters for the AI routes. The non-streaming model ops delegate to `AiService`;
 * the streaming-chat ops delegate to `AiStreamManager`. Business logic, provider
 * resolution, the image abort registry and the stream registry all stay in those
 * services — these handlers only translate the IPC call.
 *
 * Every generating call is wrapped by {@link exposeAiError}: a provider/SDK failure
 * is re-thrown as an `AI_REQUEST_FAILED` IpcError carrying the full SerializedError
 * in `data`. Without this the renderer would only ever see `message` (Electron's
 * invoke reject drops `code`/`data`) — the detail this migration exists to surface.
 */
async function exposeAiError<T>(route: string, op: () => Promise<T>): Promise<T> {
  try {
    return await op()
  } catch (e) {
    // Log the FULL serialized error at the source (statusCode / responseBody / AI SDK
    // subtype). The `data` rides the IpcError for the renderer, but Electron's invoke
    // reject keeps only `message`, and a downstream normalize (e.g. the paintings
    // pipeline → `REMOTE_ERROR`) can collapse even that — so the only durable record of
    // the real cause is this log. User-initiated aborts are control flow, not failures.
    if (!(e instanceof Error && e.name === 'AbortError')) {
      logger.error(`${route} failed`, serializeError(e))
    }
    throw new IpcError(aiErrorCodes.AI_REQUEST_FAILED, e instanceof Error ? e.message : String(e), serializeError(e))
  }
}

/**
 * The caller window's `WebContents`, resolved from its WindowId — the stream listener
 * needs the raw `WebContents` for its directed `send` + liveness, which IpcApi hides
 * behind `senderId`. `undefined` when the sender is not a managed window (null senderId
 * or window already gone); stream open/attach reject on that, detach treats it as a no-op.
 */
function senderWebContents(senderId: WindowId | null): Electron.WebContents | undefined {
  if (senderId == null) return undefined
  return application.get('WindowManager').getWindow(senderId)?.webContents
}

export const aiHandlers: IpcHandlersFor<typeof aiRequestSchemas> = {
  'ai.generate_text': (request) =>
    exposeAiError('ai.generate_text', () => application.get('AiService').generateText(request)),
  'ai.check_model': (request) =>
    exposeAiError('ai.check_model', () => application.get('AiService').checkModel(request)),
  'ai.embed_many': (request) => exposeAiError('ai.embed_many', () => application.get('AiService').embedMany(request)),
  'ai.generate_image': ({ requestId, payload }) =>
    exposeAiError('ai.generate_image', () => application.get('AiService').runImageRequest(requestId, payload)),
  'ai.abort_image': async ({ requestId }) => {
    application.get('AiService').abortImage(requestId)
  },
  'ai.list_models': (request) =>
    exposeAiError('ai.list_models', () => application.get('AiService').listModels(request)),

  // ── Streaming chat — delegate to AiStreamManager, which owns the stream registry. ──
  'ai.stream_open': async (request, { senderId }) => {
    const wc = senderWebContents(senderId)
    if (!wc) throw new Error('ai.stream_open requires a managed window')
    const subscriber = new WebContentsListener(wc, request.topicId)
    return application.get('AiStreamManager').dispatch(subscriber, request as AiStreamOpenRequest)
  },
  'ai.stream_attach': async (request, { senderId }) => {
    const wc = senderWebContents(senderId)
    if (!wc) throw new Error('ai.stream_attach requires a managed window')
    return application.get('AiStreamManager').attach(wc, request)
  },
  'ai.stream_detach': async (request, { senderId }) => {
    // Best-effort: a gone window has no listener to remove, so a missing WebContents is a no-op.
    const wc = senderWebContents(senderId)
    if (wc) application.get('AiStreamManager').detach(wc, request)
  },
  'ai.stream_abort': async ({ topicId }) => {
    application.get('AiStreamManager').abort(topicId, 'user-requested')
  },

  // ── Agent sessions & tasks — delegate to the owning services. ──
  'ai.prewarm_agent_session': async ({ sessionId }) => {
    await application.get('ClaudeCodeWarmQueryManager').prewarmAgentSession(sessionId)
  },
  'ai.close_agent_session_warm': async ({ sessionId }) => {
    application.get('ClaudeCodeWarmQueryManager').closeAgentSessionWarm(sessionId)
  },
  // The continuation dispatch streams to the caller window, so it needs that window's WebContents.
  'ai.respond_tool_approval': (payload, { senderId }) =>
    application.get('AiService').respondToolApproval(payload, senderWebContents(senderId)),
  'ai.run_agent_task': async (taskId) => {
    await application.get('AgentJobsService').runTask(taskId)
  }
}
