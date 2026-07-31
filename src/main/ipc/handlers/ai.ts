import { isToolUIPart } from 'ai'

import { application } from '@application'
import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { fileEntryService } from '@data/services/FileEntryService'
import { messageService } from '@data/services/MessageService'
import { loggerService } from '@logger'
import { createAgent } from '@main/ai/agents/createAgent'
import { createBuiltinSupportSession } from '@main/ai/agents/createBuiltinSupportSession'
import { extractAgentSessionId, isAgentSessionTopic } from '@main/ai/agentSession/topic'
import { inflateEntities, isToolOutputBlobEntry, reconstructOutput } from '@main/ai/contextBuild/toolOutputStore'
import { AiStreamAdmissionError, WebContentsListener } from '@main/ai/streamManager'
import { serializeError } from '@main/ai/utils/serializeError'
import type {
  AiStreamOpenRequest,
  AiToolResultResponse,
  PersistedToolOutput,
  PersistedToolOutputBlobRef
} from '@shared/ai/transport'
import { blobRefsOf, isPersistedToolOutput } from '@shared/ai/transport'
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

async function exposeAiStreamAdmission<T>(op: () => Promise<T>): Promise<T> {
  try {
    return await op()
  } catch (error) {
    if (error instanceof AiStreamAdmissionError) {
      throw new IpcError(aiErrorCodes.AI_STREAM_ADMISSION_REJECTED, error.reason, { reason: error.reason })
    }
    throw error
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

/** The persisted half of `ai.tool.get_result` — matches the same shape projection replaces. */
async function findPersistedToolOutput(
  topicId: string,
  messageId: string,
  toolCallId: string
): Promise<AiToolResultResponse> {
  try {
    const parts = isAgentSessionTopic(topicId)
      ? agentSessionMessageService.getSessionMessage(extractAgentSessionId(topicId), messageId).data.parts
      : messageService.getById(messageId).data.parts
    for (const part of parts ?? []) {
      if (!isToolUIPart(part) || part.state !== 'output-available') continue
      if (part.toolCallId !== toolCallId) continue
      if (isPersistedToolOutput(part.output)) {
        return { found: true, output: await resolvePersistedToolOutput(part.output) }
      }
      return { found: true, output: part.output }
    }
  } catch (e) {
    logger.warn('ai.tool.get_result persisted lookup failed', { topicId, messageId, toolCallId, err: e })
  }
  return { found: false }
}

/**
 * Rebuild a `$persistedToolOutput` envelope into the original output by
 * reading the blobs back from FileManager. When an entry is gone (manual DB
 * surgery, restore of an older backup) or is not a blob the tool-output store
 * wrote (a forged / colliding envelope in arbitrary tool output — the
 * ownership gate against reading unrelated entries), that blob degrades to
 * its stored excerpt with an explanatory note rather than `found: false` —
 * the renderer treats a miss as a permanent error, and the excerpt is still
 * real content.
 */
async function resolvePersistedToolOutput(output: PersistedToolOutput): Promise<unknown> {
  const ref = output.$persistedToolOutput
  const readBlob = async (blob: PersistedToolOutputBlobRef): Promise<string> => {
    try {
      const entry = fileEntryService.findById(blob.fileEntryId)
      if (!entry || !isToolOutputBlobEntry(entry)) throw new Error('entry is not a persisted tool-output blob')
      const { content } = await application.get('FileManager').read(blob.fileEntryId, { encoding: 'text' })
      return content
    } catch (e) {
      logger.warn('persisted tool output unavailable, serving excerpt', { fileEntryId: blob.fileEntryId, err: e })
      return `${blob.head}\n\n[persisted output no longer available — showing excerpt of ${blob.totalChars} chars]\n\n${blob.tail}`
    }
  }
  if (ref.shape === 'entities') {
    const texts = Object.fromEntries(
      await Promise.all(ref.blobRefs.map(async (blob) => [blob.key, await readBlob(blob)] as const))
    )
    return inflateEntities(ref, texts)
  }
  return reconstructOutput(ref, await readBlob(blobRefsOf(ref)[0]))
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
  // ── One-shot model calls — AiService owns the provider clients. ──
  'ai.text.generate': (request) =>
    exposeAiError('ai.text.generate', () => application.get('AiService').generateText(request)),
  'ai.embedding.embed_many': (request) =>
    exposeAiError('ai.embedding.embed_many', () => application.get('AiService').embedMany(request)),
  'ai.image.generate': ({ requestId, payload }) =>
    exposeAiError('ai.image.generate', () => application.get('AiService').runImageRequest(requestId, payload)),
  'ai.image.abort': async ({ requestId }) => {
    application.get('AiService').abortImage(requestId)
  },

  // ── Provider model catalog & reachability probe. ──
  'ai.provider.model.list': (request) =>
    exposeAiError('ai.provider.model.list', () => application.get('AiService').listModels(request)),
  'ai.provider.model.check': (request) =>
    exposeAiError('ai.provider.model.check', () => application.get('AiService').checkModel(request)),

  // ── Streaming chat — delegate to AiStreamManager, which owns the stream registry. ──
  'ai.stream.open': async (request, { senderId }) => {
    const wc = senderWebContents(senderId)
    if (!wc) throw new Error('ai.stream.open requires a managed window')
    const subscriber = new WebContentsListener(wc, request.topicId)
    return exposeAiStreamAdmission(() =>
      application.get('AiStreamManager').dispatch(subscriber, request as AiStreamOpenRequest)
    )
  },
  'ai.stream.attach': async (request, { senderId }) => {
    const wc = senderWebContents(senderId)
    if (!wc) throw new Error('ai.stream.attach requires a managed window')
    return application.get('AiStreamManager').attach(wc, request)
  },
  'ai.stream.detach': async (request, { senderId }) => {
    // Best-effort: a gone window has no listener to remove, so a missing WebContents is a no-op.
    const wc = senderWebContents(senderId)
    if (wc) application.get('AiStreamManager').detach(wc, request)
  },
  'ai.stream.abort': async ({ topicId }) => {
    await application.get('AiStreamManager').abortAndDrain(topicId, 'user-requested')
  },

  // ── Tool calls — deferred output lookup + approval decisions. ──
  'ai.tool.get_result': async ({ topicId, messageId, toolCallId }) => {
    // Active stream first: it is the only source holding the value before the message persists.
    const live = application.get('AiStreamManager').getDeferredToolOutput(topicId, toolCallId)
    if (live.found) return live
    return findPersistedToolOutput(topicId, messageId, toolCallId)
  },
  // The continuation dispatch streams to the caller window, so it needs that window's WebContents.
  'ai.tool.respond_approval': (payload, { senderId }) =>
    application.get('AiService').respondToolApproval(payload, senderWebContents(senderId)),

  // ── Agent creation + session warm-connection lifecycle. ──
  'ai.agent.create': createAgent,
  'ai.agent.delete': ({ agentId, deleteSessions }) =>
    application.get('AgentSessionDeliveryService').deleteAgent(agentId, deleteSessions),
  'ai.agent.sessions.delete': ({ agentId }) =>
    application.get('AgentSessionDeliveryService').deleteAgentSessions(agentId),
  'ai.agent.support_session.create': async () => ({ sessionId: createBuiltinSupportSession().id }),
  // Warm-lease acquire: opens the live connection eagerly (not just a warm-query park) so the
  // session's slash-command catalog is read into the cache before the first message — the
  // warm-query handle can't expose it. Trace mode is no exception: the primed connection resolves
  // the session's container trace up front and spawns with TRACEPARENT, and the one thing a traced
  // turn must not reuse — a trace-less warm query — is refused by the driver itself.
  // The per-session connection is shared across windows, so the runtime service aggregates leases
  // by (session × sender WebContents) and tears down only once no window holds the session.
  'ai.agent.session.prewarm': async ({ sessionId }, { senderId }) => {
    application.get('AgentSessionRuntimeService').acquireWarmLease(sessionId, senderWebContents(senderId))
  },
  'ai.agent.session.close_warm': async ({ sessionId }, { senderId }) => {
    application.get('AgentSessionRuntimeService').releaseWarmLease(sessionId, senderWebContents(senderId))
  },
  'ai.agent.session.delete': ({ sessionIds }) =>
    application.get('AgentSessionDeliveryService').deleteSessions(sessionIds),
  'ai.agent.session.reuse_or_create': (input) =>
    application.get('AgentSessionDeliveryService').reuseOrCreateSession(input),
  'ai.agent.workspace.delete': ({ workspaceId }) =>
    application.get('AgentSessionDeliveryService').deleteWorkspace(workspaceId),

  // ── Agent session runtime queries & commands. ──
  'ai.agent.session.refresh_context_usage': async ({ sessionId }) => {
    application.get('AgentSessionRuntimeService').refreshContextUsageOnDemand(sessionId)
  },
  'ai.agent.session.stop_background_task': ({ sessionId, taskId }) =>
    application.get('AgentSessionRuntimeService').stopBackgroundTask(sessionId, taskId),

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
