import { CreateAgentSessionResponse, CreateSessionForm, GetAgentSessionResponse } from '@renderer/types'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import useSWR from 'swr'

import { useAgentClient } from './useAgentClient'

export const useSessions = (agentId: string) => {
  const { t } = useTranslation()
  const client = useAgentClient()
  const key = client.getSessionPaths(agentId).base

  const fetcher = async () => {
    const data = await client.listSessions(agentId)
    return data.data
  }
  const { data, error, isLoading, mutate } = useSWR(key, fetcher)

  const createSession = useCallback(
    async (form: CreateSessionForm): Promise<CreateAgentSessionResponse | null> => {
      try {
        const result = await client.createSession(agentId, form)
        await mutate((prev) => [result, ...(prev ?? [])], { revalidate: false })
        return result
      } catch (error) {
        window.toast.error(formatErrorMessageWithPrefix(error, t('agent.session.create.error.failed')))
        return null
      }
    },
    [agentId, client, mutate, t]
  )

  // TODO: including messages field
  const getSession = useCallback(
    async (id: string) => {
      try {
        const result = await client.getSession(agentId, id)
        mutate((prev) => prev?.map((session) => (session.id === result.id ? result : session)))
      } catch (error) {
        window.toast.error(formatErrorMessageWithPrefix(error, t('agent.session.get.error.failed')))
      }
    },
    [agentId, client, mutate, t]
  )

  const deleteSession = useCallback(
    async (id: string) => {
      if (!agentId) return false
      try {
        await client.deleteSession(agentId, id)
        mutate((prev) => prev?.filter((session) => session.id !== id))
        return true
      } catch (error) {
        window.toast.error(formatErrorMessageWithPrefix(error, t('agent.session.delete.error.failed')))
        return false
      }
    },
    [agentId, client, mutate, t]
  )

  return {
    sessions: data ?? [],
    error,
    isLoading,
    createSession,
    getSession,
    deleteSession
  }
}
