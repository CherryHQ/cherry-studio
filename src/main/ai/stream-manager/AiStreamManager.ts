import { loggerService } from '@logger'
import { application } from '@main/core/application'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { messageService } from '@main/data/services/MessageService'
import { reduxService } from '@main/services/ReduxService'
import type {
  AiStreamAbortRequest,
  AiStreamAttachRequest,
  AiStreamAttachResponse,
  AiStreamDetachRequest,
  AiStreamOpenRequest
} from '@shared/ai/transport'
import type { Message } from '@shared/data/types/message'
import type { UniqueModelId } from '@shared/data/types/model'
import { IpcChannel } from '@shared/IpcChannel'
import type { SerializedError } from '@shared/types/error'
import { serializeError } from '@shared/types/error'
import type { UIMessageChunk } from 'ai'

import type { AiStreamRequest } from '../AiCompletionService'
import { PendingMessageQueue } from '../PendingMessageQueue'
import { InternalStreamTarget } from './InternalStreamTarget'
import { PersistenceListener } from './listeners/PersistenceListener'
import { WebContentsListener } from './listeners/WebContentsListener'
import type { ActiveStream, AiStreamManagerConfig, CherryUIMessage, StreamExecution, StreamListener } from './types'

const logger = loggerService.withContext('AiStreamManager')

/**
 * Active-stream registry for AI streaming.
 *
 * Keyed by `topicId` — one topic has at most one ActiveStream at any time.
 * Each ActiveStream contains one or more StreamExecutions (one per model).
 * Streaming is just one state of a topic; all subscribers subscribe to the topic.
 */
@Injectable('AiStreamManager')
@ServicePhase(Phase.WhenReady)
export class AiStreamManager extends BaseService {
  private readonly activeStreams = new Map<string, ActiveStream>()

  private readonly config: AiStreamManagerConfig = {
    gracePeriodMs: 30_000,
    backgroundMode: 'continue',
    maxBufferChunks: 10_000
  }

  protected async onInit(): Promise<void> {
    this.ipcHandle(IpcChannel.Ai_Stream_Open, async (event, req: AiStreamOpenRequest) => {
      return this.handleStreamRequest(event.sender, req)
    })

    this.ipcHandle(IpcChannel.Ai_Stream_Attach, (event, req: AiStreamAttachRequest) => {
      return this.handleAttach(event.sender, req)
    })

    this.ipcHandle(IpcChannel.Ai_Stream_Detach, (event, req: AiStreamDetachRequest) => {
      this.handleDetach(event.sender, req)
    })

    this.ipcHandle(IpcChannel.Ai_Stream_Abort, (_, req: AiStreamAbortRequest) => {
      this.abort(req.topicId, 'user-requested')
    })

    logger.info('AiStreamManager initialized')
  }

  /**
   * Graceful shutdown: abort all active streams so PersistenceListener
   * can persist partial results before the process exits.
   */
  protected async onStop(): Promise<void> {
    const activeTopics = [...this.activeStreams.entries()]
      .filter(([, s]) => s.status === 'streaming')
      .map(([topicId]) => topicId)

    if (activeTopics.length === 0) return
    logger.info('Stopping active streams on shutdown', { count: activeTopics.length })

    for (const topicId of activeTopics) {
      this.abort(topicId, 'app-shutdown')
    }

    // Wait for all PersistenceListeners to finish persisting partial results
    const donePromises: Promise<void>[] = []
    for (const topicId of activeTopics) {
      const stream = this.activeStreams.get(topicId)
      if (!stream) continue
      for (const exec of stream.executions.values()) {
        donePromises.push(this.broadcastExecutionDone(stream, exec, 'paused'))
      }
    }
    await Promise.allSettled(donePromises)
  }

  // ── Public: start execution ───────────────────────────────────────

  /**
   * Start a new execution for a topic.
   *
   * Single-model: creates a new ActiveStream with one execution.
   * Multi-model: can add an execution to an existing streaming ActiveStream.
   *
   * @param modelId - The model id for this execution. Must come from the resolved
   *                  assistant config, not a magic string.
   */
  startExecution(input: {
    topicId: string
    modelId: UniqueModelId
    request: AiStreamRequest
    listeners: StreamListener[]
    siblingsGroupId?: number
  }): ActiveStream {
    const existing = this.activeStreams.get(input.topicId)

    if (existing) {
      if (existing.status === 'streaming') {
        // Multi-model: add execution to existing active stream
        if (existing.executions.has(input.modelId)) {
          throw new Error(`Topic ${input.topicId} already has an execution for model ${input.modelId}`)
        }
        const exec = this.createAndLaunchExecution(input.topicId, input.modelId, input.request, input.siblingsGroupId)
        existing.executions.set(input.modelId, exec)
        for (const listener of input.listeners) existing.listeners.set(listener.id, listener)
        return existing
      }
      // Grace period: evict finished stream, inherit sourceSessionId
      this.evictStream(input.topicId)
    }

    // Create new ActiveStream with one execution
    const exec = this.createAndLaunchExecution(input.topicId, input.modelId, input.request, input.siblingsGroupId)
    const stream: ActiveStream = {
      topicId: input.topicId,
      executions: new Map([[input.modelId, exec]]),
      listeners: new Map(input.listeners.map((l) => [l.id, l])),
      pendingMessages: new PendingMessageQueue(),
      buffer: [],
      status: 'streaming'
    }
    this.activeStreams.set(input.topicId, stream)
    return stream
  }

  /**
   * Unified "send message for a topic" entry point.
   *
   * - Topic has active streaming → steer (push to pendingMessages + add listeners)
   * - Otherwise → startExecution (single-model)
   */
  send(input: {
    topicId: string
    modelId: UniqueModelId
    request: AiStreamRequest
    userMessage: Message
    listeners: StreamListener[]
  }): { mode: 'started' | 'steered' } {
    const existing = this.activeStreams.get(input.topicId)
    if (existing?.status === 'streaming') {
      existing.pendingMessages.push(input.userMessage)
      for (const listener of input.listeners) this.addListener(input.topicId, listener)
      return { mode: 'steered' }
    }
    this.startExecution(input)
    return { mode: 'started' }
  }

  /** Push a steering message into a running stream. */
  steer(topicId: string, message: Message): boolean {
    const stream = this.activeStreams.get(topicId)
    if (!stream || stream.status !== 'streaming') return false
    stream.pendingMessages.push(message)
    return true
  }

  // ── Public: listener management ───────────────────────────────────

  addListener(topicId: string, listener: StreamListener): boolean {
    const stream = this.activeStreams.get(topicId)
    if (!stream) return false
    stream.listeners.set(listener.id, listener)
    for (const chunk of stream.buffer) listener.onChunk(chunk)
    return true
  }

  removeListener(topicId: string, listenerId: string): void {
    const stream = this.activeStreams.get(topicId)
    stream?.listeners.delete(listenerId)
  }

  // ── Public: abort ─────────────────────────────────────────────────

  /** Abort all executions in a topic. */
  abort(topicId: string, reason: string): void {
    const stream = this.activeStreams.get(topicId)
    if (!stream || stream.status !== 'streaming') return
    logger.info('Aborting stream', { topicId, reason })
    for (const exec of stream.executions.values()) {
      if (exec.status === 'streaming') {
        exec.status = 'aborted'
        exec.abortController.abort(reason)
      }
    }
    stream.status = 'aborted'
  }

  // ── InternalStreamTarget callbacks ────────────────────────────────

  /** Chunks are topic-level — multicast to all listeners regardless of which model produced them. */
  onChunk(topicId: string, chunk: UIMessageChunk): void {
    const stream = this.activeStreams.get(topicId)
    if (!stream || stream.status !== 'streaming') return

    if (stream.buffer.length < this.config.maxBufferChunks) {
      stream.buffer.push(chunk)
    }

    const dead: string[] = []
    for (const [id, listener] of stream.listeners) {
      if (!listener.isAlive()) {
        dead.push(id)
        continue
      }
      try {
        listener.onChunk(chunk)
      } catch (err) {
        logger.warn('Listener onChunk threw', { topicId, listenerId: id, err })
      }
    }
    for (const id of dead) stream.listeners.delete(id)
  }

  /** Called when one execution finishes. Topic-level done only when ALL executions finished. */
  async onExecutionDone(
    topicId: string,
    modelId: UniqueModelId,
    status: 'success' | 'paused' = 'success'
  ): Promise<void> {
    const stream = this.activeStreams.get(topicId)
    if (!stream) return

    const exec = stream.executions.get(modelId)
    if (!exec || exec.status !== 'streaming') return

    exec.status = status === 'paused' ? 'aborted' : 'done'

    // Broadcast per-execution done to listeners (PersistenceListener persists per execution)
    await this.broadcastExecutionDone(stream, exec, status)

    // Update topic-level status
    stream.status = this.computeTopicStatus(stream)
    if (stream.status !== 'streaming') {
      this.scheduleReap(topicId)
    }
  }

  /** Called when one execution errors. */
  async onExecutionError(topicId: string, modelId: UniqueModelId, error: SerializedError): Promise<void> {
    const stream = this.activeStreams.get(topicId)
    if (!stream) return

    const exec = stream.executions.get(modelId)
    if (!exec) return

    exec.status = 'error'
    exec.error = error

    // Broadcast error to listeners
    for (const [id, listener] of stream.listeners) {
      try {
        await listener.onError(error)
      } catch (err) {
        logger.warn('Listener onError threw', { topicId, listenerId: id, err })
      }
    }

    stream.status = this.computeTopicStatus(stream)
    if (stream.status !== 'streaming') {
      this.scheduleReap(topicId)
    }
  }

  /** Check if a specific execution should stop. */
  shouldStopExecution(topicId: string, modelId: UniqueModelId): boolean {
    const stream = this.activeStreams.get(topicId)
    if (!stream) return true

    const exec = stream.executions.get(modelId)
    if (!exec) return true
    if (exec.status !== 'streaming') return true
    if (exec.abortController.signal.aborted) return true
    if (stream.listeners.size === 0 && this.config.backgroundMode === 'abort') return true

    return false
  }

  /** Set finalMessage on a specific execution. */
  setExecutionFinalMessage(topicId: string, modelId: UniqueModelId, message: CherryUIMessage): void {
    const stream = this.activeStreams.get(topicId)
    if (!stream) return
    const exec = stream.executions.get(modelId)
    if (exec) exec.finalMessage = message
  }

  // ── Backward-compat (single-execution convenience) ─────────────────
  // Used by tests and ClaudeCodeStreamAdapter that operate on single-model topics.
  // These delegate to the first execution in the topic's executions Map.

  /** Convenience: onDone for the first (or only) execution. */
  async onDone(topicId: string, status: 'success' | 'paused' = 'success'): Promise<void> {
    const stream = this.activeStreams.get(topicId)
    if (!stream) return
    const firstModelId = stream.executions.keys().next().value
    if (firstModelId) await this.onExecutionDone(topicId, firstModelId, status)
  }

  /** Convenience: onError for the first (or only) execution. */
  async onError(topicId: string, error: SerializedError): Promise<void> {
    const stream = this.activeStreams.get(topicId)
    if (!stream) return
    const firstModelId = stream.executions.keys().next().value
    if (firstModelId) await this.onExecutionError(topicId, firstModelId, error)
  }

  /** Convenience: shouldStopStream checks if ANY execution is still running. */
  shouldStopStream(topicId: string): boolean {
    const stream = this.activeStreams.get(topicId)
    if (!stream || stream.status !== 'streaming') return true
    for (const exec of stream.executions.values()) {
      if (exec.status === 'streaming' && !exec.abortController.signal.aborted) return false
    }
    return true
  }

  /** Convenience: setFinalMessage on the first (or only) execution. */
  setStreamFinalMessage(topicId: string, message: CherryUIMessage): void {
    const stream = this.activeStreams.get(topicId)
    if (!stream) return
    const firstModelId = stream.executions.keys().next().value
    if (firstModelId) this.setExecutionFinalMessage(topicId, firstModelId, message)
  }

  // ── IPC handlers ──────────────────────────────────────────────────

  private async handleStreamRequest(
    sender: Electron.WebContents,
    req: AiStreamOpenRequest
  ): Promise<{ mode: 'started' | 'steered' }> {
    // Resolve assistant and model from Redux (same approach as AiCompletionService.getProviderAndModel).
    // TODO: When assistant is migrated to v2 DataApi, assistant.model will store UniqueModelId
    // directly (e.g. "openai::gpt-4o"), eliminating the need to manually construct it here.
    // At that point, replace this block with a single DataApi query.
    const assistants =
      await reduxService.select<
        Array<{ id: string; name: string; emoji?: string; model?: { id: string; provider: string; name: string } }>
      >('state.assistants.assistants')
    const assistant = assistants.find((a) => a.id === req.assistantId)
    if (!assistant?.model) {
      throw new Error(`Cannot resolve model for assistant ${req.assistantId}`)
    }
    const { model } = assistant
    const modelId: UniqueModelId = `${model.provider}::${model.id}`

    // Persist user message with full metadata
    const userMessage = await messageService.create(req.topicId, {
      role: 'user',
      parentId: req.parentAnchorId,
      data: { parts: req.userMessageParts },
      assistantId: req.assistantId,
      assistantMeta: { id: assistant.id, name: assistant.name, emoji: assistant.emoji },
      modelId: model.id,
      modelMeta: { id: model.id, name: model.name, provider: model.provider }
    })

    // Construct PersistenceListener with full metadata for assistant message
    const persistenceListener = new PersistenceListener({
      topicId: req.topicId,
      assistantId: req.assistantId,
      parentUserMessageId: userMessage.id,
      modelId: model.id,
      modelMeta: { id: model.id, name: model.name, provider: model.provider },
      assistantMeta: { id: assistant.id, name: assistant.name, emoji: assistant.emoji }
    })
    const webContentsListener = new WebContentsListener(sender, req.topicId)

    const result = this.send({
      topicId: req.topicId,
      modelId,
      request: this.toAiStreamRequest(req),
      userMessage,
      listeners: [webContentsListener, persistenceListener]
    })

    return { mode: result.mode }
  }

  private handleAttach(sender: Electron.WebContents, req: AiStreamAttachRequest): AiStreamAttachResponse {
    const stream = this.activeStreams.get(req.topicId)
    if (!stream) return { status: 'not-found' }

    if (stream.status === 'done' || stream.status === 'aborted') {
      // Return the first execution's finalMessage
      const firstExec = stream.executions.values().next().value
      return { status: 'done', finalMessage: firstExec?.finalMessage! }
    }
    if (stream.status === 'error') {
      const firstExec = stream.executions.values().next().value
      return { status: 'error', error: firstExec?.error! }
    }

    this.addListener(req.topicId, new WebContentsListener(sender, req.topicId))
    return { status: 'attached', replayedChunks: stream.buffer.length }
  }

  private handleDetach(sender: Electron.WebContents, req: AiStreamDetachRequest): void {
    this.removeListener(req.topicId, `wc:${sender.id}:${req.topicId}`)
  }

  // ── Internal helpers ──────────────────────────────────────────────

  /** Create a StreamExecution and launch executeStream for it. */
  private createAndLaunchExecution(
    topicId: string,
    modelId: UniqueModelId,
    request: AiStreamRequest,
    siblingsGroupId?: number
  ): StreamExecution {
    const exec: StreamExecution = {
      modelId,
      abortController: new AbortController(),
      status: 'streaming',
      siblingsGroupId
    }

    const target = new InternalStreamTarget(this, topicId, modelId)
    const aiService = application.get('AiService')
    void aiService
      .executeStream(target, request, exec.abortController.signal)
      .catch((err: unknown) => this.onExecutionError(topicId, modelId, serializeError(err)))

    return exec
  }

  /** Broadcast done for a single execution to all topic listeners. */
  private async broadcastExecutionDone(
    stream: ActiveStream,
    exec: StreamExecution,
    status: 'success' | 'paused'
  ): Promise<void> {
    const result = { finalMessage: exec.finalMessage, status }
    for (const [id, listener] of stream.listeners) {
      try {
        await listener.onDone(result)
      } catch (err) {
        logger.warn('Listener onDone threw', { topicId: stream.topicId, listenerId: id, err })
      }
    }
  }

  /**
   * Derive topic-level status from its executions.
   * - Any execution streaming → 'streaming'
   * - All done → 'done'
   * - Any error (none streaming) → 'error'
   * - All aborted → 'aborted'
   */
  private computeTopicStatus(stream: ActiveStream): ActiveStream['status'] {
    let hasStreaming = false
    let hasError = false
    let allAborted = true

    for (const exec of stream.executions.values()) {
      if (exec.status === 'streaming') hasStreaming = true
      if (exec.status === 'error') hasError = true
      if (exec.status !== 'aborted') allAborted = false
    }

    if (hasStreaming) return 'streaming'
    if (allAborted) return 'aborted'
    if (hasError) return 'error'
    return 'done'
  }

  private scheduleReap(topicId: string): void {
    const stream = this.activeStreams.get(topicId)
    if (!stream) return
    stream.reapAt = Date.now() + this.config.gracePeriodMs
    stream.reapTimer = setTimeout(() => {
      if (this.activeStreams.get(topicId) === stream) {
        this.activeStreams.delete(topicId)
      }
    }, this.config.gracePeriodMs)
  }

  private evictStream(topicId: string): void {
    const stream = this.activeStreams.get(topicId)
    if (!stream) return
    if (stream.reapTimer) clearTimeout(stream.reapTimer)
    this.activeStreams.delete(topicId)
  }

  /**
   * Build AiStreamRequest from the minimal AiStreamOpenRequest.
   * Main resolves provider/model/tools/overrides from the assistant config.
   *
   * TODO: Read messages from DB via messageService.getTree(topicId).
   * TODO: Resolve provider/model/mcpTools/knowledgeBaseIds from assistant config via reduxService.
   */
  private toAiStreamRequest(req: AiStreamOpenRequest): AiStreamRequest {
    return {
      requestId: req.topicId,
      chatId: req.topicId,
      trigger: 'submit-message',
      assistantId: req.assistantId
    }
  }
}
