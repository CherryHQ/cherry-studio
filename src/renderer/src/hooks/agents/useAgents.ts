import { AddAgentForm } from '@renderer/types'
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
    // NOTE: We only use the array for now. useUpdateAgent depends on this behavior.
    return result.data
  }, [client])
  const { data, error, isLoading, mutate } = useSWR(key, fetcher)

  const addAgent = useCallback(
    async (form: AddAgentForm) => {
      try {
        const result = await client.createAgent(form)
        mutate((prev) => [...(prev ?? []), result])
        window.toast.success(t('common.add_success'))
      } catch (error) {
        window.toast.error(formatErrorMessageWithPrefix(error, t('agent.add.error.failed')))
      }
    },
    [client, mutate, t]
  )

  const deleteAgent = useCallback(
    async (id: string) => {
      try {
        await client.deleteAgent(id)
        mutate((prev) => prev?.filter((a) => a.id !== id) ?? [])
        window.toast.success(t('common.delete_success'))
      } catch (error) {
        window.toast.error(formatErrorMessageWithPrefix(error, t('agent.delete.error.failed')))
      }
    },
    [client, mutate, t]
  )

  const getAgent = useCallback(
    async (id: string) => {
      const result = await client.getAgent(id)
      mutate((prev) => prev?.map((a) => (a.id === result.id ? result : a)) ?? [])
    },
    [client, mutate]
  )

  return {
    agents: data ?? [],
    error,
    isLoading,
    addAgent,
    deleteAgent,
    getAgent
  }
}
