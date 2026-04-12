import { IpcChannel } from '@shared/IpcChannel'
import type { SerializedError } from '@shared/types/error'
import type { UIMessageChunk } from 'ai'

import type { CherryUIMessage, StreamTarget } from './types'

// Minimal interface to avoid circular import with AiStreamManager.
interface ManagerCallbacks {
  onChunk(topicId: string, chunk: UIMessageChunk): void
  onDone(topicId: string, status?: 'success' | 'paused'): Promise<void>
  onError(topicId: string, error: SerializedError): Promise<void>
  shouldStopStream(topicId: string): boolean
  setStreamFinalMessage(topicId: string, message: CherryUIMessage): void
}

/**
 * StreamTarget adapter that routes executeStream output back to AiStreamManager.
 *
 * AiService.executeStream only sees `StreamTarget` (send + isDestroyed +
 * optional setFinalMessage). It does not know whether the target is a real
 * Electron WebContents or this adapter — that's the decoupling point.
 *
 * Bound to a `topicId`. All events are routed back to AiStreamManager by topicId.
 */
export class InternalStreamTarget implements StreamTarget {
  constructor(
    private readonly manager: ManagerCallbacks,
    private readonly topicId: string
  ) {}

  send(channel: string, payload: { chunk?: UIMessageChunk; error?: SerializedError; [key: string]: unknown }): void {
    switch (channel) {
      case IpcChannel.Ai_StreamChunk:
        if (payload.chunk) this.manager.onChunk(this.topicId, payload.chunk)
        break
      case IpcChannel.Ai_StreamDone:
        void this.manager.onDone(this.topicId)
        break
      case IpcChannel.Ai_StreamError:
        if (payload.error) void this.manager.onError(this.topicId, payload.error)
        break
    }
  }

  isDestroyed(): boolean {
    return this.manager.shouldStopStream(this.topicId)
  }

  setFinalMessage(message: CherryUIMessage): void {
    this.manager.setStreamFinalMessage(this.topicId, message)
  }
}
