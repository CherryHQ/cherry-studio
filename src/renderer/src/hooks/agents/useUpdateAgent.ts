import { useInvalidateCache } from '@renderer/data/hooks/useDataApi'
import type { AgentEntity, UpdateAgentForm } from '@renderer/types'
import type { UpdateAgentBaseOptions, UpdateAgentFunction } from '@renderer/types/agent'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import { useAgentClient } from './useAgentClient'

export const useUpdateAgent = () => {
  const { t } = useTranslation()
  const client = useAgentClient()
  const invalidate = useInvalidateCache()

  const updateAgent: UpdateAgentFunction = useCallback(
    async (form: UpdateAgentForm, options?: UpdateAgentBaseOptions): Promise<AgentEntity | undefined> => {
      try {
        if (!client) {
          throw new Error(t('apiServer.messages.notEnabled'))
        }
        const result = await client.updateAgent(form)
        await invalidate(['/agents', `/agents/${form.id}`])
        if (options?.showSuccessToast ?? true) {
          window.toast.success({ key: 'update-agent', title: t('common.update_success') })
        }
        return result
      } catch (error) {
        window.toast.error(formatErrorMessageWithPrefix(error, t('agent.update.error.failed')))
        return undefined
      }
    },
    [client, invalidate, t]
  )

  const updateModel = useCallback(
    async (agentId: string, modelId: string, options?: UpdateAgentBaseOptions) => {
      void updateAgent({ id: agentId, model: modelId }, options)
    },
    [updateAgent]
  )

  return { updateAgent, updateModel }
}
