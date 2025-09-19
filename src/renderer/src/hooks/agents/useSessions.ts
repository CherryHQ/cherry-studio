import { CreateSessionForm, UpdateSessionForm } from '@renderer/types'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import useSWR from 'swr'

import { useAgentClient } from './useAgentClient'

export const useSessions = (agentId: string) => {
  const { t } = useTranslation()
  const client = useAgentClient()
  const key = client.getSessionPaths(agentId).base

  const fetcher = async () => {
    if (!agentId) {
      return []
    }
    const data = await client.listSessions(agentId)
    return data.data
  }
  const { data, error, isLoading, mutate } = useSWR(key, fetcher)

  const createSession = useCallback(
    async (form: CreateSessionForm) => {
      if (!agentId) return
      try {
        const result = await client.createSession(agentId, form)
        mutate((prev) => [...(prev ?? []), result])
      } catch (error) {
        window.toast.error(t('agent.session.create.error.failed'))
      }
    },
    [agentId, client, mutate, t]
  )

  // TODO: including messages field
  const getSession = useCallback(
    async (id: string) => {
      if (!agentId) return
      const result = await client.getSession(agentId, id)
      mutate((prev) => prev?.map((session) => (session.id === result.id ? result : session)))
      return result
    },
    [agentId, client, mutate]
  )

  const deleteSession = useCallback(
    async (id: string) => {
      if (!agentId) return
      try {
        await client.deleteSession(agentId, id)
        mutate((prev) => prev?.filter((session) => session.id !== id))
      } catch (error) {
        window.toast.error(t('agent.session.delete.error.failed'))
      }
    },
    [agentId, client, mutate, t]
  )

  const updateSession = useCallback(
    async (id: string, form: UpdateSessionForm) => {
      if (!agentId) return
      try {
        const result = await client.updateSession(agentId, id, form)
        mutate((prev) => prev?.map((session) => (session.id === id ? result : session)))
      } catch (error) {
        window.toast.error(t('agent.session.update.error.failed'))
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
    deleteSession,
    updateSession
  }
}
