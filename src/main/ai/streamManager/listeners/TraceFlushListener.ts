import { loggerService } from '@logger'
import { application } from '@main/core/application'

import type { StreamDoneResult, StreamErrorResult, StreamListener, StreamPausedResult } from '../types'

const logger = loggerService.withContext('TraceFlushListener')

export class TraceFlushListener implements StreamListener {
  readonly id: string

  constructor(private readonly topicId: string) {
    this.id = `persistence:trace:${topicId}`
  }

  onChunk(): void {}

  async onDone(result: StreamDoneResult): Promise<void> {
    await this.flushIfTopicDone(result.isTopicDone)
  }

  async onPaused(result: StreamPausedResult): Promise<void> {
    await this.flushIfTopicDone(result.isTopicDone)
  }

  async onError(result: StreamErrorResult): Promise<void> {
    await this.flushIfTopicDone(result.isTopicDone)
  }

  isAlive(): boolean {
    return true
  }

  private async flushIfTopicDone(isTopicDone: boolean | undefined): Promise<void> {
    if (isTopicDone === false) return

    try {
      await application.get('SpanCacheService').saveSpans(this.topicId)
    } catch (err) {
      logger.warn('Failed to save trace spans', { topicId: this.topicId, err })
    }
  }
}
