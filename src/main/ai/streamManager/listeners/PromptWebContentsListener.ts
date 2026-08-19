import { ConversationAttachStatus } from '@shared/ai/conversation'
import type { IpcEventName } from '@shared/ipc/schemas/ipcSchemas'
import type { EventPayload } from '@shared/ipc/types'
import { IpcChannel } from '@shared/IpcChannel'
import type { UIMessageChunk } from 'ai'

import type { StreamErrorResult, StreamListener } from '../types'

/** Renderer listener for one-shot prompt streams, kept outside Conversation protocol. */
export class PromptWebContentsListener implements StreamListener {
  readonly id: string

  constructor(
    private readonly webContents: Electron.WebContents,
    private readonly streamId: string
  ) {
    this.id = `prompt-wc:${webContents.id}:${streamId}`
  }

  onChunk(chunk: UIMessageChunk): void {
    this.emit('ai.prompt.chunk', { streamId: this.streamId, chunk })
  }

  onDone(): void {
    this.emit('ai.prompt.done', { streamId: this.streamId, status: ConversationAttachStatus.Done })
  }

  onPaused(): void {
    this.emit('ai.prompt.done', { streamId: this.streamId, status: ConversationAttachStatus.Paused })
  }

  onError(result: StreamErrorResult): void {
    this.emit('ai.prompt.error', { streamId: this.streamId, error: result.error })
  }

  isAlive(): boolean {
    return !this.webContents.isDestroyed()
  }

  private emit<E extends IpcEventName>(event: E, payload: EventPayload<E>): void {
    if (!this.webContents.isDestroyed()) this.webContents.send(IpcChannel.IpcApi_Event, event, payload)
  }
}
