import { useSharedCache, useSharedCacheValue } from '@renderer/data/hooks/useCache'
import { type ConversationRef, conversationRefKey, ConversationStatus } from '@shared/ai/conversation'
import { classifyTurn, type ConversationExecutionProjection } from '@shared/ai/transport'
import { useCallback, useEffect, useMemo, useRef } from 'react'

interface ConversationStreamStatusView {
  status: ConversationStatus | undefined
  activeExecutions: ConversationExecutionProjection[]
  awaitingInteractionExecutions: ConversationExecutionProjection[]
  isPending: boolean
  conversationBusy: boolean
  canSteer: boolean
  isFulfilled: boolean
  markSeen: () => void
}

export function useConversationStreamStatus(conversation: ConversationRef): ConversationStreamStatusView {
  const key = conversationRefKey(conversation)
  const entry = useSharedCacheValue(`conversation.statuses.${key}` as const)
  const [lastSeenCompletion, setLastSeenCompletion] = useSharedCache(
    `conversation.last_seen_completion.${key}` as const
  )
  const status = entry?.status
  const lastCompletedAt = entry?.lastCompletedAt ?? null
  const activeExecutions = useMemo(() => entry?.activeExecutions ?? [], [entry])
  const awaitingInteractionExecutions = useMemo(() => entry?.awaitingInteractionExecutions ?? [], [entry])
  const flags = classifyTurn(status)
  const isFulfilled = status === ConversationStatus.Done && lastCompletedAt !== lastSeenCompletion

  const markSeen = useCallback(() => {
    if (lastCompletedAt != null && lastCompletedAt !== lastSeenCompletion) setLastSeenCompletion(lastCompletedAt)
  }, [lastCompletedAt, lastSeenCompletion, setLastSeenCompletion])

  return {
    status,
    activeExecutions,
    awaitingInteractionExecutions,
    isPending: flags.isStreamLive,
    conversationBusy: flags.isStreamLive || flags.isAwaitingInteraction,
    canSteer: flags.isStreamLive && !flags.isAwaitingInteraction,
    isFulfilled,
    markSeen
  }
}

export function useConversationAwaitingInteraction(conversation: ConversationRef): boolean {
  const entry = useSharedCacheValue(`conversation.statuses.${conversationRefKey(conversation)}` as const)
  return classifyTurn(entry?.status).isAwaitingInteraction
}

export function useConversationDbRefreshOnAwaitingInteraction(
  conversation: ConversationRef,
  refresh: () => Promise<unknown>
): void {
  const key = conversationRefKey(conversation)
  const entry = useSharedCacheValue(`conversation.statuses.${key}` as const)
  const status = entry?.status
  const refreshRef = useRef(refresh)
  refreshRef.current = refresh
  const previousRef = useRef<{ status: typeof status; key: string } | undefined>(undefined)
  useEffect(() => {
    const previous = previousRef.current
    const previousStatus = previous?.key === key ? previous.status : undefined
    previousRef.current = { status, key }
    if (classifyTurn(previousStatus).isStreamLive && classifyTurn(status).isAwaitingInteraction) {
      void refreshRef.current().catch(() => {})
    }
  }, [key, status])
}
