import { application } from '@application'
import { WebContentsListener } from '@main/ai/streamManager/listeners/WebContentsListener'
import { serializeError } from '@main/ai/utils/serializeError'
import type { AiStreamOpenRequest } from '@shared/ai/transport'
import { IpcError } from '@shared/ipc/errors'
import { aiErrorCodes } from '@shared/ipc/errors/ai'
import type { aiRequestSchemas } from '@shared/ipc/schemas/ai'
import type { IpcHandlersFor, WindowId } from '@shared/ipc/types'

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
async function exposeAiError<T>(op: () => Promise<T>): Promise<T> {
  try {
    return await op()
  } catch (e) {
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
  'ai.generate_text': (request) => exposeAiError(() => application.get('AiService').generateText(request)),
  'ai.check_model': (request) => exposeAiError(() => application.get('AiService').checkModel(request)),
  'ai.embed_many': (request) => exposeAiError(() => application.get('AiService').embedMany(request)),
  'ai.generate_image': ({ requestId, payload }) =>
    exposeAiError(() => application.get('AiService').runImageRequest(requestId, payload)),
  'ai.abort_image': async ({ requestId }) => {
    application.get('AiService').abortImage(requestId)
  },
  'ai.list_models': (request) => exposeAiError(() => application.get('AiService').listModels(request)),

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
    // Skip prewarming a session that's already live/streaming: it would spawn a redundant warm
    // subprocess for the active connection (e.g. the message-list mount prewarm firing mid-handoff
    // while the first turn streams). onSessionIdle re-prewarms once the session goes idle.
    if (application.get('AgentSessionRuntimeService').isSessionBusy(sessionId)) return
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
