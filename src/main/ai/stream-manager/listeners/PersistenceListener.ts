import { loggerService } from '@logger'
import type { SerializedError } from '@shared/types/error'

import type { CherryUIMessage, StreamDoneResult, StreamListener } from '../types'

const logger = loggerService.withContext('PersistenceListener')

export interface PersistenceListenerOptions {
  /** For logging/trace only — does not participate in listener.id construction. */
  requestId?: string
  topicId: string
  assistantId: string
  /** Real SQLite id of the user message created by handleStreamRequest step 1. */
  parentUserMessageId: string
  /**
   * Optional post-persist hook. Runs only on `status === 'success'`.
   * Failures are caught + warned, never propagated.
   */
  afterPersist?: (finalMessage: CherryUIMessage) => Promise<void>
}

/**
 * Writes the assistant message to SQLite when the stream ends.
 *
 * **Listener id is `persistence:${topicId}`** (topic-based, not requestId).
 *
 * Why: during steering, a second `Ai_Stream_Open` for the same topic causes the
 * Broker to add the new PersistenceListener to the *existing* ActiveStream via upsert.
 * Topic-based id ensures only one PersistenceListener survives per topic, with the
 * `parentUserMessageId` updated to the latest steered user message. If the id used
 * requestId, two listeners would coexist → `onDone` fires twice → duplicate assistant
 * rows in SQLite.
 */
export class PersistenceListener implements StreamListener {
  readonly id: string

  constructor(private readonly ctx: PersistenceListenerOptions) {
    this.id = `persistence:${ctx.topicId}`
  }

  onChunk(): void {
    // no-op: persistence only writes on onDone
  }

  async onDone(result: StreamDoneResult): Promise<void> {
    const { finalMessage, status } = result

    if (!finalMessage) {
      logger.warn('PersistenceListener.onDone without finalMessage, skipping persistence', {
        topicId: this.ctx.topicId,
        requestId: this.ctx.requestId,
        status
      })
      return
    }

    // TODO (Step 2.6): Call messageService.create(topicId, { role: 'assistant', ... })
    // For now this is a skeleton — the real implementation will:
    //  1. Write assistant message to SQLite via messageService.create
    //  2. Run afterPersist hook (success path only)
    logger.info('PersistenceListener.onDone [skeleton]', {
      topicId: this.ctx.topicId,
      requestId: this.ctx.requestId,
      status,
      hasAfterPersist: !!this.ctx.afterPersist
    })
  }

  async onError(_error: SerializedError): Promise<void> {
    // Strategy: don't persist error messages (consistent with v1 ChatSession.handleFinish)
  }

  isAlive(): boolean {
    return true
  }
}
