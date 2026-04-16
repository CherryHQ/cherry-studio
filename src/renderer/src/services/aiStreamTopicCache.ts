import { cacheService } from '@data/CacheService'
import { loggerService } from '@logger'
import { useEffect } from 'react'

const logger = loggerService.withContext('aiStreamTopicCache')

/**
 * Subscribes to Main-side AI stream IPC events and mirrors each topic's
 * streaming state into Cache, so sidebar/topic UI can read it via useCache.
 */
export function useAiStreamTopicCache(): void {
  useEffect(() => {
    const unsubscribeChunk = window.api.ai.onStreamChunk(({ topicId }) => {
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

    const unsubscribeDone = window.api.ai.onStreamDone(({ topicId }) => {
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

    const unsubscribeError = window.api.ai.onStreamError(({ topicId, error }) => {
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

    return () => {
      unsubscribeChunk()
      unsubscribeDone()
      unsubscribeError()
    }
  }, [])
}
