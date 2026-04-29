import { cacheService } from '@data/CacheService'
import { useMutation } from '@renderer/data/hooks/useDataApi'
import type { AgentEntity, UpdateAgentForm } from '@renderer/types'
import type { UpdateAgentBaseOptions, UpdateAgentFunction } from '@renderer/types/agent'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { mutate } from 'swr'

import { parseAgentConfiguration } from './utils'

export const useUpdateAgent = () => {
  const { t } = useTranslation()
  const { trigger: updateTrigger } = useMutation('PATCH', '/agents/:agentId', {
    refresh: ({ args }) => ['/agents', `/agents/${args?.params?.agentId}`]
  })

  const updateAgent: UpdateAgentFunction = useCallback(
    async (form: UpdateAgentForm, options?: UpdateAgentBaseOptions): Promise<AgentEntity | undefined> => {
      try {
        const { id, ...patch } = form
        const result = await updateTrigger({ params: { agentId: id }, body: patch })
        if (options?.showSuccessToast ?? true) {
          window.toast.success({ key: 'update-agent', title: t('common.update_success') })
        }

        // Backend syncs agent settings to all sessions (skipping user-customized fields).
        // Revalidate the active session's SWR cache so the UI picks up changes immediately.
        // Other sessions refresh via SWR stale-while-revalidate when navigated to.
        // Using cacheService.get() instead of useCache to avoid adding reactive deps to useCallback.
        const activeSessionIdMap = cacheService.get('agent.session.active_id_map') ?? {}
        const activeSessionId = activeSessionIdMap?.[id]
        if (activeSessionId) {
          // Key must be the array form [path] to match useQuery's buildSWRKey output
          void mutate([`/agents/${id}/sessions/${activeSessionId}`])
        }

        // Apply Zod defaults to configuration (DataAPI returns Record<string, unknown>)
        return {
          ...(result as unknown as AgentEntity),
          configuration: parseAgentConfiguration(result.configuration)
        }
      } catch (error) {
        window.toast.error(formatErrorMessageWithPrefix(error, t('agent.update.error.failed')))
        return undefined
      }
    },
    [updateTrigger, t]
  )

  const updateModel = useCallback(
    async (agentId: string, modelId: string, options?: UpdateAgentBaseOptions) => {
      void updateAgent({ id: agentId, model: modelId }, options)
    },
    [updateAgent]
  )

  return { updateAgent, updateModel }
}
