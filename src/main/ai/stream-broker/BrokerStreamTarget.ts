import { IpcChannel } from '@shared/IpcChannel'
import type { SerializedError } from '@shared/types/error'
import type { UIMessageChunk } from 'ai'

import type { CherryUIMessage, StreamTarget } from './types'

// Use a lazy import to break the circular dependency:
// BrokerStreamTarget → AiStreamBroker → (uses BrokerStreamTarget in startStream)
// At runtime the broker instance is passed via constructor, so we only need the
// type at compile time. We define a minimal interface here instead of importing
// the class directly.
interface BrokerCallbacks {
  onChunk(requestId: string, chunk: UIMessageChunk): void
  onDone(requestId: string, status?: 'success' | 'paused'): Promise<void>
  onError(requestId: string, error: SerializedError): Promise<void>
  shouldStopStream(requestId: string): boolean
  setStreamFinalMessage(requestId: string, message: CherryUIMessage): void
}

/**
 * A fake "WebContents" that routes executeStream's output back to the Broker.
 *
 * AiService.executeStream only sees `StreamTarget` (send + isDestroyed +
 * optional setFinalMessage). It does not know whether the target is a real
 * Electron WebContents or this Broker shim — that's the decoupling point.
 *
 * Bound to a specific `requestId` (one generation attempt). Chunks / done /
 * error events are forwarded to the Broker's per-requestId callbacks, which
 * then multicast to all sinks.
 */
export class BrokerStreamTarget implements StreamTarget {
  constructor(
    private readonly broker: BrokerCallbacks,
    private readonly requestId: string
  ) {}

  send(channel: string, payload: { chunk?: UIMessageChunk; error?: SerializedError }): void {
    switch (channel) {
      case IpcChannel.Ai_StreamChunk:
        if (payload.chunk) this.broker.onChunk(this.requestId, payload.chunk)
        break
      case IpcChannel.Ai_StreamDone:
        void this.broker.onDone(this.requestId)
        break
      case IpcChannel.Ai_StreamError:
        if (payload.error) void this.broker.onError(this.requestId, payload.error)
        break
    }
  }

  isDestroyed(): boolean {
    return this.broker.shouldStopStream(this.requestId)
  }

  setFinalMessage(message: CherryUIMessage): void {
    this.broker.setStreamFinalMessage(this.requestId, message)
  }
}
