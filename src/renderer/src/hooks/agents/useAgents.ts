import useSWR from 'swr'

import { useAgentClient } from './useAgentClient'

export const useAgents = () => {
  const client = useAgentClient()
  const key = client.agentPaths.base
  const { data, error, isLoading } = useSWR(key, () => client.listAgents())

  return {
    agents: data?.agents ?? [],
    error,
    isLoading
  }
}
