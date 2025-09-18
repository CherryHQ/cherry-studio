import { AddAgentForm, UpdateAgentForm } from '@renderer/types'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import useSWR from 'swr'

import { useAgentClient } from './useAgentClient'

export const useAgents = () => {
  const { t } = useTranslation()
  const client = useAgentClient()
  const key = client.agentPaths.base
  const { data, error, isLoading, mutate } = useSWR(key, () => client.listAgents())

  const addAgent = useCallback(
    async (form: AddAgentForm) => {
      try {
        const result = await client.createAgent(form)
        mutate((prev) => ({ agents: [...(prev?.agents ?? []), result], total: prev ? prev.total + 1 : 1 }))
      } catch (error) {
        window.toast.error(formatErrorMessageWithPrefix(error, t('agent.add.error.failed')))
      }
    },
    [client, mutate, t]
  )

  const updateAgent = useCallback(
    async (form: UpdateAgentForm) => {
      try {
        // may change to optimistic update
        const result = await client.updateAgent(form)
        mutate((prev) => ({
          agents: prev?.agents.map((a) => (a.id === form.id ? result : a)) ?? [],
          total: prev?.total ?? 0
        }))
      } catch (error) {
        window.toast.error(formatErrorMessageWithPrefix(error, t('agent.update.error.failed')))
      }
    },
    [client, mutate, t]
  )

  const deleteAgent = useCallback(
    async (id: string) => {
      try {
        await client.deleteAgent(id)
        mutate((prev) => ({
          agents: prev?.agents.filter((a) => a.id !== id) ?? [],
          total: prev ? prev.total - 1 : 0
        }))
      } catch (error) {
        window.toast.error(formatErrorMessageWithPrefix(error, t('agent.delete.error.failed')))
      }
    },
    [client, mutate, t]
  )

  const getAgent = useCallback(
    (id: string) => {
      return data?.agents.find((agent) => agent.id === id)
    },
    [data?.agents]
  )

  return {
    agents: data?.agents ?? [],
    error,
    isLoading,
    addAgent,
    updateAgent,
    deleteAgent,
    getAgent
  }
}
