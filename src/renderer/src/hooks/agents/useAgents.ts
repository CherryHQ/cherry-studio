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
  const fetcher = useCallback(async () => {
    const result = await client.listAgents()
    return result.agents
  }, [client])
  const { data, error, isLoading, mutate } = useSWR(key, fetcher)

  const addAgent = useCallback(
    async (form: AddAgentForm) => {
      try {
        const result = await client.createAgent(form)
        mutate((prev) => [...(prev ?? []), result])
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
        mutate((prev) => prev?.map((a) => (a.id === form.id ? result : a)) ?? [])
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
        mutate((prev) => prev?.filter((a) => a.id !== id) ?? [])
      } catch (error) {
        window.toast.error(formatErrorMessageWithPrefix(error, t('agent.delete.error.failed')))
      }
    },
    [client, mutate, t]
  )

  const getAgent = useCallback(
    (id: string) => {
      return data?.find((agent) => agent.id === id)
    },
    [data]
  )

  return {
    agents: data ?? [],
    error,
    isLoading,
    addAgent,
    updateAgent,
    deleteAgent,
    getAgent
  }
}
