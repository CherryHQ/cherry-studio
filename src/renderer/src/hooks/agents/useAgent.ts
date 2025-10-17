import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import useSWR from 'swr'

import { useApiServer } from '../useApiServer'
import { useAgentClient } from './useAgentClient'

export const useAgent = (id: string | null) => {
  const { t } = useTranslation()
  const client = useAgentClient()
  const key = id ? client.agentPaths.withId(id) : null
  const { apiServerConfig, apiServerRunning } = useApiServer()
  const fetcher = useCallback(async () => {
    if (!id || id === 'fake') {
      return null
    }
    if (!apiServerConfig.enabled) {
      throw new Error(t('apiServer.messages.notEnabled'))
    }
    if (!apiServerRunning) {
      throw new Error(t('agent.server.error.not_running'))
    }
    const result = await client.getAgent(id)
    return result
  }, [apiServerConfig.enabled, apiServerRunning, client, id, t])
  const { data, error, isLoading } = useSWR(key, id ? fetcher : null)

  return {
    agent: data,
    error,
    isLoading
  }
}
