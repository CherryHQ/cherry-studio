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

  const createSessionMessage = useCallback(
    async (content: string) => {
      if (!agentId || !sessionId) return
      try {
        await client.createMessage(agentId, sessionId, content)
        // TODO: Can you return a created message value?
        const result = await client.getSession(agentId, sessionId)
        mutate(result)
      } catch (error) {
        window.toast.error(t('common.errors.create_message'))
      }
    },
    [agentId, sessionId, client, mutate, t]
  )

  return {
    session: data,
    messages: data?.messages ?? [],
    error,
    isLoading,
    updateSession,
    createSessionMessage
  }
}
