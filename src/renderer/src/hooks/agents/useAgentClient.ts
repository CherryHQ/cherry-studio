import { AgentApiClient } from '@renderer/api/agent'

import { useSettings } from '../useSettings'

export const useAgentClient = () => {
  const { apiServer } = useSettings()
  const { host, port, apiKey } = apiServer
  const client = new AgentApiClient({
    baseURL: `http://${host}:${port}`,
    headers: {
      Authorization: `Bearer ${apiKey}`
    }
  })
  return client
}
