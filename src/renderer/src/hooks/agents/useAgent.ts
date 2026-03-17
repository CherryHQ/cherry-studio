import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import useSWR from 'swr'

import { useApiGateway } from '../useApiGateway'
import { useAgentClient } from './useAgentClient'

export const useAgent = (id: string | null) => {
  const { t } = useTranslation()
  const client = useAgentClient()
  const key = id ? client.agentPaths.withId(id) : null
  const { apiGatewayConfig, apiGatewayRunning } = useApiGateway()

  // Disable SWR fetching when server is not running by setting key to null
  const swrKey = apiGatewayRunning && id ? key : null

  const fetcher = useCallback(async () => {
    if (!id) {
      throw new Error(t('agent.get.error.null_id'))
    }
    if (!apiGatewayConfig.enabled) {
      throw new Error(t('apiGateway.messages.notEnabled'))
    }
    const result = await client.getAgent(id)
    return result
  }, [apiGatewayConfig.enabled, client, id, t])
  const { data, error, isLoading } = useSWR(swrKey, fetcher)

  return {
    agent: data,
    error,
    isLoading
  }
}
