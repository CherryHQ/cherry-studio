import { useSharedCacheValue } from '@renderer/data/hooks/useCache'
import { useDataChange, useQuery } from '@renderer/data/hooks/useDataApi'
import { AGENT_SESSION_COST_CACHE_KEY } from '@shared/ai/agentSessionCost'

export function useAgentSessionCost(sessionId: string | undefined) {
  const live = useSharedCacheValue(AGENT_SESSION_COST_CACHE_KEY(sessionId ?? '__none__'))
  const { data: saved, mutate } = useQuery('/agent-sessions/:sessionId/cost', {
    params: { sessionId: sessionId! },
    enabled: Boolean(sessionId),
    swrOptions: { keepPreviousData: false }
  })
  useDataChange(
    '/agent-sessions/:sessionId/cost',
    () => {
      if (sessionId) void mutate()
    },
    { routeParams: { sessionId: sessionId ?? '' } }
  )
  return sessionId ? ((live ?? saved)?.cost ?? null) : null
}
