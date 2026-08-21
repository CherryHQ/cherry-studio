import { useSharedCacheSelector } from '@renderer/data/hooks/useCache'
import { ConversationKind, conversationRefKey } from '@shared/ai/conversation'
import { classifyTurn, type ConversationStatusSnapshotEntry } from '@shared/ai/transport'
import { useCallback, useMemo } from 'react'

export type AgentSessionStreamState = {
  isPending: boolean
  status: ConversationStatusSnapshotEntry['status']
}

const getAgentSessionStreamStatusCacheKey = (sessionId: string) =>
  `conversation.statuses.${conversationRefKey({ kind: ConversationKind.Agent, id: sessionId })}` as const
const SESSION_ID_SEPARATOR = '\u0000'
const EMPTY_AGENT_SESSION_STREAM_STATUSES = new Map<string, AgentSessionStreamState>()

function toAgentSessionStreamState(
  entry: ConversationStatusSnapshotEntry | null | undefined
): AgentSessionStreamState | undefined {
  if (!entry) return undefined

  return {
    isPending: classifyTurn(entry.status).isTurnActive,
    status: entry.status
  }
}

/**
 * Selection comparator: the Map and its entry objects are rebuilt on every
 * selector run, so identity comparison never holds — compare by the fields
 * consumers derive from (session id, status, isPending).
 */
function areAgentSessionStreamStatusesEqual(
  a: ReadonlyMap<string, AgentSessionStreamState>,
  b: ReadonlyMap<string, AgentSessionStreamState>
): boolean {
  if (a === b) return true
  if (a.size !== b.size) return false
  for (const [sessionId, state] of a) {
    const other = b.get(sessionId)
    if (!other || other.status !== state.status || other.isPending !== state.isPending) return false
  }
  return true
}

export function useAgentSessionStreamStatuses(
  sessionIds: readonly string[]
): ReadonlyMap<string, AgentSessionStreamState> {
  const sessionIdsKey = useMemo(() => Array.from(new Set(sessionIds)).sort().join(SESSION_ID_SEPARATOR), [sessionIds])
  const uniqueSessionIds = useMemo(
    () => (sessionIdsKey ? sessionIdsKey.split(SESSION_ID_SEPARATOR) : []),
    [sessionIdsKey]
  )
  const selector = useCallback(
    (values: readonly (ConversationStatusSnapshotEntry | null | undefined)[]) => {
      const entries: Array<[string, AgentSessionStreamState]> = []
      uniqueSessionIds.forEach((sessionId, index) => {
        const state = toAgentSessionStreamState(values[index])
        if (state) entries.push([sessionId, state])
      })

      if (entries.length === 0) return EMPTY_AGENT_SESSION_STREAM_STATUSES
      return new Map(entries) as ReadonlyMap<string, AgentSessionStreamState>
    },
    [uniqueSessionIds]
  )

  // Keys and the zip source both derive from `uniqueSessionIds` (zip-source coherence).
  return useSharedCacheSelector(
    uniqueSessionIds.map(getAgentSessionStreamStatusCacheKey),
    selector,
    areAgentSessionStreamStatusesEqual
  )
}
