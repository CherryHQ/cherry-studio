import { cacheService } from '@data/CacheService'
import { useEffect } from 'react'

/**
 * Mirrors Main's topic-level stream status into Cache so sidebar/topic
 * UI can read it via `useCache`.
 *
 * Main is the source of truth — the hook does nothing more than relay
 * `Ai_Topic_GetStatuses` (snapshot on mount) plus `Ai_TopicStatusChanged`
 * (pushed deltas). Terminal states (`done` / `error` / `aborted`) stick
 * in the cache until a local consumer (e.g. the active-topic `useEffect`
 * in `Topics.tsx`) evicts them — Main does not broadcast a reap signal.
 */
export function useAiStreamTopicCache(): void {
  useEffect(() => {
    let cancelled = false
    // Deltas that arrive while the snapshot request is in flight must
    // win — otherwise the stale snapshot could overwrite a newer state.
    // Tracking each topic we've already seen via delta lets the snapshot
    // apply skip those keys.
    const seenViaDelta = new Set<string>()

    const unsubscribe = window.api.ai.topic.onStatusChanged(({ topicId, status, activeExecutionIds }) => {
      seenViaDelta.add(topicId)
      cacheService.set(`topic.stream.status.${topicId}` as const, status)
      cacheService.set(
        `topic.stream.executions.${topicId}` as const,
        activeExecutionIds.length > 0 ? activeExecutionIds : undefined
      )
    })

    void window.api.ai.topic.getStatuses().then((snapshot) => {
      if (cancelled) return
      for (const [topicId, entry] of Object.entries(snapshot)) {
        if (seenViaDelta.has(topicId)) continue
        cacheService.set(`topic.stream.status.${topicId}` as const, entry.status)
        cacheService.set(
          `topic.stream.executions.${topicId}` as const,
          entry.activeExecutionIds.length > 0 ? entry.activeExecutionIds : undefined
        )
      }
    })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])
}
