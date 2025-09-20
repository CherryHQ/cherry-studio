import { ListAgentsResponse, UpdateAgentForm } from '@renderer/types'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { mutate } from 'swr'

import { useAgentClient } from './useAgentClient'

export const useUpdateAgent = () => {
  const { t } = useTranslation()
  const client = useAgentClient()
  const listKey = client.agentPaths.base

  const updateAgent = useCallback(
    async (form: UpdateAgentForm) => {
      try {
        const itemKey = client.agentPaths.withId(form.id)
        // may change to optimistic update
        const result = await client.updateAgent(form)
        mutate<ListAgentsResponse['data']>(listKey, (prev) => prev?.map((a) => (a.id === result.id ? result : a)) ?? [])
        mutate(itemKey, result)
        window.toast.success(t('common.update_success'))
      } catch (error) {
        window.toast.error(formatErrorMessageWithPrefix(error, t('agent.update.error.failed')))
      }
    },
    [client, listKey, t]
  )

  return updateAgent
}
