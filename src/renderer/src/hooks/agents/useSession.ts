import { useQuery } from '@renderer/data/hooks/useDataApi'
import type { GetAgentSessionResponse } from '@renderer/types'

import { useUpdateSession } from './useUpdateSession'

export const useSession = (agentId: string | null, sessionId: string | null) => {
  const { updateSession } = useUpdateSession(agentId)
  const path: `/agents/${string}/sessions/${string}` = `/agents/${agentId ?? '__pending__'}/sessions/${sessionId ?? '__pending__'}`
  const { data, error, isLoading, refetch } = useQuery(path, {
    enabled: !!agentId && !!sessionId
  })

  return {
    session: data as GetAgentSessionResponse | undefined,
    error: error ?? null,
    isLoading,
    updateSession,
    mutate: refetch
  }
}
