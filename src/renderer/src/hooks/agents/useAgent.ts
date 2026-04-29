import { useQuery } from '@renderer/data/hooks/useDataApi'
import type { GetAgentResponse } from '@renderer/types'
import { useMemo } from 'react'

import { parseAgentConfiguration } from './utils'

export const useAgent = (id: string | null) => {
  const { data, error, isLoading, refetch } = useQuery('/agents/:agentId', {
    params: { agentId: id! },
    enabled: !!id,
    swrOptions: {
      // Agent config may be modified externally (e.g. claw MCP tool in main process),
      // so always revalidate on mount and reduce dedup window to get fresh data.
      revalidateOnMount: true,
      dedupingInterval: 2000
    }
  })

  // Apply Zod defaults to `configuration` so callers receive a fully-typed
  // AgentConfiguration (with permission_mode, max_turns, env_vars defaults)
  // rather than the raw Record<string, unknown> returned by the DataAPI.
  // Cast to GetAgentResponse for structural compatibility with settings components
  // (tools field will be undefined — callers use `?? []` fallbacks).
  const agent = useMemo((): GetAgentResponse | undefined => {
    if (!data) return undefined
    return {
      ...(data as unknown as GetAgentResponse),
      configuration: parseAgentConfiguration(data.configuration, { entityId: data.id, entityType: 'agent' })
    }
  }, [data])

  return { agent, error, isLoading, revalidate: refetch }
}
