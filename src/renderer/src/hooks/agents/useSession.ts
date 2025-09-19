import { UpdateSessionForm } from '@renderer/types'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import useSWR from 'swr'

import { useAgentClient } from './useAgentClient'

export const useSession = (agentId: string, sessionId: string) => {
  const { t } = useTranslation()
  const client = useAgentClient()
  const key = client.getSessionPaths(agentId).withId(sessionId)

  const fetcher = async () => {
    const data = await client.getSession(agentId, sessionId)
    return data
  }
  const { data, error, isLoading, mutate } = useSWR(key, fetcher)

  const updateSession = useCallback(
    async (form: UpdateSessionForm) => {
      if (!agentId) return
      try {
        const result = await client.updateSession(agentId, form)
        mutate(result)
      } catch (error) {
        window.toast.error(t('agent.session.update.error.failed'))
      }
    },
    [agentId, client, mutate, t]
  )

  return {
    session: data,
    messages: data?.messages,
    error,
    isLoading,
    updateSession
  }
}
