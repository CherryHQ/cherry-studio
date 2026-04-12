import { loggerService } from '@logger'
import { messageService } from '@main/data/services/MessageService'
import type { SerializedError } from '@shared/types/error'

import type { CherryUIMessage, StreamDoneResult, StreamListener } from '../types'

const logger = loggerService.withContext('PersistenceListener')

export interface PersistenceListenerOptions {
  /** For logging/trace only. */
  topicId: string
  assistantId: string
  /** Real SQLite id of the user message created by handleStreamRequest. */
  parentUserMessageId: string
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
        data: { parts: finalMessage.parts },
        status
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
