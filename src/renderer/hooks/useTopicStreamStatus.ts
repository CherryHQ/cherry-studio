// Per-topic stream state. Main owns the shared status entry (incl.
// `lastCompletedAt`); the "last completion this window has acknowledged"
// marker is a separate cross-window shared cache key.

import { useCallback, useEffect, useMemo, useRef } from 'react'

import { loggerService } from '@logger'
import { cacheService } from '@renderer/data/CacheService'
import { useSharedCacheSelector } from '@renderer/data/hooks/useCache'
import { type ActiveExecution, classifyTurn, type TopicStreamStatus } from '@shared/ai/transport'
import { topicLastSeenCompletionCacheKey, topicStreamStatusCacheKey } from '@shared/data/cache/cacheKey'
import type { CherryUIMessage } from '@shared/data/types/message'

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
  lastCompletedAt: number | null
  /**
   * `done` AND this window's `lastSeenCompletion` does not match the
   * authoritative `lastCompletedAt`. Read-receipt model: per-completion
   * identity rather than a sticky 1-bit "ever seen" gate.
   */
  isFulfilled: boolean
  markSeen: () => void
}

export function useTopicStreamStatus(topicId: string): TopicStreamStatusView {
  const [entry, lastSeenCompletion] = useSharedCacheSelector(
    topicId ? ([topicStreamStatusCacheKey(topicId), topicLastSeenCompletionCacheKey(topicId)] as const) : ([] as const),
    ([status, seen]) => [status, seen ?? null] as const
  )

  const status = entry?.status
  const lastCompletedAt = entry?.lastCompletedAt ?? null
  const activeExecutions = useMemo(() => entry?.activeExecutions ?? [], [entry])
  const awaitingApprovalAnchors = useMemo(() => entry?.awaitingApprovalAnchors ?? [], [entry])

  const flags = classifyTurn(status)
  const isPending = flags.isStreamLive
  const isFulfilled = status === 'done' && lastCompletedAt !== lastSeenCompletion

  const markSeen = useCallback(() => {
    if (topicId && lastCompletedAt != null && lastCompletedAt !== lastSeenCompletion) {
      cacheService.setShared(topicLastSeenCompletionCacheKey(topicId), lastCompletedAt)
    }
  }, [lastCompletedAt, lastSeenCompletion, topicId])

  return { status, activeExecutions, awaitingApprovalAnchors, isPending, lastCompletedAt, isFulfilled, markSeen }
}

function useTopicStatusEntry(topicId: string) {
  return useSharedCacheSelector(topicId ? [topicStreamStatusCacheKey(topicId)] : [], ([entry]) => entry)
}

export function useTopicAwaitingApproval(topicId: string): boolean {
  const entry = useTopicStatusEntry(topicId)

  return classifyTurn(entry?.status).isAwaitingApproval
}

// Fire `refresh` once when a live turn pauses for approval. The final
// done/error/aborted handoff is owned by the page-level overlay handoff so it
// can refresh before dropping live overlay parts.
export function useTopicDbRefreshOnAwaitingApproval<TResult>(topicId: string, refresh: () => Promise<TResult>): void {
  const entry = useTopicStatusEntry(topicId)
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

/**
 * Refresh history before disposing settled overlays, including terminal baselines on attachment.
 * Approval cards stay live; the overlay reset preserves active attempts and unresolved writes.
 */
export function useTopicOverlayHandoffOnTerminal(
  topicId: string,
  onHandoff: () => Promise<void> | void,
  liveAssistants: readonly CherryUIMessage[] = []
): void {
  const entry = useTopicStatusEntry(topicId)
  const status = entry?.status
  const onHandoffRef = useRef(onHandoff)
  onHandoffRef.current = onHandoff
  const prevRef = useRef<{ status: typeof status; topicId: string } | undefined>(undefined)
  useEffect(() => {
    const previous = prevRef.current
    const prev = previous?.topicId === topicId ? previous.status : undefined
    prevRef.current = { status, topicId }
    const next = classifyTurn(status)

    if ((classifyTurn(prev).isStreamLive || liveAssistants.length > 0) && next.isTerminal && !next.isAwaitingApproval) {
      void (async () => {
        await onHandoffRef.current()
      })().catch((error) => {
        logger.warn('Topic overlay handoff failed', error, { topicId })
      })
    }
  }, [liveAssistants, status, topicId])
}
