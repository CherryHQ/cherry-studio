// Per-topic stream state. Main owns the shared status entry (incl.
// `lastCompletedAt`); the "last completion this window has acknowledged"
// marker is a separate cross-window shared cache key.

import { useSharedCache } from '@renderer/data/hooks/useCache'
import { type ActiveExecution, classifyTurn, type TopicStreamStatus } from '@shared/ai/transport'
import { useCallback, useEffect, useMemo, useRef } from 'react'

interface TopicStreamStatusView {
  status: TopicStreamStatus | undefined
  activeExecutions: ActiveExecution[]
  /**
   * Survives the exec's own terminal status — MCP `needsApproval` ends the
   * stream via `done` while still awaiting. Single cross-window authority
   * for "which message is the approval anchor".
   */
  awaitingApprovalAnchors: ActiveExecution[]
  isPending: boolean
  /**
   * `done` AND this window's `lastSeenCompletion` does not match the
   * authoritative `lastCompletedAt`. Read-receipt model: per-completion
   * identity rather than a sticky 1-bit "ever seen" gate.
   */
  isFulfilled: boolean
  markSeen: () => void
}

export function useTopicStreamStatus(topicId: string): TopicStreamStatusView {
  const [entry] = useSharedCache(`topic.stream.statuses.${topicId}` as const)
  const [lastSeenCompletion, setLastSeenCompletion] = useSharedCache(
    `topic.stream.last_seen_completion.${topicId}` as const
  )

  const status = entry?.status
  const lastCompletedAt = entry?.lastCompletedAt ?? null
  const activeExecutions = useMemo(() => entry?.activeExecutions ?? [], [entry])
  const awaitingApprovalAnchors = useMemo(() => entry?.awaitingApprovalAnchors ?? [], [entry])

  const flags = classifyTurn(status)
  const isPending = flags.isStreamLive
  const isFulfilled = status === 'done' && lastCompletedAt !== lastSeenCompletion

  const markSeen = useCallback(() => {
    if (lastCompletedAt != null && lastCompletedAt !== lastSeenCompletion) {
      setLastSeenCompletion(lastCompletedAt)
    }
  }, [lastCompletedAt, lastSeenCompletion, setLastSeenCompletion])

  return { status, activeExecutions, awaitingApprovalAnchors, isPending, isFulfilled, markSeen }
}

export function useTopicAwaitingApproval(topicId: string): boolean {
  const [entry] = useSharedCache(`topic.stream.statuses.${topicId}` as const)
  return classifyTurn(entry?.status).isAwaitingApproval
}

// Fire `refresh` once per live→terminal transition. Gate is `classifyTurn`-driven
// so new TopicStreamStatus values participate by construction.
export function useTopicDbRefreshOnTerminal(topicId: string, refresh: () => Promise<unknown>): void {
  const [entry] = useSharedCache(`topic.stream.statuses.${topicId}` as const)
  const status = entry?.status
  const refreshRef = useRef(refresh)
  refreshRef.current = refresh
  const prevRef = useRef<typeof status>(undefined)
  useEffect(() => {
    const prev = prevRef.current
    prevRef.current = status
    if (classifyTurn(prev).isStreamLive && classifyTurn(status).isTerminal) {
      void refreshRef.current().catch(() => {
        // Caller logs; the invalidation signal must not throw out of the effect.
      })
    }
  }, [status])
}
