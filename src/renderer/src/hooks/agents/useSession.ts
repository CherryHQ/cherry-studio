import { useQuery } from '@renderer/data/hooks/useDataApi'
import type { GetAgentSessionResponse } from '@renderer/types'
import { AgentConfigurationSchema } from '@renderer/types'
import { useMemo } from 'react'

import { useUpdateSession } from './useUpdateSession'

export const useSession = (agentId: string | null, sessionId: string | null) => {
  const { data, error, isLoading, mutate } = useQuery('/agents/:agentId/sessions/:sessionId', {
    params: { agentId: agentId!, sessionId: sessionId! },
    enabled: !!(agentId && sessionId)
  })
  const { updateSession } = useUpdateSession(agentId)

  const session = useMemo((): GetAgentSessionResponse | undefined => {
    if (!data) return undefined
    return {
      ...(data as unknown as GetAgentSessionResponse),
      configuration: data.configuration != null ? AgentConfigurationSchema.parse(data.configuration) : undefined
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
