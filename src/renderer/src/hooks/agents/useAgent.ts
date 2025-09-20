import { UpdateAgentForm } from '@renderer/types'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import useSWR from 'swr'

import { useAgentClient } from './useAgentClient'

export const useAgent = (id: string | null) => {
  const { t } = useTranslation()
  const client = useAgentClient()
  const key = id ? client.agentPaths.withId(id) : null
  const fetcher = useCallback(async () => {
    if (!id) {
      return null
    }
    const result = await client.getAgent(id)
    return result
  }, [client, id])
  const { data, error, isLoading, mutate } = useSWR(key, id ? fetcher : null)

  const updateAgent = useCallback(
    async (form: UpdateAgentForm) => {
      try {
        // may change to optimistic update
        const result = await client.updateAgent(form)
        mutate(result)
        window.toast.success(t('common.update_success'))
      } catch (error) {
        window.toast.error(formatErrorMessageWithPrefix(error, t('agent.update.error.failed')))
      }
    },
    [client, mutate, t]
  )

  return {
    agent: data,
    error,
    isLoading,
    updateAgent
  }
}
