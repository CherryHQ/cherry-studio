import useSWR from 'swr'

import { useAgentClient } from './useAgentClient'

export const useAgents = () => {
  const client = useAgentClient()
  const key = client.agentPaths.base
  const { data: agents, error, isLoading } = useSWR(key, () => client.listAgents())

  return {
    agents,
    error,
    isLoading
  }
}
