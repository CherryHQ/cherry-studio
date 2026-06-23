import { cacheService } from '@renderer/data/CacheService'
import { buildAgentSessionTopicId } from '@renderer/utils/agentSession'
import { classifyTurn, type TopicStatusSnapshotEntry } from '@shared/ai/transport'
import { useEffect, useMemo, useState } from 'react'

export type AgentSessionStreamState = {
  isPending: boolean
  status: TopicStatusSnapshotEntry['status']
}

const getAgentSessionStreamStatusCacheKey = (sessionId: string) =>
  `topic.stream.statuses.${buildAgentSessionTopicId(sessionId)}` as const

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
  const uniqueSessionIds = useMemo(() => Array.from(new Set(sessionIds)).sort(), [sessionIds])
  const cacheKeys = useMemo(() => uniqueSessionIds.map(getAgentSessionStreamStatusCacheKey), [uniqueSessionIds])

  const readSnapshot = () => {
    const statusBySessionId = new Map<string, AgentSessionStreamState>()

    for (const sessionId of uniqueSessionIds) {
      const entry = cacheService.getShared(getAgentSessionStreamStatusCacheKey(sessionId))
      const status = toAgentSessionStreamState(entry)
      if (status) statusBySessionId.set(sessionId, status)
    }

    return statusBySessionId
  }

  const [snapshot, setSnapshot] = useState<ReadonlyMap<string, AgentSessionStreamState>>(readSnapshot)

  useEffect(() => {
    setSnapshot(readSnapshot())
    const disposers = cacheKeys.map((key) => cacheService.subscribe(key, () => setSnapshot(readSnapshot())))

    return () => {
      disposers.forEach((dispose) => dispose())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKeys.join('|')])

  return snapshot
}
