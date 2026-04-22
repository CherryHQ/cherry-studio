/**
 * Per-topic stream state derived from the shared `topic.stream.statuses`
 * Record. Main owns the Record (`AiStreamManager.broadcastTopicStatus` →
 * `cacheService.setShared`), renderers read it via `useSharedCache` + a
 * memoised selector.
 *
 * Terminal states linger in the Main-side Record until each window
 * flips its local `topic.stream.seen.*` flag, at which point the
 * fulfilled indicator stops surfacing in that window specifically. The
 * "seen" state is window-local so one window dismissing the badge
 * doesn't hide it in another.
 */

import { useCache, useSharedCache } from '@renderer/data/hooks/useCache'
import type { TopicStreamStatus } from '@shared/ai/transport'
import type { UniqueModelId } from '@shared/data/types/model'
import { useCallback, useMemo } from 'react'

interface TopicStreamStatusView {
  status: TopicStreamStatus | undefined
  activeExecutionIds: UniqueModelId[]
  /** `pending` (request sent, provider hasn't streamed yet) or `streaming` (chunks flowing) — both render as "busy". */
  isPending: boolean
  /** `done` AND this window hasn't marked it seen yet. */
  isFulfilled: boolean
  /** Mark the terminal indicator as consumed in this window (local only). */
  markSeen: () => void
}

export function useTopicStreamStatus(topicId: string): TopicStreamStatusView {
  const [statuses] = useSharedCache('topic.stream.statuses')
  const [seen, setSeen] = useCache(`topic.stream.seen.${topicId}` as const)

  const entry = statuses?.[topicId]
  const status = entry?.status
  const activeExecutionIds = useMemo(() => entry?.activeExecutionIds ?? [], [entry])

  const isPending = status === 'pending' || status === 'streaming'
  const isFulfilled = status === 'done' && !seen

  const markSeen = useCallback(() => {
    if (!seen) setSeen(true)
  }, [seen, setSeen])

  return { status, activeExecutionIds, isPending, isFulfilled, markSeen }
}
