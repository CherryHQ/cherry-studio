import { ListAgentsResponse, UpdateAgentForm } from '@renderer/types'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { mutate } from 'swr'

import { useAgentClient } from './useAgentClient'

export type UpdateAgentOptions = {
  /** Whether to show success toast after updating. Defaults to true. */
  showSuccessToast?: boolean
}

export const useUpdateAgent = () => {
  const { t } = useTranslation()
  const client = useAgentClient()
  const listKey = client.agentPaths.base

  const updateAgent = useCallback(
    async (form: UpdateAgentForm, options?: UpdateAgentOptions) => {
      try {
        const itemKey = client.agentPaths.withId(form.id)
        // may change to optimistic update
        const result = await client.updateAgent(form)
        mutate<ListAgentsResponse['data']>(listKey, (prev) => prev?.map((a) => (a.id === result.id ? result : a)) ?? [])
        mutate(itemKey, result)
        if (options?.showSuccessToast ?? true) {
          window.toast.success(t('common.update_success'))
        }
      } catch (error) {
        window.toast.error(formatErrorMessageWithPrefix(error, t('agent.update.error.failed')))
      }
    },
    [client, listKey, t]
  )

  const updateModel = useCallback(
    async (agentId: string, modelId: string, options?: UpdateAgentOptions) => {
      return updateAgent({ id: agentId, model: modelId }, options)
    },
    [updateAgent]
  )

  return { updateAgent, updateModel }
}
