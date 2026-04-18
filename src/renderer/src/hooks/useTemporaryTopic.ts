/**
 * useTemporaryTopic — lease a short-lived in-memory topic on the Main process.
 *
 * Used by single-turn quick assistants (selection toolbar, mini window) to obtain
 * a topic id whose messages live in `TemporaryChatService` (not SQLite), so their
 * scratch conversations never pollute the user's persistent chat history.
 *
 * Lifecycle:
 *   - On mount (with a valid assistantId): POST /temporary/topics
 *   - On unmount OR assistantId change: DELETE /temporary/topics/:id
 *   - Consumers can call `reset()` to drop the current topic and lease a fresh one
 *     (used by "new conversation" actions in the mini window).
 *
 * The returned `ready` flag guards the `useChat` call-site — consumers should only
 * submit messages once `ready` is true; until then `topicId` is `null`.
 *
 * Race handling: if the component unmounts (or reset is called) before the POST
 * resolves, the hook still deletes the freshly created topic to avoid Main-side leaks.
 */

import { dataApiService } from '@data/DataApiService'
import { loggerService } from '@logger'
import { useCallback, useEffect, useState } from 'react'

const logger = loggerService.withContext('useTemporaryTopic')

export interface UseTemporaryTopicResult {
  /** Null until the temporary topic is created on Main. */
  topicId: string | null
  /** True once `topicId` is available. */
  ready: boolean
  /** Drop the current topic and lease a fresh one. No-op if assistantId is missing. */
  reset: () => void
}

export function useTemporaryTopic(assistantId: string | undefined): UseTemporaryTopicResult {
  const [topicId, setTopicId] = useState<string | null>(null)
  /** Bumped by `reset()` to force the effect to re-run and allocate a new topic. */
  const [epoch, setEpoch] = useState(0)

  useEffect(() => {
    if (!assistantId) {
      setTopicId(null)
      return
    }

    let cancelled = false
    let createdId: string | null = null

    void dataApiService
      .post('/temporary/topics', { body: { assistantId } })
      .then((topic) => {
        createdId = topic.id
        if (cancelled) {
          void dataApiService.delete(`/temporary/topics/${topic.id}`).catch((err) => {
            logger.warn('Failed to cleanup racing temporary topic', err as Error)
          })
          return
        }
        setTopicId(topic.id)
        logger.debug('Leased temporary topic', { topicId: topic.id, assistantId, epoch })
      })
      .catch((err) => {
        logger.error('Failed to create temporary topic', err as Error)
      })

    return () => {
      cancelled = true
      setTopicId(null)
      if (createdId) {
        void dataApiService.delete(`/temporary/topics/${createdId}`).catch((err) => {
          logger.warn('Failed to release temporary topic on unmount', err as Error)
        })
      }
    }
  }, [assistantId, epoch])

  const reset = useCallback(() => {
    setEpoch((n) => n + 1)
  }, [])

  return { topicId, ready: topicId !== null, reset }
}
