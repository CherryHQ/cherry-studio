import { IpcChannel } from '@shared/IpcChannel'
import type { SerializedError } from '@shared/types/error'
import type { UIMessage, UIMessageChunk } from 'ai'

import type {
  StreamChunkPayload,
  StreamDonePayload,
  StreamDoneResult,
  StreamErrorPayload,
  StreamListener
} from '../types'

/**
 * Pushes stream events to an Electron WebContents (= one Renderer window).
 *
 * **Listener id is `wc:${wc.id}:${topicId}`** (data-plane identity, not requestId).
 *
 * Why topicId in the id (not requestId): during steering, a second `Ai_Stream_Open`
 * for the same topic causes AiStreamManager to add the new listeners to the *existing*
 * ActiveStream. If the id used requestId, the old and new WebContentsListener would
 * *coexist* in the Map → chunks double-dispatched to the same window. With
 * topicId, `addListener` upserts and only one subscription survives.
 */
export class WebContentsListener implements StreamListener {
  readonly id: string
  readonly executionId?: string

  constructor(
    private readonly wc: Electron.WebContents,
    private readonly topicId: string,
    executionId?: string
  ) {
    this.executionId = executionId
    this.id = executionId ? `wc:${wc.id}:${topicId}:${executionId}` : `wc:${wc.id}:${topicId}`
  }

  onChunk(chunk: UIMessageChunk): void {
    if (this.wc.isDestroyed()) return
    this.wc.send(IpcChannel.Ai_StreamChunk, {
      topicId: this.topicId,
      executionId: this.executionId,
      chunk
    } satisfies StreamChunkPayload)
  }

  onDone(result: StreamDoneResult): void {
    if (this.wc.isDestroyed()) return
    // Multi-model: only forward done for our own execution, or when topic is done
    // (broadcastExecutionDone sends to ALL listeners; without this guard,
    // model-1 finishing would also close model-2's ExecutionTransport stream)
    if (this.executionId && result.modelId && result.modelId !== this.executionId && !result.isTopicDone) return
    this.wc.send(IpcChannel.Ai_StreamDone, {
      topicId: this.topicId,
      executionId: this.executionId,
      status: result.status,
      isTopicDone: result.isTopicDone
    } satisfies StreamDonePayload)
  }

  onError(error: SerializedError, _partialMessage?: UIMessage, _modelId?: string, isTopicDone?: boolean): void {
    if (this.wc.isDestroyed()) return
    this.wc.send(IpcChannel.Ai_StreamError, {
      topicId: this.topicId,
      executionId: this.executionId,
      isTopicDone,
      error
    } satisfies StreamErrorPayload)
  }

  isAlive(): boolean {
    return !this.wc.isDestroyed()
  }
}
