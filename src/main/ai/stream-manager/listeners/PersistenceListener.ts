import { loggerService } from '@logger'
import { messageService } from '@main/data/services/MessageService'
import type { MessageData, MessageStats, ModelSnapshot } from '@shared/data/types/message'
import type { SerializedError } from '@shared/types/error'
import type { UIMessage } from 'ai'

import type { StreamDoneResult, StreamListener } from '../types'

const logger = loggerService.withContext('PersistenceListener')

export interface PersistenceListenerOptions {
  topicId: string
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
    this.id = `persistence:${ctx.topicId}`
  }

  onChunk(): void {
    // Persistence only writes on onDone, not per-chunk.
  }

  async onDone(result: StreamDoneResult): Promise<void> {
    // Multi-model: only persist for our own model's execution
    if (result.modelId && this.ctx.modelId && result.modelId !== this.ctx.modelId) return

    const { finalMessage, status } = result

    if (!finalMessage) {
      logger.warn('onDone without finalMessage, skipping persistence', {
        topicId: this.ctx.topicId,
        status
      })
      return
    }

    try {
      await messageService.create(this.ctx.topicId, {
        role: 'assistant',
        parentId: this.ctx.parentUserMessageId,
        modelId: this.ctx.modelId,
        modelSnapshot: this.ctx.modelSnapshot,
        traceId: this.ctx.traceId,
        siblingsGroupId: this.ctx.siblingsGroupId,
        data: { parts: finalMessage.parts },
        status,
        stats:
          this.ctx.stats ??
          (finalMessage.metadata?.totalTokens ? { totalTokens: finalMessage.metadata.totalTokens } : undefined)
      })

      logger.info('Assistant message persisted', { topicId: this.ctx.topicId, status })
    } catch (err) {
      logger.error('Failed to persist assistant message', { topicId: this.ctx.topicId, err })
      return
    }

    // Post-persist hook: only on success, best-effort
    if (status === 'success' && this.ctx.afterPersist) {
      try {
        await this.ctx.afterPersist(finalMessage)
      } catch (err) {
        logger.warn('afterPersist hook failed', { topicId: this.ctx.topicId, err })
      }
    }
  }

  async onError(error: SerializedError, partialMessage?: UIMessage, modelId?: string): Promise<void> {
    // Multi-model: only persist for our own model's execution
    if (modelId && this.ctx.modelId && modelId !== this.ctx.modelId) return
    try {
      // Combine partial streamed content with error part
      const partialParts = (partialMessage?.parts ?? []) as MessageData['parts']
      const errorPart = { type: 'data-error' as const, data: { name: error.name, message: error.message } }
      const parts = [...(partialParts ?? []), errorPart]

      await messageService.create(this.ctx.topicId, {
        role: 'assistant',
        parentId: this.ctx.parentUserMessageId,
        modelId: this.ctx.modelId,
        modelSnapshot: this.ctx.modelSnapshot,
        traceId: this.ctx.traceId,
        siblingsGroupId: this.ctx.siblingsGroupId,
        data: { parts },
        status: 'error'
      })
      logger.info('Error message persisted', { topicId: this.ctx.topicId, hasPartial: !!partialMessage })
    } catch (err) {
      logger.error('Failed to persist error message', { topicId: this.ctx.topicId, err })
    }
  }

  isAlive(): boolean {
    return true
  }
}
