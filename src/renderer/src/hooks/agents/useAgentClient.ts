import { useMultiplePreferences } from '@data/hooks/usePreference'
import { preferenceService } from '@data/PreferenceService'
import { AgentApiClient } from '@renderer/api/agent'
import { useMemo } from 'react'

const API_SERVER_PREFERENCE_KEYS = {
  host: 'feature.csaas.host',
  port: 'feature.csaas.port',
  apiKey: 'feature.csaas.api_key'
} as const

export const AGENT_API_CLIENT_UNAVAILABLE_ERROR = 'Agent API client unavailable'

export function requireAgentClient(client: AgentApiClient | null): AgentApiClient {
  if (!client) {
    throw new Error(AGENT_API_CLIENT_UNAVAILABLE_ERROR)
  }

  return client
}

export const useAgentClient = () => {
  const { host, port, apiKey } = useMultiplePreferences(API_SERVER_PREFERENCE_KEYS)[0]

  return useMemo(() => {
    const isConfigLoaded = Object.values(API_SERVER_PREFERENCE_KEYS).every((key) => preferenceService.isCached(key))

    if (!isConfigLoaded || !apiKey) {
      return null
    }

    return new AgentApiClient({
      baseURL: `http://${host}:${port}`,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'X-Api-Key': apiKey
      }
    })
  }, [host, port, apiKey])
}
