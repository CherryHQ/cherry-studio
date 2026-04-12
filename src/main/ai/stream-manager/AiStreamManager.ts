import { loggerService } from '@logger'
import { application } from '@main/core/application'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { messageService } from '@main/data/services/MessageService'
import { IpcChannel } from '@shared/IpcChannel'
import type { SerializedError } from '@shared/types/error'
import { serializeError } from '@shared/types/error'
import type { UIMessageChunk } from 'ai'

import type { AiStreamRequest } from '../AiCompletionService'
import { PendingMessageQueue } from '../PendingMessageQueue'
import { InternalStreamTarget } from './InternalStreamTarget'
import { PersistenceListener } from './listeners/PersistenceListener'
import { WebContentsListener } from './listeners/WebContentsListener'
import type {
  ActiveStream,
  AiStreamAbortRequest,
  AiStreamAttachRequest,
  AiStreamAttachResponse,
  AiStreamDetachRequest,
  AiStreamManagerConfig,
  AiStreamOpenRequest,
  CherryUIMessage,
  StreamListener
} from './types'

const logger = loggerService.withContext('AiStreamManager')

/**
 * Active-stream registry and control plane for AI streaming.
 *
 * Two-id model:
 *  - `requestId` (control plane): primary Map key, abort/attach/detach routing, dedup
 *  - `topicId` (data plane): listener.id construction, push payload filtering, steering
 */
@Injectable('AiStreamManager')
@ServicePhase(Phase.WhenReady)
@DependsOn(['AiService'])
export class AiStreamManager extends BaseService {
  private readonly activeStreams = new Map<string, ActiveStream>()
  private readonly topicToActiveRequest = new Map<string, string>()

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
      const requestId = this.topicToActiveRequest.get(req.topicId)
      if (requestId) this.abort(requestId, 'user-requested')
    })

    logger.info('AiStreamManager initialized')
  }

  // ── Public: start / send / steer ──────────────────────────────────

  /**
   * Start a new stream. Callers provide all initial listeners — persistence is not implicit.
   *
   * Returns the ActiveStream for the caller to inspect (e.g. sourceSessionId).
   */
  startStream(input: {
    requestId: string
    topicId: string
    request: AiStreamRequest
    listeners: StreamListener[]
  }): ActiveStream {
    // In-memory dedup: same requestId → return existing, don't re-execute
    const existingByRequest = this.activeStreams.get(input.requestId)
    if (existingByRequest) {
      for (const listener of input.listeners) this.addListener(input.requestId, listener)
      return existingByRequest
    }

    // Check topic conflict: evict grace-period streams, reject active ones
    let inheritedSessionId: string | undefined
    const existingRequestId = this.topicToActiveRequest.get(input.topicId)
    if (existingRequestId) {
      const existing = this.activeStreams.get(existingRequestId)
      if (existing) {
        if (existing.status === 'streaming') {
          throw new Error(
            `Topic ${input.topicId} already has an active stream (requestId=${existingRequestId}); use send() to steer`
          )
        }
        inheritedSessionId = existing.sourceSessionId
        this.evictStream(existingRequestId, existing)
      }
    }

    const stream: ActiveStream = {
      requestId: input.requestId,
      topicId: input.topicId,
      abortController: new AbortController(),
      listeners: new Map(input.listeners.map((s) => [s.id, s])),
      pendingMessages: new PendingMessageQueue(),
      buffer: [],
      status: 'streaming',
      sourceSessionId: inheritedSessionId
    }
    this.activeStreams.set(input.requestId, stream)
    this.topicToActiveRequest.set(input.topicId, input.requestId)

    const target = new InternalStreamTarget(this, input.requestId)
    const aiService = application.get('AiService')
    void aiService
      .executeStream(target, input.request, {
        signal: stream.abortController.signal
      })
      .catch((err) => this.onError(input.requestId, serializeError(err)))

    return stream
  }

  /**
   * Unified "send message for a topic" entry point.
   *
   * Routes automatically:
   *  - Topic has active streaming request → steer (push to pendingMessages + add listeners)
   *  - Otherwise → startStream
   */
  send(input: {
    requestId: string
    topicId: string
    request: AiStreamRequest
    userMessage: { id: string }
    listeners: StreamListener[]
  }): { mode: 'started' | 'steered'; activeRequestId: string } {
    const activeRequestId = this.topicToActiveRequest.get(input.topicId)
    if (activeRequestId) {
      const existing = this.activeStreams.get(activeRequestId)
      if (existing?.status === 'streaming') {
        existing.pendingMessages.push(input.userMessage as never)
        for (const listener of input.listeners) this.addListener(activeRequestId, listener)
        return { mode: 'steered', activeRequestId }
      }
    }
    this.startStream(input)
    return { mode: 'started', activeRequestId: input.requestId }
  }

  /** Push a steering message into a running stream by topicId. */
  steer(topicId: string, message: unknown): boolean {
    const requestId = this.topicToActiveRequest.get(topicId)
    if (!requestId) return false
    const stream = this.activeStreams.get(requestId)
    if (!stream || stream.status !== 'streaming') return false
    stream.pendingMessages.push(message as never)
    return true
  }

  // ── Public: listener management ────────────────────────────────────

  addListener(requestId: string, listener: StreamListener): boolean {
    const stream = this.activeStreams.get(requestId)
    if (!stream) return false
    stream.listeners.set(listener.id, listener)
    for (const chunk of stream.buffer) listener.onChunk(chunk)
    return true
  }

  removeListener(requestId: string, listenerId: string): void {
    const stream = this.activeStreams.get(requestId)
    stream?.listeners.delete(listenerId)
  }

  // ── Public: abort ─────────────────────────────────────────────────

  abort(requestId: string, reason: string): void {
    const stream = this.activeStreams.get(requestId)
    if (!stream) return
    logger.info('Aborting stream', { requestId, reason })
    stream.status = 'aborted'
    stream.abortController.abort(reason)
    if (this.topicToActiveRequest.get(stream.topicId) === requestId) {
      this.topicToActiveRequest.delete(stream.topicId)
    }
  }

  // ── InternalStreamTarget callbacks (by requestId) ───────────────────

  onChunk(requestId: string, chunk: UIMessageChunk): void {
    const stream = this.activeStreams.get(requestId)
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
        logger.warn('Listener onChunk threw', { requestId, listenerId: id, err })
      }
    }
    for (const id of dead) stream.listeners.delete(id)
  }

  async onDone(requestId: string, status: 'success' | 'paused' = 'success'): Promise<void> {
    const stream = this.activeStreams.get(requestId)
    if (!stream) return

    stream.status = status === 'paused' ? 'aborted' : 'done'
    if (this.topicToActiveRequest.get(stream.topicId) === requestId) {
      this.topicToActiveRequest.delete(stream.topicId)
    }

    const result = { finalMessage: stream.finalMessage, status }
    for (const [id, listener] of stream.listeners) {
      try {
        await listener.onDone(result)
      } catch (err) {
        logger.warn('Listener onDone threw', { requestId, listenerId: id, err })
      }
    }

    this.scheduleReap(requestId, stream)
  }

  async onError(requestId: string, error: SerializedError): Promise<void> {
    const stream = this.activeStreams.get(requestId)
    if (!stream) return

    stream.status = 'error'
    stream.error = error
    if (this.topicToActiveRequest.get(stream.topicId) === requestId) {
      this.topicToActiveRequest.delete(stream.topicId)
    }

    for (const [id, listener] of stream.listeners) {
      try {
        await listener.onError(error)
      } catch (err) {
        logger.warn('Listener onError threw', { requestId, listenerId: id, err })
      }
    }

    this.scheduleReap(requestId, stream)
  }

  shouldStopStream(requestId: string): boolean {
    const stream = this.activeStreams.get(requestId)
    if (!stream) return true
    if (stream.status !== 'streaming') return true
    if (stream.abortController.signal.aborted) return true
    if (stream.listeners.size === 0 && this.config.backgroundMode === 'abort') return true
    return false
  }

  setStreamFinalMessage(requestId: string, message: CherryUIMessage): void {
    const stream = this.activeStreams.get(requestId)
    if (stream) stream.finalMessage = message
  }

  // ── IPC handlers ──────────────────────────────────────────────────

  private async handleStreamRequest(
    sender: Electron.WebContents,
    req: AiStreamOpenRequest
  ): Promise<{ requestId: string; mode: 'started' | 'steered' | 'deduped' }> {
    // Step 0: dedup — same requestId already in-flight
    if (this.activeStreams.has(req.requestId)) {
      logger.info('Ai_Stream_Open deduped', { requestId: req.requestId })
      this.addListener(req.requestId, new WebContentsListener(sender, req.topicId))
      return { requestId: req.requestId, mode: 'deduped' }
    }

    // Step 1: persist user message atomically (explicit parentId, no activeNodeId fallback)
    const userMessage = await messageService.create(req.topicId, {
      role: 'user',
      parentId: req.parentAnchorId,
      data: req.userMessage.data as never
    })

    // Step 2: construct listeners (ids by topicId for steering upsert correctness)
    const persistenceListener = new PersistenceListener({
      requestId: req.requestId,
      topicId: req.topicId,
      assistantId: req.assistantId,
      parentUserMessageId: userMessage.id
      // TODO (Step 2.6): afterPersist hook for agent rename, etc.
    })
    const webContentsListener = new WebContentsListener(sender, req.topicId)

    // Step 3: route (startStream or steer based on topic state)
    const result = this.send({
      requestId: req.requestId,
      topicId: req.topicId,
      request: this.toAiStreamRequest(req, userMessage.id),
      userMessage,
      listeners: [webContentsListener, persistenceListener]
    })

    return { requestId: result.activeRequestId, mode: result.mode }
  }

  private handleAttach(sender: Electron.WebContents, req: AiStreamAttachRequest): AiStreamAttachResponse {
    const requestId = this.topicToActiveRequest.get(req.topicId)
    if (!requestId) return { status: 'not-found' }

    const stream = this.activeStreams.get(requestId)
    if (!stream) return { status: 'not-found' }

    if (stream.status === 'done' || stream.status === 'aborted') {
      return { status: 'done', finalMessage: stream.finalMessage! }
    }
    if (stream.status === 'error') {
      return { status: 'error', error: stream.error! }
    }

    // Streaming: register listener + replay buffer
    this.addListener(requestId, new WebContentsListener(sender, req.topicId))
    return { status: 'attached', replayedChunks: stream.buffer.length }
  }

  private handleDetach(sender: Electron.WebContents, req: AiStreamDetachRequest): void {
    this.removeListenerByTopic(req.topicId, `wc:${sender.id}:${req.topicId}`)
  }

  /** Remove a listener by topicId — finds the active request for this topic, then removes the listener. */
  private removeListenerByTopic(topicId: string, listenerId: string): void {
    const requestId = this.topicToActiveRequest.get(topicId)
    if (requestId) this.removeListener(requestId, listenerId)
  }

  // ── Lifecycle helpers ─────────────────────────────────────────────

  private scheduleReap(requestId: string, stream: ActiveStream): void {
    stream.reapAt = Date.now() + this.config.gracePeriodMs
    stream.reapTimer = setTimeout(() => {
      if (this.activeStreams.get(requestId) === stream) {
        this.activeStreams.delete(requestId)
      }
    }, this.config.gracePeriodMs)
  }

  private evictStream(requestId: string, stream: ActiveStream): void {
    if (stream.reapTimer) clearTimeout(stream.reapTimer)
    this.activeStreams.delete(requestId)
    if (this.topicToActiveRequest.get(stream.topicId) === requestId) {
      this.topicToActiveRequest.delete(stream.topicId)
    }
  }

  /**
   * Convert the IPC request into the AiStreamRequest shape that
   * AiCompletionService.streamText expects.
   *
   * The AiStreamManager's AiStreamOpenRequest has manager-specific fields (parentAnchorId,
   * userMessage, assistantId) that AiCompletionService doesn't need. This method
   * maps to the shape the execution layer expects.
   */
  private toAiStreamRequest(req: AiStreamOpenRequest, _userMessageId: string): AiStreamRequest {
    return {
      requestId: req.requestId,
      chatId: req.topicId,
      trigger: 'submit-message',
      messages: (req.messages ?? []) as never,
      providerId: req.providerId as string | undefined,
      modelId: req.modelId as string | undefined,
      assistantId: req.assistantId,
      mcpToolIds: req.mcpToolIds as string[] | undefined,
      knowledgeBaseIds: req.knowledgeBaseIds as string[] | undefined,
      assistantOverrides: req.assistantOverrides as never
    }
  }
}
