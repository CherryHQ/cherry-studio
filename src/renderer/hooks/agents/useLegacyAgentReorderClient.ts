import { useMultiplePreferences } from '@data/hooks/usePreference'
import { useMemo } from 'react'

const API_SERVER_PREFERENCE_KEYS = {
  host: 'feature.csaas.host',
  port: 'feature.csaas.port',
  apiKey: 'feature.csaas.api_key'
} as const

const buildErrorMessage = async (response: Response, fallback: string) => {
  const text = await response.text().catch(() => '')
  return text ? `${fallback}: ${text}` : fallback
}

// TODO(v2): migrate PUT /agents/reorder and PUT /agents/:id/sessions/reorder to DataApi
// Tracked: these endpoints need DataApi handler + service, then this hook can be deleted.
export const useLegacyAgentReorderClient = () => {
  const [{ host, port, apiKey }] = useMultiplePreferences(API_SERVER_PREFERENCE_KEYS)

  return useMemo(() => {
    if (!apiKey) return null

    const baseUrl = `http://${host}:${port}/v1`
    const reorder = async (path: string, orderedIds: string[], fallback: string) => {
      const response = await fetch(`${baseUrl}${path}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'X-Api-Key': apiKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ ordered_ids: orderedIds })
      })

      if (!response.ok) {
        throw new Error(await buildErrorMessage(response, fallback))
      }
    }

    return {
      reorderAgents: (orderedIds: string[]) => reorder('/agents/reorder', orderedIds, 'Failed to reorder agents'),
      reorderSessions: (agentId: string, orderedIds: string[]) =>
        reorder(`/agents/${encodeURIComponent(agentId)}/sessions/reorder`, orderedIds, 'Failed to reorder sessions')
    }
  }, [apiKey, host, port])
}
