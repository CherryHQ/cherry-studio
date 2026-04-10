import { dataApiService } from '@renderer/data/DataApiService'
import { useInvalidateCache } from '@renderer/data/hooks/useDataApi'
import type { AgentEntity, UpdateAgentForm } from '@renderer/types'
import type { UpdateAgentBaseOptions, UpdateAgentFunction } from '@renderer/types/agent'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

export const useUpdateAgent = () => {
  const { t } = useTranslation()
  const invalidate = useInvalidateCache()

  const updateAgent: UpdateAgentFunction = useCallback(
    async (form: UpdateAgentForm, options?: UpdateAgentBaseOptions): Promise<AgentEntity | undefined> => {
      try {
        const result = (await dataApiService.patch(`/agents/${form.id}`, {
          body: form
        })) as AgentEntity
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
    [invalidate, t]
  )

  const updateModel = useCallback(
    async (agentId: string, modelId: string, options?: UpdateAgentBaseOptions) => {
      void updateAgent({ id: agentId, model: modelId }, options)
    },
    [updateAgent]
  )

  return { updateAgent, updateModel }
}
