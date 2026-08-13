// Per-topic stream state. Main owns the shared status entry (incl.
// `lastCompletedAt`); the "last completion this window has acknowledged"
// marker is a separate cross-window shared cache key.

import { useSharedCache, useSharedCacheValue } from '@renderer/data/hooks/useCache'
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
  /** Single Main-derived busy selector shared by chat and agent composers. */
  topicBusy: boolean
  canSteer: boolean
  /**
   * `done` AND this window's `lastSeenCompletion` does not match the
   * authoritative `lastCompletedAt`. Read-receipt model: per-completion
   * identity rather than a sticky 1-bit "ever seen" gate.
   */
  isFulfilled: boolean
  markSeen: () => void
}

export function useTopicStreamStatus(topicId: string): TopicStreamStatusView {
  // Main-owned status entry: read-only observation (consumers below all accept
  // `undefined` via optional chaining, so no local fallback is needed).
  // `lastSeenCompletion` stays on the writable hook — this window OWNS the
  // read-receipt marker and writes it via markSeen.
  const entry = useSharedCacheValue(`topic.stream.statuses.${topicId}` as const)
  const [lastSeenCompletion, setLastSeenCompletion] = useSharedCache(
    `topic.stream.last_seen_completion.${topicId}` as const
  )

  const status = entry?.status
  const lastCompletedAt = entry?.lastCompletedAt ?? null
  const activeExecutions = useMemo(() => entry?.activeExecutions ?? [], [entry])
  const awaitingApprovalAnchors = useMemo(() => entry?.awaitingApprovalAnchors ?? [], [entry])

  const flags = classifyTurn(status)
  const isPending = flags.isStreamLive
  const topicBusy = flags.isStreamLive || flags.isAwaitingApproval
  const canSteer = flags.isStreamLive && !flags.isAwaitingApproval
  const isFulfilled = status === 'done' && lastCompletedAt !== lastSeenCompletion

  const markSeen = useCallback(() => {
    if (lastCompletedAt != null && lastCompletedAt !== lastSeenCompletion) {
      setLastSeenCompletion(lastCompletedAt)
    }
  }, [lastCompletedAt, lastSeenCompletion, setLastSeenCompletion])

  return { status, activeExecutions, awaitingApprovalAnchors, isPending, topicBusy, canSteer, isFulfilled, markSeen }
}

export function useTopicAwaitingApproval(topicId: string): boolean {
  const entry = useSharedCacheValue(`topic.stream.statuses.${topicId}` as const)
  return classifyTurn(entry?.status).isAwaitingApproval
}

// Fire `refresh` once when a live turn pauses for approval. The final
// done/error/aborted handoff is owned by the page-level overlay handoff so it
// can refresh before dropping live overlay parts.
export function useTopicDbRefreshOnAwaitingApproval(topicId: string, refresh: () => Promise<unknown>): void {
  const entry = useSharedCacheValue(`topic.stream.statuses.${topicId}` as const)
  const status = entry?.status
  const refreshRef = useRef(refresh)
  refreshRef.current = refresh
  const prevRef = useRef<{ status: typeof status; topicId: string } | undefined>(undefined)
  useEffect(() => {
    const previous = prevRef.current
    const prev = previous?.topicId === topicId ? previous.status : undefined
    prevRef.current = { status, topicId }
    if (classifyTurn(prev).isStreamLive && classifyTurn(status).isAwaitingApproval) {
      void refreshRef.current().catch(() => {
        // Caller logs; the invalidation signal must not throw out of the effect.
      })
    }
  }, [status, topicId])
}
