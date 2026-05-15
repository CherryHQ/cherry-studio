import { cacheService } from '@data/CacheService'
import { buildAgentSessionTopicId } from '@renderer/utils/agentSession'
import type { TopicStreamStatus } from '@shared/ai/transport'
import { useCallback, useRef, useSyncExternalStore } from 'react'

export type AgentSessionStreamState = {
  isFulfilled: boolean
  isPending: boolean
  status?: TopicStreamStatus
}

type AgentSessionStreamStatusSnapshot = {
  signature: string
  value: ReadonlyMap<string, AgentSessionStreamState>
}

export const EMPTY_AGENT_SESSION_STREAM_STATE: AgentSessionStreamState = Object.freeze({
  isFulfilled: false,
  isPending: false
})

const EMPTY_AGENT_SESSION_STREAM_STATUS_MAP: ReadonlyMap<string, AgentSessionStreamState> = new Map()

const getTopicStreamStatusCacheKey = (topicId: string) => `topic.stream.statuses.${topicId}` as const

const getTopicStreamSeenCacheKey = (topicId: string) => `topic.stream.seen.${topicId}` as const

export const getAgentSessionStreamSeenCacheKey = (sessionId: string) => {
  return getTopicStreamSeenCacheKey(buildAgentSessionTopicId(sessionId))
}

const getAgentSessionStreamStatusCacheKey = (sessionId: string) => {
  return getTopicStreamStatusCacheKey(buildAgentSessionTopicId(sessionId))
}

const buildAgentSessionStreamStatusSnapshot = (sessionIds: readonly string[]): AgentSessionStreamStatusSnapshot => {
  if (sessionIds.length === 0) {
    return {
      signature: '',
      value: EMPTY_AGENT_SESSION_STREAM_STATUS_MAP
    }
  }

  const value = new Map<string, AgentSessionStreamState>()
  const signatureParts: string[] = []

  for (const sessionId of sessionIds) {
    const statusEntry = cacheService.getShared(getAgentSessionStreamStatusCacheKey(sessionId))
    const seen = cacheService.get(getAgentSessionStreamSeenCacheKey(sessionId)) ?? false
    const status = statusEntry?.status
    const streamStatus = {
      status,
      isFulfilled: status === 'done' && !seen,
      isPending: status === 'pending' || status === 'streaming'
    }

    signatureParts.push(
      `${sessionId}:${status ?? ''}:${seen ? 1 : 0}:${streamStatus.isPending ? 1 : 0}:${streamStatus.isFulfilled ? 1 : 0}`
    )

    if (streamStatus.isPending || streamStatus.isFulfilled || status === 'error') {
      value.set(sessionId, streamStatus)
    }
  }

  return {
    signature: signatureParts.join('|'),
    value: value.size > 0 ? value : EMPTY_AGENT_SESSION_STREAM_STATUS_MAP
  }
}

const subscribeAgentSessionStreamStatuses = (
  sessionIds: readonly string[],
  onStoreChange: () => void
): (() => void) => {
  if (sessionIds.length === 0) {
    return () => undefined
  }

  const unsubscribes: Array<() => void> = []

  for (const sessionId of new Set(sessionIds)) {
    unsubscribes.push(cacheService.subscribe(getAgentSessionStreamStatusCacheKey(sessionId), onStoreChange))
    unsubscribes.push(cacheService.subscribe(getAgentSessionStreamSeenCacheKey(sessionId), onStoreChange))
  }

  return () => {
    for (const unsubscribe of unsubscribes) {
      unsubscribe()
    }
  }
}

export const useAgentSessionStreamStatuses = (
  sessionIds: readonly string[]
): ReadonlyMap<string, AgentSessionStreamState> => {
  const snapshotRef = useRef<AgentSessionStreamStatusSnapshot>({
    signature: '',
    value: EMPTY_AGENT_SESSION_STREAM_STATUS_MAP
  })

  const getSnapshot = useCallback(() => {
    const nextSnapshot = buildAgentSessionStreamStatusSnapshot(sessionIds)

    if (snapshotRef.current.signature === nextSnapshot.signature) {
      return snapshotRef.current.value
    }

    snapshotRef.current = nextSnapshot
    return nextSnapshot.value
  }, [sessionIds])

  const subscribe = useCallback(
    (onStoreChange: () => void) => subscribeAgentSessionStreamStatuses(sessionIds, onStoreChange),
    [sessionIds]
  )

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
