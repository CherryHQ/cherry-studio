import { cacheService } from '@renderer/data/CacheService'
import { buildAgentSessionTopicId } from '@renderer/utils/agentSession'
import { classifyTurn, type TopicStatusSnapshotEntry } from '@shared/ai/transport'
import { useCallback, useEffect, useMemo, useState } from 'react'

export type AgentSessionStreamState = {
  isPending: boolean
  status: TopicStatusSnapshotEntry['status']
}

const getAgentSessionStreamStatusCacheKey = (sessionId: string) =>
  `topic.stream.statuses.${buildAgentSessionTopicId(sessionId)}` as const
const SESSION_ID_SEPARATOR = '\u0000'

function toAgentSessionStreamState(
  entry: TopicStatusSnapshotEntry | null | undefined
): AgentSessionStreamState | undefined {
  if (!entry) return undefined

  return {
    isPending: classifyTurn(entry.status).isTurnActive,
    status: entry.status
  }
}

export function useAgentSessionStreamStatuses(
  sessionIds: readonly string[]
): ReadonlyMap<string, AgentSessionStreamState> {
  const sessionIdsKey = useMemo(() => Array.from(new Set(sessionIds)).sort().join(SESSION_ID_SEPARATOR), [sessionIds])
  const uniqueSessionIds = useMemo(
    () => (sessionIdsKey ? sessionIdsKey.split(SESSION_ID_SEPARATOR) : []),
    [sessionIdsKey]
  )
  const cacheKeys = useMemo(() => uniqueSessionIds.map(getAgentSessionStreamStatusCacheKey), [uniqueSessionIds])

  const readSnapshot = useCallback(() => {
    const statusBySessionId = new Map<string, AgentSessionStreamState>()

    for (const sessionId of uniqueSessionIds) {
      const entry = cacheService.getShared(getAgentSessionStreamStatusCacheKey(sessionId))
      const status = toAgentSessionStreamState(entry)
      if (status) statusBySessionId.set(sessionId, status)
    }

    return statusBySessionId
  }, [uniqueSessionIds])

  const [snapshot, setSnapshot] = useState<ReadonlyMap<string, AgentSessionStreamState>>(readSnapshot)

  useEffect(() => {
    setSnapshot(readSnapshot())
    const disposers = cacheKeys.map((key) => cacheService.subscribe(key, () => setSnapshot(readSnapshot())))

    return () => {
      disposers.forEach((dispose) => dispose())
    }
  }, [cacheKeys, readSnapshot])

  return snapshot
}
