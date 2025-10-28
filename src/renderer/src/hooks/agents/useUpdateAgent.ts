import { AgentEntity, ListAgentsResponse, UpdateAgentForm } from '@renderer/types'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { mutate } from 'swr'

import { UpdateAgentBaseOptions } from './types'
import { useAgentClient } from './useAgentClient'

export const useUpdateAgent = () => {
  const { t } = useTranslation()
  const client = useAgentClient()
  const listKey = client.agentPaths.base

  const updateAgent = useCallback(
    async (form: UpdateAgentForm, options?: UpdateAgentBaseOptions): Promise<AgentEntity | undefined> => {
      try {
        const itemKey = client.agentPaths.withId(form.id)
        // may change to optimistic update
        const result = await client.updateAgent(form)
        mutate<ListAgentsResponse['data']>(listKey, (prev) => prev?.map((a) => (a.id === result.id ? result : a)) ?? [])
        mutate(itemKey, result)
        if (options?.showSuccessToast ?? true) {
          window.toast.success(t('common.update_success'))
        }
        return result
      } catch (error) {
        window.toast.error(formatErrorMessageWithPrefix(error, t('agent.update.error.failed')))
        return undefined
      }
    },
    [client, listKey, t]
  )

  const updateModel = useCallback(
    async (agentId: string, modelId: string, options?: UpdateAgentBaseOptions) => {
      updateAgent({ id: agentId, model: modelId }, options)
    },
    [updateAgent]
  )

  return { updateAgent, updateModel }
}
