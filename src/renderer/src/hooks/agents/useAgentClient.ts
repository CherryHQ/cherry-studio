import { loggerService } from '@logger'
import { AgentApiClient } from '@renderer/api/agent'

import { useSettings } from '../useSettings'

const logger = loggerService.withContext('useAgentClient')

export const useAgentClient = () => {
  const { apiServer } = useSettings()

  if (!apiServer.enabled) {
    logger.debug('Agent API server is disabled, returning null client')
    return null
  }

  const { host, port, apiKey } = apiServer

  if (!apiKey) {
    logger.warn('Agent API server is enabled but API key is missing, returning null client')
    return null
  }

  const client = new AgentApiClient({
    baseURL: `http://${host}:${port}`,
    headers: {
      Authorization: `Bearer ${apiKey}`
    }
  })
  return client
}
