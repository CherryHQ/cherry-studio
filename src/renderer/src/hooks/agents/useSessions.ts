import { AgentEntity, CreateSessionForm } from '@renderer/types'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import useSWR from 'swr'

import { useAgentClient } from './useAgentClient'

export const useSessions = (agent: AgentEntity) => {
  const { t } = useTranslation()
  const client = useAgentClient()
  const key = client.agentPaths.base
  const fetcher = async () => {
    const data = await client.listSessions(agent.id)
    return data.data
  }
  const { data, error, isLoading, mutate } = useSWR(key, fetcher)

  const createSession = useCallback(
    async (form: CreateSessionForm) => {
      try {
        const result = await client.createSession(agent.id, form)
        mutate((prev) => [...(prev ?? []), result])
      } catch (error) {
        window.toast.error(t('agent.session.create.error.failed'))
      }
    },
    [agent.id, client, mutate, t]
  )

  // TODO: including messages field
  const getSession = useCallback(
    async (id: string) => {
      return data?.find((session) => session.id === id)
    },
    [data]
  )

  return {
    sessions: data ?? [],
    error,
    isLoading,
    createSession,
    getSession
  }
}
