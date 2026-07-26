import { application } from '@application'
import { loggerService } from '@logger'
import { WebContentsListener } from '@main/ai/streamManager'
import { serializeError } from '@main/ai/utils/serializeError'
import type { AiStreamOpenRequest } from '@shared/ai/transport'
import { JOB_ERROR_CODES } from '@shared/data/api/schemas/jobs'
import { aiErrorCodes } from '@shared/ipc/errors/ai'
import { IpcError } from '@shared/ipc/errors/IpcError'
import type { aiRequestSchemas } from '@shared/ipc/schemas/ai'
import type { IpcHandlersFor, WindowId } from '@shared/ipc/types'

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

/**
 * Domain → transport translation for `ai.agent.task.*` commands. The internal
 * `JOB_SCHEDULE_TRIGGER_INVALID` (a user input error the form must branch on)
 * becomes the AI-domain `AI_AGENT_TASK_TRIGGER_INVALID` IpcError — without this
 * `IpcError.from` would normalize the coded Error to `INTERNAL` and the
 * renderer would lose its branching key. Everything else rethrows untouched.
 */
async function exposeAgentTaskError<T>(op: () => T | Promise<T>): Promise<T> {
  try {
    return await op()
  } catch (e) {
    if (e instanceof Error && (e as { code?: string }).code === JOB_ERROR_CODES.SCHEDULE_TRIGGER_INVALID) {
      throw new IpcError(aiErrorCodes.AI_AGENT_TASK_TRIGGER_INVALID, e.message)
    }
    throw e
  }
}

function agentTaskNotFound(taskId: string): IpcError {
  return new IpcError(aiErrorCodes.AI_AGENT_TASK_NOT_FOUND, `Task not found: ${taskId}`)
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
  // Open the live connection eagerly (not just a warm-query park) so the session's slash-command
  // catalog is read into the cache before the first message — the warm-query handle can't expose it.
  // Trace mode is no exception: the primed connection resolves the session's container trace up front
  // and spawns with TRACEPARENT, and the one thing a traced turn must not reuse — a trace-less warm
  // query — is refused by the driver itself.
  'ai.prewarm_agent_session': ({ sessionId }) =>
    application.get('AgentSessionRuntimeService').primeConnection(sessionId),
  'ai.close_agent_session_warm': async ({ sessionId }) => {
    application.get('ClaudeCodeWarmQueryManager').closeAgentSessionWarm(sessionId)
    // Prewarm now opens a real runtime connection, so releasing the warm-query park alone would leak
    // the primed subprocess until the idle TTL. Tear it down on view close unless a turn is running.
    application.get('AgentSessionRuntimeService').releaseIdleConnection(sessionId)
  },
  'ai.refresh_agent_session_context_usage': async ({ sessionId }) => {
    application.get('AgentSessionRuntimeService').refreshContextUsageOnDemand(sessionId)
  },
  'ai.stop_agent_background_task': ({ sessionId, taskId }) =>
    application.get('AgentSessionRuntimeService').stopBackgroundTask(sessionId, taskId),
  // The continuation dispatch streams to the caller window, so it needs that window's WebContents.
  'ai.respond_tool_approval': (payload, { senderId }) =>
    application.get('AiService').respondToolApproval(payload, senderWebContents(senderId)),
  // ── Agent scheduled-task commands — thin delegation to the owning AgentJobsService. ──
  'ai.agent.task.create': ({ agentId, ...form }) =>
    exposeAgentTaskError(() => application.get('AgentJobsService').createTask(agentId, form)),
  'ai.agent.task.update': ({ agentId, taskId, patch }) =>
    exposeAgentTaskError(async () => {
      const updated = application.get('AgentJobsService').updateTask(agentId, taskId, patch)
      if (!updated) throw agentTaskNotFound(taskId)
      return updated
    }),
  'ai.agent.task.pause': async ({ agentId, taskId }) => {
    const paused = await application.get('AgentJobsService').pauseTask(agentId, taskId)
    if (!paused) throw agentTaskNotFound(taskId)
    return paused
  },
  'ai.agent.task.resume': async ({ agentId, taskId }) => {
    const resumed = application.get('AgentJobsService').resumeTask(agentId, taskId)
    if (!resumed) throw agentTaskNotFound(taskId)
    return resumed
  },
  'ai.agent.task.delete': async ({ agentId, taskId }) => {
    const deleted = await application.get('AgentJobsService').deleteTask(agentId, taskId)
    if (!deleted) throw agentTaskNotFound(taskId)
  },
  'ai.agent.task.run': async ({ agentId, taskId }) => {
    const fired = await application.get('AgentJobsService').runTask(agentId, taskId)
    if (!fired) throw agentTaskNotFound(taskId)
  }
}
