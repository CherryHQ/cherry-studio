import { loggerService } from '@logger'
import { messageService } from '@main/data/services/MessageService'
import type { MessageStats } from '@shared/data/types/message'
import type { AssistantMeta, ModelMeta } from '@shared/data/types/meta'
import type { SerializedError } from '@shared/types/error'

import type { CherryUIMessage, StreamDoneResult, StreamListener } from '../types'

const logger = loggerService.withContext('PersistenceListener')

export interface PersistenceListenerOptions {
  topicId: string
  assistantId: string
  /** Real SQLite id of the user message created by handleStreamRequest. */
  parentUserMessageId: string
  /** Model id used for this generation. */
  modelId?: string
  /** Snapshot of model metadata for historical display (survives model rename/deletion). */
  modelMeta?: ModelMeta
  /** Snapshot of assistant metadata for historical display. */
  assistantMeta?: AssistantMeta
  /** Token usage and performance metrics, set by AiStreamManager from executeStream result. */
  stats?: MessageStats
  /** OpenTelemetry trace id for request tracing. */
  traceId?: string
  /** Multi-model: siblings group id shared by parallel responses to the same user message. */
  siblingsGroupId?: number
  /**
   * Optional post-persist hook. Runs only on `status === 'success'`.
   * Failures are caught and warned, never propagated.
   */
  afterPersist?: (finalMessage: CherryUIMessage) => Promise<void>
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
        assistantId: this.ctx.assistantId,
        modelId: this.ctx.modelId,
        modelMeta: this.ctx.modelMeta,
        assistantMeta: this.ctx.assistantMeta,
        traceId: this.ctx.traceId,
        siblingsGroupId: this.ctx.siblingsGroupId,
        data: { parts: finalMessage.parts },
        status,
        // Extract stats from finalMessage metadata if available (token usage from AI SDK)
        stats:
          (this.ctx.stats ?? finalMessage.metadata?.totalTokens)
            ? { totalTokens: finalMessage.metadata?.totalTokens }
            : undefined
      })

      logger.info('Assistant message persisted', {
        topicId: this.ctx.topicId,
        status
      })
    } catch (err) {
      logger.error('Failed to persist assistant message', {
        topicId: this.ctx.topicId,
        err
      })
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

  async onError(_error: SerializedError): Promise<void> {
    // Don't persist error messages (consistent with v1 ChatSession.handleFinish)
  }

  isAlive(): boolean {
    return true
  }
}
