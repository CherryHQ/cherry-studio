import { useCallback } from 'react'
import useSWR from 'swr'

import { useAgentClient } from './useAgentClient'

export const useAgent = (id: string | null) => {
  const client = useAgentClient()
  const key = id ? client.agentPaths.withId(id) : null
  const fetcher = useCallback(async () => {
    if (!id || id === 'fake') {
      return null
    }
    const result = await client.getAgent(id)
    return result
  }, [client, id])
  const { data, error, isLoading } = useSWR(key, id ? fetcher : null)

  return {
    agent: data,
    error,
    isLoading
  }
}
