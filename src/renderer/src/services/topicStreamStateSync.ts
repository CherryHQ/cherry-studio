import { cacheService } from '@data/CacheService'
import { loggerService } from '@logger'

const logger = loggerService.withContext('topicStreamStateSync')

let started = false

/**
 * Keeps topic loading/fulfilled flags in sync with the v2 AI stream.
 *
 * Mirrors Main-side AiStreamManager lifecycle events into Cache
 * so sidebar/topic UI can read streaming state via useCache hooks.
 */
export function ensureTopicStreamStateSyncStarted(): void {
  if (started || typeof window === 'undefined') return

  started = true

  window.api.ai.onStreamChunk(({ topicId }) => {
    const loadingKey = `topic.stream.loading.${topicId}` as const
    const fulfilledKey = `topic.stream.fulfilled.${topicId}` as const
    if (!cacheService.get(loadingKey)) {
      cacheService.set(loadingKey, true)
      cacheService.set('topic.stream.active_count', (cacheService.get('topic.stream.active_count') || 0) + 1)
    }
    if (cacheService.get(fulfilledKey)) {
      cacheService.set(fulfilledKey, false)
    }
  })

  window.api.ai.onStreamDone(({ topicId }) => {
    const loadingKey = `topic.stream.loading.${topicId}` as const
    if (cacheService.get(loadingKey)) {
      cacheService.set(loadingKey, false)
      cacheService.set(
        'topic.stream.active_count',
        Math.max(0, (cacheService.get('topic.stream.active_count') || 0) - 1)
      )
    }
    cacheService.set(`topic.stream.fulfilled.${topicId}` as const, true)
  })

  window.api.ai.onStreamError(({ topicId, error }) => {
    logger.warn('AI stream ended with error', { topicId, error })
    const loadingKey = `topic.stream.loading.${topicId}` as const
    if (cacheService.get(loadingKey)) {
      cacheService.set(loadingKey, false)
      cacheService.set(
        'topic.stream.active_count',
        Math.max(0, (cacheService.get('topic.stream.active_count') || 0) - 1)
      )
    }
  })
}
