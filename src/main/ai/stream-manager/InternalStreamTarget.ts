import { IpcChannel } from '@shared/IpcChannel'
import type { SerializedError } from '@shared/types/error'
import type { UIMessageChunk } from 'ai'

import type { CherryUIMessage, StreamTarget } from './types'

// Use a lazy import to break the circular dependency:
// InternalStreamTarget → AiStreamManager → (uses InternalStreamTarget in startStream)
// At runtime the manager instance is passed via constructor, so we only need the
// type at compile time. We define a minimal interface here instead of importing
// the class directly.
interface ManagerCallbacks {
  onChunk(requestId: string, chunk: UIMessageChunk): void
  onDone(requestId: string, status?: 'success' | 'paused'): Promise<void>
  onError(requestId: string, error: SerializedError): Promise<void>
  shouldStopStream(requestId: string): boolean
  setStreamFinalMessage(requestId: string, message: CherryUIMessage): void
}

/**
 * StreamTarget adapter that routes executeStream output back to AiStreamManager.
 *
 * AiService.executeStream only sees `StreamTarget` (send + isDestroyed +
 * optional setFinalMessage). It does not know whether the target is a real
 * Electron WebContents or this adapter — that's the decoupling point.
 *
 * Bound to a specific `requestId` (one generation attempt). Chunks / done /
 * error events are forwarded to AiStreamManager's per-requestId callbacks, which
 * then multicast to all listeners.
 */
export class InternalStreamTarget implements StreamTarget {
  constructor(
    private readonly manager: ManagerCallbacks,
    private readonly requestId: string
  ) {}

  send(channel: string, payload: { chunk?: UIMessageChunk; error?: SerializedError; [key: string]: unknown }): void {
    switch (channel) {
      case IpcChannel.Ai_StreamChunk:
        if (payload.chunk) this.manager.onChunk(this.requestId, payload.chunk)
        break
      case IpcChannel.Ai_StreamDone:
        void this.manager.onDone(this.requestId)
        break
      case IpcChannel.Ai_StreamError:
        if (payload.error) void this.manager.onError(this.requestId, payload.error)
        break
    }
  }

  isDestroyed(): boolean {
    return this.manager.shouldStopStream(this.requestId)
  }

  setFinalMessage(message: CherryUIMessage): void {
    this.manager.setStreamFinalMessage(this.requestId, message)
  }
}
