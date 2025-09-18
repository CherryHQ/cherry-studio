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
  const { data, error, isLoading, mutate } = useSWR(key, () => client.listAgents())

  const addAgent = useCallback(
    async (agent: AddAgentForm) => {
      try {
        const result = await client.createAgent(agent)
        mutate((prev) => ({ agents: [...(prev?.agents ?? []), result], total: 0 }))
      } catch (error) {
        window.toast.error(formatErrorMessageWithPrefix(error, t('agent.add.error.failed')))
      }
    },
    [client, mutate, t]
  )

  return {
    agents: data?.agents ?? [],
    error,
    isLoading,
    addAgent
  }
}
