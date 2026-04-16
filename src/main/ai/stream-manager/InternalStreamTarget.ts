import type { UniqueModelId } from '@shared/data/types/model'
import { IpcChannel } from '@shared/IpcChannel'
import type { SerializedError } from '@shared/types/error'
import type { UIMessageChunk } from 'ai'

import type { AiStreamManager } from './AiStreamManager'
import type { CherryUIMessage, StreamTarget } from './types'

/**
 * StreamTarget adapter that routes executeStream output back to AiStreamManager.
 *
 * AiService.executeStream only sees `StreamTarget` (send + isDestroyed +
 * optional setFinalMessage). It does not know whether the target is a real
 * Electron WebContents or this adapter — that's the decoupling point.
 *
 * Bound to a `topicId` + `modelId` pair, identifying one execution within
 * a (potentially multi-model) ActiveStream.
 */
export class InternalStreamTarget implements StreamTarget {
  constructor(
    private readonly manager: AiStreamManager,
    private readonly topicId: string,
    private readonly modelId: UniqueModelId
  ) {}

  send(channel: string, payload: { chunk?: UIMessageChunk; error?: SerializedError; [key: string]: unknown }): void {
    switch (channel) {
      case IpcChannel.Ai_StreamChunk:
        if (payload.chunk) this.manager.onChunk(this.topicId, this.modelId, payload.chunk)
        break
      case IpcChannel.Ai_StreamDone:
        void this.manager.onExecutionDone(this.topicId, this.modelId)
        break
      case IpcChannel.Ai_StreamError:
        if (payload.error) void this.manager.onExecutionError(this.topicId, this.modelId, payload.error)
        break
    }
  }

  isDestroyed(): boolean {
    return this.manager.shouldStopExecution(this.topicId, this.modelId)
  }

  setFinalMessage(message: CherryUIMessage): void {
    this.manager.setExecutionFinalMessage(this.topicId, this.modelId, message)
  }
}
