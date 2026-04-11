import { useTranslation } from 'react-i18next'
import useSWR from 'swr'

import { requireAgentClient, useAgentClient } from './useAgentClient'
import { useUpdateSession } from './useUpdateSession'

export const useSession = (agentId: string | null, sessionId: string | null) => {
  const { t } = useTranslation()
  const client = useAgentClient()
  const key = agentId && sessionId && client ? client.getSessionPaths(agentId).withId(sessionId) : null
  const { updateSession } = useUpdateSession(agentId)

  const fetcher = async () => {
    if (!agentId) throw new Error(t('agent.get.error.null_id'))
    if (!sessionId) throw new Error(t('agent.session.get.error.null_id'))
    const data = await requireAgentClient(client).getSession(agentId, sessionId)
    return data
  }
  const { data, error, isLoading, mutate } = useSWR(key, fetcher)

  return {
    session: data,
    error,
    isLoading,
    updateSession,
    mutate
  }
}
