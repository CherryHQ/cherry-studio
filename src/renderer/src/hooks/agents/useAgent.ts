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

  // Disable SWR fetching when server is not running by setting key to null
  const swrKey = apiServerRunning && id ? key : null

  const fetcher = useCallback(async () => {
    if (!id) {
      throw new Error(t('agent.get.error.null_id'))
    }
    if (!apiServerConfig.enabled) {
      throw new Error(t('apiServer.messages.notEnabled'))
    }
    const result = await client.getAgent(id)
    return result
  }, [apiServerConfig.enabled, client, id, t])
  const { data, error, isLoading } = useSWR(swrKey, fetcher)

  return {
    agent: data,
    error,
    isLoading
  }
}
