import { application } from '@application'
import { loggerService } from '@logger'

import type { StreamCleanupPort, StreamDoneResult, StreamErrorResult, StreamPausedResult } from '../types'

const logger = loggerService.withContext('TraceFlushListener')

export class TraceFlushListener implements StreamCleanupPort {
  readonly id: string

  constructor(private readonly topicId: string) {
    this.id = `trace-flush:${topicId}`
  }

  async onTopicQuiesced(result: StreamDoneResult | StreamPausedResult | StreamErrorResult): Promise<void> {
    void result
    try {
      await application.get('TraceStorageService').saveSpans(this.topicId)
    } catch (err) {
      logger.warn('Failed to save trace spans', { topicId: this.topicId, err })
    }
  }
}
