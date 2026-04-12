import { loggerService } from '@logger'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { IpcChannel } from '@shared/IpcChannel'
import type { SerializedError } from '@shared/types/error'
import type { UIMessageChunk } from 'ai'

import type {
  ActiveStream,
  AiStreamAbortRequest,
  AiStreamAttachRequest,
  AiStreamAttachResponse,
  AiStreamBrokerConfig,
  AiStreamDetachRequest,
  AiStreamOpenRequest,
  CherryUIMessage,
  StreamSink
} from './types'

const logger = loggerService.withContext('AiStreamBroker')

/**
 * Active-stream registry and control plane for AI streaming.
 *
 * Manages the full lifecycle of generation attempts:
 *  - Start / steer / abort / attach / detach
 *  - Multicast chunks to all subscribed sinks
 *  - Grace-period retention for late reconnects
 *  - In-memory dedup by requestId
 *
 * Two-id model:
 *  - `requestId` (control plane): primary Map key, abort/attach/detach routing
 *  - `topicId` (data plane): sink.id construction, push payload filtering, steering
 *
 * See docs/ai-core-migration.md "requestId / topicId 命名空间与并发约束" for full design.
 */
@Injectable('AiStreamBroker')
@ServicePhase(Phase.WhenReady)
@DependsOn(['AiService'])
export class AiStreamBroker extends BaseService {
  /** Primary registry, keyed by requestId (one generation attempt = one entry). */
  private readonly activeStreams = new Map<string, ActiveStream>()

  /** Reverse index: topicId → currently-active requestId. Only tracks 'streaming' status. */
  private readonly topicToActiveRequest = new Map<string, string>()

  private readonly config: AiStreamBrokerConfig = {
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
      this.abort(req.requestId, 'user-requested')
    })

    logger.info('AiStreamBroker initialized')
  }

  // ── Control-plane public API (called by BrokerStreamTarget) ────────

  onChunk(requestId: string, chunk: UIMessageChunk): void {
    const stream = this.activeStreams.get(requestId)
    if (!stream || stream.status !== 'streaming') return

    if (stream.buffer.length < this.config.maxBufferChunks) {
      stream.buffer.push(chunk)
    }

    const dead: string[] = []
    for (const [id, sink] of stream.sinks) {
      if (!sink.isAlive()) {
        dead.push(id)
        continue
      }
      try {
        sink.onChunk(chunk)
      } catch (err) {
        logger.warn('Sink onChunk threw', { requestId, sinkId: id, err })
      }
    }
    for (const id of dead) stream.sinks.delete(id)
  }

  async onDone(requestId: string, status: 'success' | 'paused' = 'success'): Promise<void> {
    const stream = this.activeStreams.get(requestId)
    if (!stream) return

    stream.status = status === 'paused' ? 'aborted' : 'done'
    if (this.topicToActiveRequest.get(stream.topicId) === requestId) {
      this.topicToActiveRequest.delete(stream.topicId)
    }

    const result = { finalMessage: stream.finalMessage, status }
    for (const [id, sink] of stream.sinks) {
      try {
        await sink.onDone(result)
      } catch (err) {
        logger.warn('Sink onDone threw', { requestId, sinkId: id, err })
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

    for (const [id, sink] of stream.sinks) {
      try {
        await sink.onError(error)
      } catch (err) {
        logger.warn('Sink onError threw', { requestId, sinkId: id, err })
      }
    }

    this.scheduleReap(requestId, stream)
  }

  shouldStopStream(requestId: string): boolean {
    const stream = this.activeStreams.get(requestId)
    if (!stream) return true
    if (stream.status !== 'streaming') return true
    if (stream.abortController.signal.aborted) return true
    if (stream.sinks.size === 0 && this.config.backgroundMode === 'abort') return true
    return false
  }

  setStreamFinalMessage(requestId: string, message: CherryUIMessage): void {
    const stream = this.activeStreams.get(requestId)
    if (stream) stream.finalMessage = message
  }

  // ── Internal API (called by ChannelMessageHandler / AgentScheduler) ──

  addSink(requestId: string, sink: StreamSink): boolean {
    const stream = this.activeStreams.get(requestId)
    if (!stream) return false
    stream.sinks.set(sink.id, sink)
    for (const chunk of stream.buffer) sink.onChunk(chunk)
    return true
  }

  removeSink(requestId: string, sinkId: string): void {
    const stream = this.activeStreams.get(requestId)
    stream?.sinks.delete(sinkId)
  }

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

  // ── IPC handlers ──────────────────────────────────────────────────

  private async handleStreamRequest(
    _sender: Electron.WebContents,
    req: AiStreamOpenRequest
  ): Promise<{ requestId: string; mode: 'started' | 'steered' | 'deduped' }> {
    // TODO (Step 2.4a): full implementation
    // Step 0: dedup by requestId
    // Step 1: persist user message via messageService.create
    // Step 2: construct sinks (WebContentsSink + PersistenceSink)
    // Step 3: route to startStream or steer via send()
    logger.info('handleStreamRequest [skeleton]', {
      requestId: req.requestId,
      topicId: req.topicId
    })
    throw new Error('AiStreamBroker.handleStreamRequest not yet implemented (Step 2.4a)')
  }

  private handleAttach(_sender: Electron.WebContents, req: AiStreamAttachRequest): AiStreamAttachResponse {
    let requestId: string | undefined
    if (req.mode === 'byRequestId') {
      requestId = req.requestId
    } else {
      requestId = this.topicToActiveRequest.get(req.topicId)
    }
    if (!requestId) return { status: 'not-found' }

    const stream = this.activeStreams.get(requestId)
    if (!stream) return { status: 'not-found' }

    if (stream.status === 'done' || stream.status === 'aborted') {
      return { status: 'done', requestId, finalMessage: stream.finalMessage! }
    }
    if (stream.status === 'error') {
      return { status: 'error', requestId, error: stream.error! }
    }

    // TODO (Step 2.4a): add WebContentsSink + replay buffer
    return { status: 'attached', requestId, replayedChunks: stream.buffer.length }
  }

  private handleDetach(sender: Electron.WebContents, req: AiStreamDetachRequest): void {
    const stream = this.activeStreams.get(req.requestId)
    if (!stream) return
    this.removeSink(req.requestId, `wc:${sender.id}:${stream.topicId}`)
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

  // @ts-expect-error Called in Step 2.4a (startStream implementation)
  private evictStream(requestId: string, stream: ActiveStream): void {
    if (stream.reapTimer) clearTimeout(stream.reapTimer)
    this.activeStreams.delete(requestId)
    if (this.topicToActiveRequest.get(stream.topicId) === requestId) {
      this.topicToActiveRequest.delete(stream.topicId)
    }
  }
}
