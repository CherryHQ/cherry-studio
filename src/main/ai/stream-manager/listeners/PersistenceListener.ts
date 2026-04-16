import { loggerService } from '@logger'
import { messageService } from '@main/data/services/MessageService'
import type { MessageData, MessageStats, ModelSnapshot } from '@shared/data/types/message'
import type { SerializedError } from '@shared/types/error'
import type { UIMessage } from 'ai'

import type { StreamDoneResult, StreamListener, StreamPausedResult } from '../types'

const logger = loggerService.withContext('PersistenceListener')

export interface PersistenceListenerOptions {
  topicId: string
  /** Placeholder assistant message id created before the stream starts. */
  assistantMessageId: string
  /** Real SQLite id of the user message created by handleStreamRequest. */
  parentUserMessageId: string
  /** Model identifier (UniqueModelId). */
  modelId?: string
  /** Model snapshot for historical display (survives model rename/deletion). */
  modelSnapshot?: ModelSnapshot
  /** Token usage and performance metrics. */
  stats?: MessageStats
  /** OpenTelemetry trace id. */
  traceId?: string
  /** Multi-model: siblings group id shared by parallel responses. */
  siblingsGroupId?: number
  /**
   * Optional post-persist hook. Runs only on `status === 'success'`.
   * Failures are caught and warned, never propagated.
   */
  afterPersist?: (finalMessage: UIMessage) => Promise<void>
}

/**
 * Writes the assistant message to SQLite when the stream ends.
 *
 * Listener id is `persistence:${topicId}` — topic-based for steering upsert correctness.
 */
export class PersistenceListener implements StreamListener {
  readonly id: string

  constructor(private readonly ctx: PersistenceListenerOptions) {
    this.id = `persistence:${ctx.topicId}:${ctx.modelId ?? 'default'}`
  }

  onChunk(): void {
    // Persistence only writes on terminal events, not per-chunk.
  }

  async onDone(result: StreamDoneResult): Promise<void> {
    // Multi-model: only persist for our own model's execution
    if (result.modelId && this.ctx.modelId && result.modelId !== this.ctx.modelId) return

    const { finalMessage } = result

    try {
      await messageService.update(this.ctx.assistantMessageId, {
        ...(finalMessage ? { data: { parts: finalMessage.parts } } : {}),
        status: 'success',
        stats:
          this.ctx.stats ??
          (finalMessage?.metadata?.totalTokens ? { totalTokens: finalMessage.metadata.totalTokens } : undefined)
      })

      if (!finalMessage) {
        logger.warn('onDone without finalMessage, updated placeholder status only', {
          topicId: this.ctx.topicId,
          assistantMessageId: this.ctx.assistantMessageId,
          status: 'success'
        })
      }

      logger.info('Assistant placeholder finalized', {
        topicId: this.ctx.topicId,
        assistantMessageId: this.ctx.assistantMessageId,
        status: 'success'
      })
    } catch (err) {
      logger.error('Failed to finalize assistant placeholder', {
        topicId: this.ctx.topicId,
        assistantMessageId: this.ctx.assistantMessageId,
        err
      })
      return
    }

    // Post-persist hook: only on success, best-effort
    if (finalMessage && this.ctx.afterPersist) {
      try {
        await this.ctx.afterPersist(finalMessage)
      } catch (err) {
        logger.warn('afterPersist hook failed', { topicId: this.ctx.topicId, err })
      }
    }
  }

  async onPaused(result: StreamPausedResult): Promise<void> {
    if (result.modelId && this.ctx.modelId && result.modelId !== this.ctx.modelId) return

    const { finalMessage } = result

    try {
      await messageService.update(this.ctx.assistantMessageId, {
        ...(finalMessage ? { data: { parts: finalMessage.parts } } : {}),
        status: 'paused',
        stats:
          this.ctx.stats ??
          (finalMessage?.metadata?.totalTokens ? { totalTokens: finalMessage.metadata.totalTokens } : undefined)
      })

      logger.info('Assistant placeholder paused', {
        topicId: this.ctx.topicId,
        assistantMessageId: this.ctx.assistantMessageId
      })
    } catch (err) {
      logger.error('Failed to persist paused assistant placeholder', {
        topicId: this.ctx.topicId,
        assistantMessageId: this.ctx.assistantMessageId,
        err
      })
    }
  }

  async onError(error: SerializedError, partialMessage?: UIMessage, modelId?: string): Promise<void> {
    // Multi-model: only persist for our own model's execution
    if (modelId && this.ctx.modelId && modelId !== this.ctx.modelId) return
    try {
      // Combine partial streamed content with error part
      const partialParts = (partialMessage?.parts ?? []) as MessageData['parts']
      const errorPart = { type: 'data-error' as const, data: { ...error } }
      const parts = [...(partialParts ?? []), errorPart]

      await messageService.update(this.ctx.assistantMessageId, {
        data: { parts },
        status: 'error',
        stats: this.ctx.stats
      })
      logger.info('Assistant placeholder marked errored', {
        topicId: this.ctx.topicId,
        assistantMessageId: this.ctx.assistantMessageId,
        hasPartial: !!partialMessage
      })
    } catch (err) {
      logger.error('Failed to persist assistant placeholder error', {
        topicId: this.ctx.topicId,
        assistantMessageId: this.ctx.assistantMessageId,
        err
      })
    }
  }

  isAlive(): boolean {
    return true
  }
}
