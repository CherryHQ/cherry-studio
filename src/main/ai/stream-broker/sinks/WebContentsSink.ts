import { IpcChannel } from '@shared/IpcChannel'
import type { SerializedError } from '@shared/types/error'
import type { UIMessageChunk } from 'ai'

import type {
  BrokerStreamChunkPayload,
  BrokerStreamDonePayload,
  BrokerStreamErrorPayload,
  StreamDoneResult,
  StreamSink
} from '../types'

/**
 * Pushes stream events to an Electron WebContents (= one Renderer window).
 *
 * **Sink id is `wc:${wc.id}:${topicId}`** (data-plane identity, not requestId).
 *
 * Why topicId in the id (not requestId): during steering, a second `Ai_Stream_Open`
 * for the same topic causes the Broker to add the new sinks to the *existing*
 * ActiveStream. If the id used requestId, the old and new WebContentsSink would
 * *coexist* in the Map → chunks double-dispatched to the same window. With
 * topicId, `addSink` upserts and only one subscription survives.
 */
export class WebContentsSink implements StreamSink {
  readonly id: string

  constructor(
    private readonly wc: Electron.WebContents,
    private readonly topicId: string
  ) {
    this.id = `wc:${wc.id}:${topicId}`
  }

  onChunk(chunk: UIMessageChunk): void {
    if (this.wc.isDestroyed()) return
    this.wc.send(IpcChannel.Ai_StreamChunk, {
      topicId: this.topicId,
      chunk
    } satisfies BrokerStreamChunkPayload)
  }

  onDone(result: StreamDoneResult): void {
    if (this.wc.isDestroyed()) return
    this.wc.send(IpcChannel.Ai_StreamDone, {
      topicId: this.topicId,
      status: result.status
    } satisfies BrokerStreamDonePayload)
  }

  onError(error: SerializedError): void {
    if (this.wc.isDestroyed()) return
    this.wc.send(IpcChannel.Ai_StreamError, {
      topicId: this.topicId,
      error
    } satisfies BrokerStreamErrorPayload)
  }

  isAlive(): boolean {
    return !this.wc.isDestroyed()
  }
}
