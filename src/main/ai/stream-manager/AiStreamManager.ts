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
import { IpcChannel } from '@shared/IpcChannel'
import type { SerializedError } from '@shared/types/error'
import { serializeError } from '@shared/types/error'
import type { UIMessageChunk } from 'ai'

import type { AiStreamRequest } from '../AiCompletionService'
import { PendingMessageQueue } from '../PendingMessageQueue'
import { InternalStreamTarget } from './InternalStreamTarget'
import { PersistenceListener } from './listeners/PersistenceListener'
import { WebContentsListener } from './listeners/WebContentsListener'
import type { ActiveStream, AiStreamManagerConfig, CherryUIMessage, StreamListener } from './types'

const logger = loggerService.withContext('AiStreamManager')

/**
 * Active-stream registry for AI streaming.
 *
 * Keyed by `topicId` — one topic has at most one active stream at any time.
 * Streaming is just one state of a topic; all subscribers subscribe to the
 * topic, not to a specific stream.
 */
@Injectable('AiStreamManager')
@ServicePhase(Phase.WhenReady)
export class AiStreamManager extends BaseService {
  /** Primary registry: topicId → ActiveStream. One topic, one stream. */
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

    // Give PersistenceListeners a chance to persist partial results.
    // onDone('paused') is async — wait for all to settle.
    await Promise.allSettled(activeTopics.map((topicId) => this.onDone(topicId, 'paused')))
  }

  // ── Public: start / send / steer ──────────────────────────────────

  /**
   * Start a new stream for a topic.
   *
   * - If the topic has no active stream → create one
   * - If the topic has a finished stream (grace period) → evict it, create new
   * - If the topic already has a streaming stream → throw (use `send()` to steer instead)
   */
  startStream(input: { topicId: string; request: AiStreamRequest; listeners: StreamListener[] }): ActiveStream {
    let inheritedSessionId: string | undefined
    const existing = this.activeStreams.get(input.topicId)

    if (existing) {
      if (existing.status === 'streaming') {
        throw new Error(`Topic ${input.topicId} already has an active stream; use send() to steer`)
      }
      inheritedSessionId = existing.sourceSessionId
      this.evictStream(input.topicId)
    }

    const stream: ActiveStream = {
      topicId: input.topicId,
      abortController: new AbortController(),
      listeners: new Map(input.listeners.map((l) => [l.id, l])),
      pendingMessages: new PendingMessageQueue(),
      buffer: [],
      status: 'streaming',
      sourceSessionId: inheritedSessionId
    }
    this.activeStreams.set(input.topicId, stream)

    const target = new InternalStreamTarget(this, input.topicId)
    const aiService = application.get('AiService')
    void aiService
      .executeStream(target, input.request, stream.abortController.signal)
      .catch((err: unknown) => this.onError(input.topicId, serializeError(err)))

    return stream
  }

  /**
   * Unified "send message for a topic" entry point.
   *
   * - Topic has active streaming → steer (push to pendingMessages + add listeners)
   * - Otherwise → startStream
   */
  send(input: { topicId: string; request: AiStreamRequest; userMessage: Message; listeners: StreamListener[] }): {
    mode: 'started' | 'steered'
  } {
    const existing = this.activeStreams.get(input.topicId)
    if (existing?.status === 'streaming') {
      existing.pendingMessages.push(input.userMessage)
      for (const listener of input.listeners) this.addListener(input.topicId, listener)
      return { mode: 'steered' }
    }
    this.startStream(input)
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

  abort(topicId: string, reason: string): void {
    const stream = this.activeStreams.get(topicId)
    if (!stream || stream.status !== 'streaming') return
    logger.info('Aborting stream', { topicId, reason })
    stream.status = 'aborted'
    stream.abortController.abort(reason)
  }

  // ── InternalStreamTarget callbacks (by topicId) ───────────────────

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

  async onDone(topicId: string, status: 'success' | 'paused' = 'success'): Promise<void> {
    const stream = this.activeStreams.get(topicId)
    if (!stream) return

    stream.status = status === 'paused' ? 'aborted' : 'done'

    const result = { finalMessage: stream.finalMessage, status }
    for (const [id, listener] of stream.listeners) {
      try {
        await listener.onDone(result)
      } catch (err) {
        logger.warn('Listener onDone threw', { topicId, listenerId: id, err })
      }
    }

    this.scheduleReap(topicId)
  }

  async onError(topicId: string, error: SerializedError): Promise<void> {
    const stream = this.activeStreams.get(topicId)
    if (!stream) return

    stream.status = 'error'
    stream.error = error

    for (const [id, listener] of stream.listeners) {
      try {
        await listener.onError(error)
      } catch (err) {
        logger.warn('Listener onError threw', { topicId, listenerId: id, err })
      }
    }

    this.scheduleReap(topicId)
  }

  shouldStopStream(topicId: string): boolean {
    const stream = this.activeStreams.get(topicId)
    if (!stream) return true
    if (stream.status !== 'streaming') return true
    if (stream.abortController.signal.aborted) return true
    if (stream.listeners.size === 0 && this.config.backgroundMode === 'abort') return true
    return false
  }

  setStreamFinalMessage(topicId: string, message: CherryUIMessage): void {
    const stream = this.activeStreams.get(topicId)
    if (stream) stream.finalMessage = message
  }

  // ── IPC handlers ──────────────────────────────────────────────────

  private async handleStreamRequest(
    sender: Electron.WebContents,
    req: AiStreamOpenRequest
  ): Promise<{ mode: 'started' | 'steered' }> {
    // Persist user message (explicit parentId, no activeNodeId fallback)
    const userMessage = await messageService.create(req.topicId, {
      role: 'user',
      parentId: req.parentAnchorId,
      data: { parts: req.userMessageParts }
    })

    const persistenceListener = new PersistenceListener({
      topicId: req.topicId,
      assistantId: req.assistantId,
      parentUserMessageId: userMessage.id
    })
    const webContentsListener = new WebContentsListener(sender, req.topicId)

    const result = this.send({
      topicId: req.topicId,
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
      return { status: 'done', finalMessage: stream.finalMessage! }
    }
    if (stream.status === 'error') {
      return { status: 'error', error: stream.error! }
    }

    this.addListener(req.topicId, new WebContentsListener(sender, req.topicId))
    return { status: 'attached', replayedChunks: stream.buffer.length }
  }

  private handleDetach(sender: Electron.WebContents, req: AiStreamDetachRequest): void {
    this.removeListener(req.topicId, `wc:${sender.id}:${req.topicId}`)
  }

  // ── Lifecycle helpers ─────────────────────────────────────────────

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
    // TODO: const assistant = reduxService.getAssistant(req.assistantId)
    // Then populate providerId, modelId, mcpToolIds, knowledgeBaseIds from assistant
    return {
      requestId: req.topicId,
      chatId: req.topicId,
      trigger: 'submit-message',
      assistantId: req.assistantId
    }
  }
}
