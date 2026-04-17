import type { UniqueModelId } from '@shared/data/types/model'
import { IpcChannel } from '@shared/IpcChannel'
import type { UIMessageChunk } from 'ai'

import type {
  StreamChunkPayload,
  StreamDonePayload,
  StreamDoneResult,
  StreamErrorPayload,
  StreamErrorResult,
  StreamListener,
  StreamPausedResult
} from '../types'

/**
 * Pushes stream events to an Electron WebContents (= one Renderer window).
 *
 * Pure forwarding — zero filtering logic. Routing is done upstream by
 * AiStreamManager (isMultiModel → sourceModelId tag) and downstream by
 * the frontend transport (matchesStream). One instance per topic per window.
 *
 * ID: `wc:${wc.id}:${topicId}` — steering upserts, no duplicate dispatch.
 */
export class WebContentsListener implements StreamListener {
  readonly id: string

  constructor(
    private readonly wc: Electron.WebContents,
    private readonly topicId: string
  ) {
    this.id = `wc:${wc.id}:${topicId}`
  }

  onChunk(chunk: UIMessageChunk, sourceModelId?: UniqueModelId): void {
    if (this.wc.isDestroyed()) return
    this.wc.send(IpcChannel.Ai_StreamChunk, {
      topicId: this.topicId,
      executionId: sourceModelId,
      chunk
    } satisfies StreamChunkPayload)
  }

  onDone(result: StreamDoneResult): void {
    if (this.wc.isDestroyed()) return
    this.wc.send(IpcChannel.Ai_StreamDone, {
      topicId: this.topicId,
      executionId: result.modelId,
      status: result.status,
      isTopicDone: result.isTopicDone
    } satisfies StreamDonePayload)
  }

  onPaused(result: StreamPausedResult): void {
    if (this.wc.isDestroyed()) return
    this.wc.send(IpcChannel.Ai_StreamDone, {
      topicId: this.topicId,
      executionId: result.modelId,
      status: result.status,
      isTopicDone: result.isTopicDone
    } satisfies StreamDonePayload)
  }

  onError(result: StreamErrorResult): void {
    if (this.wc.isDestroyed()) return
    // We don't forward `result.finalMessage` here yet — the renderer keeps
    // its own accumulated state from the chunk stream. Plumbing partial
    // content through the IPC payload is a future optimisation.
    this.wc.send(IpcChannel.Ai_StreamError, {
      topicId: this.topicId,
      executionId: result.modelId,
      isTopicDone: result.isTopicDone,
      error: result.error
    } satisfies StreamErrorPayload)
  }

  isAlive(): boolean {
    return !this.wc.isDestroyed()
  }
}
