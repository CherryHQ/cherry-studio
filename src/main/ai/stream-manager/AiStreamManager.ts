import { loggerService } from '@logger'
import { application } from '@main/core/application'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { messageService } from '@main/data/services/MessageService'
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
import { buildCompactReplay } from './buildCompactReplay'
import { InternalStreamTarget } from './InternalStreamTarget'
import { WebContentsListener } from './listeners/WebContentsListener'
import { streamRequestHandler } from './StreamRequestHandler'
import type {
  ActiveStream,
  AiStreamManagerConfig,
  CherryUIMessage,
  StreamDoneResult,
  StreamExecution,
  StreamListener
} from './types'

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
      const subscriber = new WebContentsListener(event.sender, req.topicId)
      return streamRequestHandler.handle(this, subscriber, req)
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
        donePromises.push(this.broadcastExecutionPaused(stream, exec, true))
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
    isMultiModel?: boolean
  }): ActiveStream {
    const existing = this.activeStreams.get(input.topicId)

    if (existing) {
      if (existing.status === 'streaming') {
        // Multi-model: add execution to existing active stream
        if (existing.executions.has(input.modelId)) {
          throw new Error(`Topic ${input.topicId} already has an execution for model ${input.modelId}`)
        }
        const requestWithQueue = { ...input.request, pendingMessages: existing.pendingMessages }
        const exec = this.createAndLaunchExecution(
          input.topicId,
          input.modelId,
          requestWithQueue,
          input.siblingsGroupId
        )
        existing.executions.set(input.modelId, exec)
        for (const listener of input.listeners) existing.listeners.set(listener.id, listener)
        return existing
      }
      // Grace period: evict finished stream, inherit sourceSessionId
      this.evictStream(input.topicId)
    }

    // Create queue first so it can be passed to the execution
    const pendingMessages = new PendingMessageQueue()
    const requestWithQueue = { ...input.request, pendingMessages }
    const exec = this.createAndLaunchExecution(input.topicId, input.modelId, requestWithQueue, input.siblingsGroupId)
    const stream: ActiveStream = {
      topicId: input.topicId,
      executions: new Map([[input.modelId, exec]]),
      listeners: new Map(input.listeners.map((l) => [l.id, l])),
      pendingMessages,
      buffer: [],
      status: 'streaming',
      isMultiModel: input.isMultiModel ?? false
    }
    this.activeStreams.set(input.topicId, stream)
    this.broadcastStreamStarted(input.topicId)
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
    for (const chunk of stream.buffer) listener.onChunk(chunk.chunk, chunk.executionId)
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
    stream.pendingMessages.close()
    for (const exec of stream.executions.values()) {
      if (exec.status === 'streaming') {
        exec.status = 'aborted'
        exec.abortController.abort(reason)
      }
    }
    stream.status = 'aborted'
  }

  // ── InternalStreamTarget callbacks ────────────────────────────────

  /** Broadcast chunk to all listeners. Multi-model: includes sourceModelId for frontend demux. */
  onChunk(topicId: string, modelId: UniqueModelId, chunk: UIMessageChunk): void {
    const stream = this.activeStreams.get(topicId)
    if (!stream || stream.status !== 'streaming') return

    const sourceModelId = stream.isMultiModel ? modelId : undefined
    if (stream.buffer.length < this.config.maxBufferChunks) {
      stream.buffer.push({
        topicId,
        executionId: sourceModelId,
        chunk
      })
    }

    const dead: string[] = []
    for (const [id, listener] of stream.listeners) {
      if (!listener.isAlive()) {
        dead.push(id)
        continue
      }
      try {
        listener.onChunk(chunk, sourceModelId)
      } catch (err) {
        logger.warn('Listener onChunk threw', { topicId, listenerId: id, err })
      }
    }
    for (const id of dead) stream.listeners.delete(id)
  }

  /** Called when one execution finishes. Topic-level done only when ALL executions finished. */
  async onExecutionDone(topicId: string, modelId: UniqueModelId): Promise<void> {
    const stream = this.activeStreams.get(topicId)
    if (!stream) return

    const exec = stream.executions.get(modelId)
    if (!exec || exec.status !== 'streaming') return

    exec.status = 'done'

    // Compute topic status first so listeners get isTopicDone
    stream.status = this.computeTopicStatus(stream)
    const isTopicDone = stream.status !== 'streaming'

    await this.broadcastExecutionDone(stream, exec, isTopicDone)

    if (isTopicDone) {
      this.scheduleReap(topicId)
    }
  }

  async onExecutionPaused(topicId: string, modelId: UniqueModelId): Promise<void> {
    const stream = this.activeStreams.get(topicId)
    if (!stream) return

    const exec = stream.executions.get(modelId)
    if (!exec || exec.status !== 'aborted') return

    stream.status = this.computeTopicStatus(stream)
    const isTopicDone = stream.status !== 'streaming'

    await this.broadcastExecutionPaused(stream, exec, isTopicDone)

    if (isTopicDone) {
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

    stream.status = this.computeTopicStatus(stream)
    const isTopicDone = stream.status !== 'streaming'

    for (const [id, listener] of stream.listeners) {
      try {
        await listener.onError(error, exec.finalMessage, exec.modelId, isTopicDone)
      } catch (err) {
        logger.warn('Listener onError threw', { topicId, listenerId: id, err })
      }
    }

    if (isTopicDone) {
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
  // Used by tests that operate on single-model topics.
  // These delegate to the first execution in the topic's executions Map.

  /** Convenience: onDone for the first (or only) execution. */
  async onDone(topicId: string, status: 'success' | 'paused' = 'success'): Promise<void> {
    const stream = this.activeStreams.get(topicId)
    if (!stream) return
    const firstModelId = stream.executions.keys().next().value
    if (!firstModelId) return
    if (status === 'paused') {
      const exec = stream.executions.get(firstModelId)
      if (exec) exec.status = 'aborted'
      await this.onExecutionPaused(topicId, firstModelId)
      return
    }
    await this.onExecutionDone(topicId, firstModelId)
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

  // ── Attach / Detach (simple registry ops, stay here) ───────────

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

    // Register listener for future live chunks; reconnect receives a compact replay of buffered chunks.
    const listener = new WebContentsListener(sender, req.topicId)
    stream.listeners.set(listener.id, listener)
    return { status: 'attached', bufferedChunks: buildCompactReplay(stream.buffer) }
  }

  private handleDetach(sender: Electron.WebContents, req: AiStreamDetachRequest): void {
    this.removeListener(req.topicId, `wc:${sender.id}:${req.topicId}`)
  }

  private broadcastStreamStarted(topicId: string): void {
    const windowService = application.get('WindowService')
    const windows = typeof windowService.getAllWindows === 'function' ? windowService.getAllWindows() : []
    for (const window of windows) {
      const wc = window.webContents
      if (wc.isDestroyed()) continue
      wc.send(IpcChannel.Ai_StreamStarted, { topicId })
    }
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
      .then(async () => {
        // Normal return after abort: signal was aborted but no error thrown.
        // Persist partial content as 'paused' so it survives app restart.
        if (exec.abortController.signal.aborted && exec.status === 'aborted') {
          await this.onExecutionPaused(topicId, modelId)
        }
      })
      .catch((err: unknown) => this.onExecutionError(topicId, modelId, serializeError(err)))

    return exec
  }

  /** Broadcast done for a single execution to all topic listeners. */
  private async broadcastExecutionDone(stream: ActiveStream, exec: StreamExecution, isTopicDone = true): Promise<void> {
    const result: StreamDoneResult = {
      finalMessage: exec.finalMessage,
      status: 'success',
      modelId: exec.modelId,
      isTopicDone
    }
    for (const [id, listener] of stream.listeners) {
      try {
        await listener.onDone(result)
      } catch (err) {
        logger.warn('Listener onDone threw', { topicId: stream.topicId, listenerId: id, err })
      }
    }
  }

  private async broadcastExecutionPaused(
    stream: ActiveStream,
    exec: StreamExecution,
    isTopicDone = true
  ): Promise<void> {
    const result = {
      finalMessage: exec.finalMessage,
      status: 'paused' as const,
      modelId: exec.modelId,
      isTopicDone
    }
    for (const [id, listener] of stream.listeners) {
      try {
        await listener.onPaused(result)
      } catch (err) {
        logger.warn('Listener onPaused threw', { topicId: stream.topicId, listenerId: id, err })
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
   * Build AiStreamRequest by reading message history from DB and attaching resolved model info.
   *
   * Reads the path from root to the just-persisted user message (parentUserMessageId),
   * converts Message[] to UIMessage[] for the AI SDK, and constructs the full request.
   */
  async buildAiStreamRequest(
    topicId: string,
    assistantId: string,
    uniqueModelId: UniqueModelId,
    parentUserMessageId: string
  ): Promise<AiStreamRequest> {
    // Read conversation history: root → ... → user message (linear path)
    const messagePath = await messageService.getPathToNode(parentUserMessageId)

    // Convert Message[] → UIMessage[] for AI SDK
    const messages: CherryUIMessage[] = messagePath.map((msg) => ({
      id: msg.id,
      role: msg.role as CherryUIMessage['role'],
      parts: msg.data.parts ?? []
    }))

    return {
      chatId: topicId,
      trigger: 'submit-message',
      assistantId,
      uniqueModelId,
      messages
    }
  }
}
