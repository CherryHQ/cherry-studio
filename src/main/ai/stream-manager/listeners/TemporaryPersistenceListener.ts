/**
 * TemporaryPersistenceListener — in-memory counterpart to PersistenceListener.
 *
 * Appends the assistant message to TemporaryChatService when the stream terminates.
 * Unlike `PersistenceListener` (which updates a pre-created SQLite placeholder),
 * temporary chats use a simplified "append-on-finalize" strategy:
 *
 *  - Stream not started yet → no placeholder exists
 *  - onDone / onPaused → append the assistant message
 *  - onError → append an assistant message whose parts include an error part
 *
 * The service generates the message id internally. There's no cross-process id
 * alignment to worry about: temporary topics are window-local (no multi-window
 * reads, no DB rehydration), so the Renderer's `useChat` state id and the
 * service-side id never need to match.
 */

import { loggerService } from '@logger'
import { temporaryChatService } from '@main/data/services/TemporaryChatService'
import type { CherryMessagePart, MessageStats, ModelSnapshot } from '@shared/data/types/message'
import type { SerializedError } from '@shared/types/error'
import type { UIMessage } from 'ai'

import type { StreamDoneResult, StreamListener, StreamPausedResult } from '../types'

const logger = loggerService.withContext('TemporaryPersistenceListener')

export interface TemporaryPersistenceListenerOptions {
  topicId: string
  /** Model identifier (UniqueModelId). Also used for multi-model result filtering. */
  modelId?: string
  /** Model snapshot captured at send time. */
  modelSnapshot?: ModelSnapshot
  /** Optional explicit stats override (else derive totalTokens from finalMessage). */
  stats?: MessageStats
}

export class TemporaryPersistenceListener implements StreamListener {
  readonly id: string

  constructor(private readonly ctx: TemporaryPersistenceListenerOptions) {
    this.id = `temp-persistence:${ctx.topicId}:${ctx.modelId ?? 'default'}`
  }

  onChunk(): void {
    // Persistence only acts on terminal events.
  }

  async onDone(result: StreamDoneResult): Promise<void> {
    if (result.modelId && this.ctx.modelId && result.modelId !== this.ctx.modelId) return
    await this.persistAssistant(result.finalMessage, 'success')
  }

  async onPaused(result: StreamPausedResult): Promise<void> {
    if (result.modelId && this.ctx.modelId && result.modelId !== this.ctx.modelId) return
    await this.persistAssistant(result.finalMessage, 'paused')
  }

  async onError(error: SerializedError, partialMessage?: UIMessage, modelId?: string): Promise<void> {
    if (modelId && this.ctx.modelId && modelId !== this.ctx.modelId) return
    const partialParts = (partialMessage?.parts ?? []) as CherryMessagePart[]
    const errorPart = { type: 'data-error' as const, data: { ...error } }
    const parts = [...partialParts, errorPart] as CherryMessagePart[]

    try {
      await temporaryChatService.appendMessage(this.ctx.topicId, {
        role: 'assistant',
        data: { parts },
        status: 'error',
        modelId: this.ctx.modelId,
        modelSnapshot: this.ctx.modelSnapshot,
        stats: this.ctx.stats
      })
      logger.info('Temporary assistant error appended', {
        topicId: this.ctx.topicId,
        hasPartial: !!partialMessage
      })
    } catch (err) {
      logger.error('Failed to append temporary error message', {
        topicId: this.ctx.topicId,
        err
      })
    }
  }

  isAlive(): boolean {
    return true
  }

  private async persistAssistant(finalMessage: UIMessage | undefined, status: 'success' | 'paused'): Promise<void> {
    if (!finalMessage) {
      logger.warn('Terminal event without finalMessage, skipping temporary persistence', {
        topicId: this.ctx.topicId,
        status
      })
      return
    }

    try {
      await temporaryChatService.appendMessage(this.ctx.topicId, {
        role: 'assistant',
        data: { parts: finalMessage.parts as CherryMessagePart[] },
        status,
        modelId: this.ctx.modelId,
        modelSnapshot: this.ctx.modelSnapshot,
        stats:
          this.ctx.stats ??
          (finalMessage.metadata && typeof finalMessage.metadata === 'object' && 'totalTokens' in finalMessage.metadata
            ? { totalTokens: (finalMessage.metadata as { totalTokens: number }).totalTokens }
            : undefined)
      })
      logger.info('Temporary assistant message appended', { topicId: this.ctx.topicId, status })
    } catch (err) {
      logger.error('Failed to append temporary assistant message', {
        topicId: this.ctx.topicId,
        status,
        err
      })
    }
  }
}
