import { cacheService } from '@data/CacheService'
import { useEffect } from 'react'

/**
 * Mirrors Main's topic-level stream status into Cache so sidebar/topic
 * UI can read it via `useCache`.
 *
 * Main is the source of truth — the hook does nothing more than relay
 * `Ai_Topic_GetStatuses` (snapshot on mount) plus `Ai_TopicStatusChanged`
 * (pushed deltas). Absence of a key means "no active stream" for that
 * topic; an explicit `'idle'` delta is how Main tells us to forget a
 * topic once its grace-period timer has reaped the ActiveStream.
 */
export function useAiStreamTopicCache(): void {
  useEffect(() => {
    let cancelled = false

    void window.api.ai.topic.getStatuses().then((snapshot) => {
      if (cancelled) return
      for (const [topicId, status] of Object.entries(snapshot)) {
        cacheService.set(`topic.stream.status.${topicId}` as const, status)
      }
    })

    const unsubscribe = window.api.ai.topic.onStatusChanged(({ topicId, status }) => {
      const key = `topic.stream.status.${topicId}` as const
      if (status === 'idle') {
        cacheService.set(key, undefined)
        return
      }
      cacheService.set(key, status)
    })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])
}
