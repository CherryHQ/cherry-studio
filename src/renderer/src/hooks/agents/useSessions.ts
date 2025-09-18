import { AgentEntity } from '@renderer/types'
import useSWR from 'swr'

import { useAgentClient } from './useAgentClient'

export const useSessions = (agent: AgentEntity) => {
  const client = useAgentClient()
  const key = client.agentPaths.base
  const fetcher = async () => {
    const data = await client.listSessions(agent.id)
    return data.data
  }
  const { data, error, isLoading } = useSWR(key, fetcher)

  return {
    sessions: data ?? [],
    error,
    isLoading
  }
}
