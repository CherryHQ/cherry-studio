import { assistantDataService } from '@data/services/AssistantService'
import { topicService } from '@data/services/TopicService'
import { loggerService } from '@logger'
import { application } from '@main/core/application'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { messageService } from '@main/data/services/MessageService'
import { agentService, sessionService } from '@main/services/agents'
import { agentMessageRepository } from '@main/services/agents/database/sessionMessageRepository'
import type {
  AiStreamAbortRequest,
  AiStreamAttachRequest,
  AiStreamAttachResponse,
  AiStreamDetachRequest,
  AiStreamOpenRequest,
  AiStreamOpenResponse
} from '@shared/ai/transport'
import type { Message } from '@shared/data/types/message'
import { createUniqueModelId, parseUniqueModelId, type UniqueModelId } from '@shared/data/types/model'
import { IpcChannel } from '@shared/IpcChannel'
import type { SerializedError } from '@shared/types/error'
import { serializeError } from '@shared/types/error'
import type { UIMessageChunk } from 'ai'

import type { AiStreamRequest } from '../AiCompletionService'
import { PendingMessageQueue } from '../PendingMessageQueue'
import { extractAgentSessionId, isAgentSessionTopic } from '../provider/claudeCodeSettingsBuilder'
import { InternalStreamTarget } from './InternalStreamTarget'
import { AgentPersistenceListener } from './listeners/AgentPersistenceListener'
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
    siblingsGroupId?: number
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

  /**
   * Per-execution chunk routing.
   *
   * Listeners with `executionId` only receive chunks from their own model.
   * Listeners without `executionId` (topic-level) receive ALL chunks.
   */
  onChunk(topicId: string, modelId: UniqueModelId, chunk: UIMessageChunk): void {
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
      // Execution-scoped listeners only receive their own model's chunks
      if (listener.executionId && listener.executionId !== modelId) continue
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

    // Update topic-level status first so listeners can check isTopicDone
    stream.status = this.computeTopicStatus(stream)
    const isTopicDone = stream.status !== 'streaming'

    // Broadcast per-execution done (PersistenceListener filters by modelId, WebContents by isTopicDone)
    await this.broadcastExecutionDone(stream, exec, status, isTopicDone)

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

    // Broadcast error to listeners (include partial message if available)
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
  ): Promise<AiStreamOpenResponse> {
    if (isAgentSessionTopic(req.topicId)) {
      return this.handleAgentSessionStream(sender, req)
    }
    return this.handleNormalChatStream(sender, req)
  }

  /** Normal chat: resolve from topic → assistant → model, persist user message, start execution. */
  private async handleNormalChatStream(
    sender: Electron.WebContents,
    req: AiStreamOpenRequest
  ): Promise<AiStreamOpenResponse> {
    const topic = await topicService.getById(req.topicId)
    const assistantId = topic?.assistantId
    if (!assistantId) {
      throw new Error(`Cannot resolve assistantId for topic ${req.topicId}`)
    }

    const assistant = await assistantDataService.getById(assistantId)
    if (!assistant.modelId) {
      throw new Error(`Assistant ${assistantId} has no model configured`)
    }
    const modelId = assistant.modelId
    const { providerId, modelId: rawModelId } = parseUniqueModelId(modelId)

    const modelSnapshot = { id: rawModelId, name: rawModelId, provider: providerId }

    // Regenerate: user message already exists in DB, don't create duplicate.
    // Submit: create new user message.
    const isRegenerate = req.trigger === 'regenerate-message'
    const userMessage = isRegenerate
      ? await messageService.getById(req.parentAnchorId ?? '')
      : await messageService.create(req.topicId, {
          role: 'user',
          parentId: req.parentAnchorId,
          data: { parts: req.userMessageParts },
          modelId,
          modelSnapshot
        })

    // Multi-model: @-mentioned models → one execution per model, shared siblingsGroupId
    // FIXME: v2 refactored
    const models = req.mentionedModelIds?.length
      ? req.mentionedModelIds.map((id) => {
          const sep = id.indexOf('::')
          const pId = sep > 0 ? id.slice(0, sep) : providerId
          const mId = sep > 0 ? id.slice(sep + 2) : id
          return { uniqueModelId: createUniqueModelId(pId, mId), rawModelId: mId, providerId: pId }
        })
      : [{ uniqueModelId: modelId, rawModelId, providerId }]

    const isMultiModel = models.length > 1

    // Determine siblingsGroupId:
    // - Multi-model: new group ID
    // - Regenerate: inherit from existing siblings (or create new if first regenerate)
    // - Single submit: no group
    let siblingsGroupId: number | undefined
    if (isMultiModel) {
      siblingsGroupId = Date.now()
    } else if (isRegenerate) {
      // Find existing assistant children to inherit their siblingsGroupId
      const existingSiblings = await messageService.getChildrenByParentId(userMessage.id)
      const existingGroup = existingSiblings.find((m) => m.siblingsGroupId > 0)?.siblingsGroupId
      siblingsGroupId = existingGroup ?? Date.now()
      // Update existing siblings that have siblingsGroupId=0 to join the group
      for (const sibling of existingSiblings) {
        if (sibling.siblingsGroupId === 0) {
          await messageService.updateSiblingsGroupId(sibling.id, siblingsGroupId)
        }
      }
    }

    // Build all requests in parallel
    const requests = await Promise.all(
      models.map(async (model) => ({
        model,
        request: await this.buildAiStreamRequest(req.topicId, assistantId, model.uniqueModelId, userMessage.id)
      }))
    )

    // Per-model listeners: WebContents (with executionId for chunk routing) + Persistence
    const allListeners: StreamListener[] = []
    for (const { model } of requests) {
      const snapshot = { id: model.rawModelId, name: model.rawModelId, provider: model.providerId }
      // Multi-model: each model gets its own WebContentsListener with executionId for chunk demux
      // Single-model: executionId omitted → backward compatible (no filtering needed)
      allListeners.push(new WebContentsListener(sender, req.topicId, isMultiModel ? model.uniqueModelId : undefined))
      allListeners.push(
        new PersistenceListener({
          topicId: req.topicId,
          parentUserMessageId: userMessage.id,
          modelId: model.uniqueModelId,
          modelSnapshot: snapshot,
          siblingsGroupId: siblingsGroupId ? Number(siblingsGroupId) : undefined
        })
      )
    }

    // First model: creates the ActiveStream with all listeners
    this.startExecution({
      topicId: req.topicId,
      modelId: requests[0].model.uniqueModelId,
      request: requests[0].request,
      listeners: allListeners,
      siblingsGroupId: siblingsGroupId ? Number(siblingsGroupId) : undefined
    })

    // Additional models: add parallel executions to existing stream
    for (let i = 1; i < requests.length; i++) {
      this.startExecution({
        topicId: req.topicId,
        modelId: requests[i].model.uniqueModelId,
        request: requests[i].request,
        listeners: [],
        siblingsGroupId: siblingsGroupId ? Number(siblingsGroupId) : undefined
      })
    }

    return {
      mode: 'started' as const,
      executionIds: isMultiModel ? models.map((m) => m.uniqueModelId) : undefined
    }
  }

  /** Agent session: resolve from session → agent → model, start execution with Claude Code provider. */
  private async handleAgentSessionStream(
    sender: Electron.WebContents,
    req: AiStreamOpenRequest
  ): Promise<AiStreamOpenResponse> {
    const sessionId = extractAgentSessionId(req.topicId)

    const { agents } = await agentService.listAgents()
    let session: Awaited<ReturnType<typeof sessionService.getSession>> = null
    for (const agent of agents) {
      session = await sessionService.getSession(agent.id, sessionId)
      if (session) break
    }
    if (!session) throw new Error(`Agent session not found: ${sessionId}`)

    // TODO: removed after agent migrated
    // After data_0003_model_id_format migration, session.model is UniqueModelId ("providerId::modelId")
    const { providerId, modelId: rawModelId } = parseUniqueModelId(session.model as UniqueModelId)
    const uniqueModelId = createUniqueModelId(providerId, rawModelId)

    // Extract user message text from parts
    const userText =
      req.userMessageParts
        ?.filter((p): p is { type: 'text'; text: string } => p.type === 'text')
        .map((p) => p.text)
        .join('\n') || ''

    // Persist user message to agents DB
    const userMessageId = crypto.randomUUID()
    await agentMessageRepository.persistUserMessage({
      sessionId,
      agentSessionId: '',
      payload: {
        message: {
          id: userMessageId,
          role: 'user',
          assistantId: session.agent_id,
          topicId: req.topicId,
          createdAt: new Date().toISOString(),
          status: 'success',
          blocks: [],
          data: { parts: req.userMessageParts ?? [{ type: 'text', text: userText }] }
        } as any,
        blocks: []
      }
    })

    const webContentsListener = new WebContentsListener(sender, req.topicId)
    const agentPersistenceListener = new AgentPersistenceListener({
      sessionId,
      agentId: session.agent_id
    })

    const result = this.send({
      topicId: req.topicId,
      modelId: uniqueModelId,
      request: {
        chatId: req.topicId,
        trigger: 'submit-message',
        assistantId: session.agent_id,
        uniqueModelId,
        messages: [{ id: userMessageId, role: 'user', parts: [{ type: 'text', text: userText }] }]
      },
      userMessage: { id: userMessageId, topicId: req.topicId, role: 'user' } as Message,
      listeners: [webContentsListener, agentPersistenceListener]
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

    // Register listener for future live chunks (no buffer replay — chunks returned in response)
    const listener = new WebContentsListener(sender, req.topicId)
    stream.listeners.set(listener.id, listener)
    return { status: 'attached', bufferedChunks: [...stream.buffer] }
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
      .then(async () => {
        // Normal return after abort: signal was aborted but no error thrown.
        // Persist partial content as 'paused' so it survives app restart.
        if (exec.abortController.signal.aborted && exec.status === 'aborted') {
          await this.onExecutionDone(topicId, modelId, 'paused')
        }
      })
      .catch((err: unknown) => this.onExecutionError(topicId, modelId, serializeError(err)))

    return exec
  }

  /** Broadcast done for a single execution to all topic listeners. */
  private async broadcastExecutionDone(
    stream: ActiveStream,
    exec: StreamExecution,
    status: 'success' | 'paused',
    isTopicDone = true
  ): Promise<void> {
    const result = { finalMessage: exec.finalMessage, status, modelId: exec.modelId, isTopicDone }
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
   * Build AiStreamRequest by reading message history from DB and attaching resolved model info.
   *
   * Reads the path from root to the just-persisted user message (parentUserMessageId),
   * converts Message[] to UIMessage[] for the AI SDK, and constructs the full request.
   */
  private async buildAiStreamRequest(
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
