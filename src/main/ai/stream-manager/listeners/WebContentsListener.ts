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

  constructor(
    private readonly wc: Electron.WebContents,
    private readonly topicId: string,
    private readonly executionId?: string
  ) {
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
    // Multi-model: only send topic-level done when ALL executions finished
    if (!result.isTopicDone) return
    if (this.wc.isDestroyed()) return
    this.wc.send(IpcChannel.Ai_StreamDone, {
      topicId: this.topicId,
      executionId: this.executionId,
      status: result.status
    } satisfies StreamDonePayload)
  }

  onError(error: SerializedError, _partialMessage?: UIMessage): void {
    if (this.wc.isDestroyed()) return
    this.wc.send(IpcChannel.Ai_StreamError, {
      topicId: this.topicId,
      executionId: this.executionId,
      error
    } satisfies StreamErrorPayload)
  }

  isAlive(): boolean {
    return !this.wc.isDestroyed()
  }
}
