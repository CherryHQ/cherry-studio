import { useQuery } from '@renderer/data/hooks/useDataApi'
import type { GetAgentSessionResponse } from '@renderer/types'
import { useMemo } from 'react'

import { useUpdateSession } from './useUpdateSession'
import { parseAgentConfiguration } from './utils'

export const useSession = (agentId: string | null, sessionId: string | null) => {
  const { data, error, isLoading, mutate } = useQuery('/agents/:agentId/sessions/:sessionId', {
    params: { agentId: agentId!, sessionId: sessionId! },
    enabled: !!(agentId && sessionId),
    swrOptions: { keepPreviousData: false }
  })
  const { updateSession } = useUpdateSession(agentId)

  const session = useMemo((): GetAgentSessionResponse | undefined => {
    if (!data) return undefined
    return {
      ...(data as unknown as GetAgentSessionResponse),
      configuration: parseAgentConfiguration(data.configuration, { entityId: data.id, entityType: 'session' })
    }
  }, [data])

  return {
    session,
    error,
    isLoading,
    updateSession,
    mutate
  }
}
