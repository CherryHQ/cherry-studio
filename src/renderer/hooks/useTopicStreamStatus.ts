// Per-topic stream state. Main owns the shared status entry (incl.
// `lastCompletedAt`); the "last completion this window has acknowledged"
// marker is a separate cross-window shared cache key.

import { loggerService } from '@logger'
import { useSharedCache } from '@renderer/data/hooks/useCache'
import { type ActiveExecution, classifyTurn, type TopicStreamStatus } from '@shared/ai/transport'
import { useCallback, useEffect, useMemo, useRef } from 'react'

const logger = loggerService.withContext('useTopicStreamStatus')

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

/**
 * Deterministic overlay→DB handoff at terminal. On the live→terminal edge the
 * live chunk overlay must yield to the DB row (which persistence already
 * finalized — e.g. an interrupted tool becomes `output-error`). The overlay's
 * own `onFinish` is suppressed when an execution leaves `activeExecutions`, so
 * disposal can't ride it; this fires `onHandoff` (refresh-then-dispose) off the
 * status edge instead.
 *
 * Excludes `awaiting-approval` (which is `isTerminal` but must KEEP the live
 * card — a continue stream will resume it). That distinction lives only here in
 * `classifyTurn`, not inside the status-agnostic overlay hook — hence the
 * handoff is decided at the consumer layer, separate from
 * `useTopicDbRefreshOnTerminal` (whose refresh-on-awaiting-approval is wanted).
 */
export function useTopicOverlayHandoffOnTerminal(topicId: string, onHandoff: () => Promise<void> | void): void {
  const [entry] = useSharedCache(`topic.stream.statuses.${topicId}` as const)
  const status = entry?.status
  const onHandoffRef = useRef(onHandoff)
  onHandoffRef.current = onHandoff
  const prevRef = useRef<typeof status>(undefined)
  useEffect(() => {
    const prev = prevRef.current
    prevRef.current = status
    const next = classifyTurn(status)
    if (classifyTurn(prev).isStreamLive && next.isTerminal && !next.isAwaitingApproval) {
      void (async () => {
        await onHandoffRef.current()
      })().catch((error) => {
        logger.warn('Topic overlay handoff failed', error as Error, { topicId })
      })
    }
  }, [status, topicId])
}
