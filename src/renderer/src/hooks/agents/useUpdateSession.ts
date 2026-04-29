import { useMutation } from '@renderer/data/hooks/useDataApi'
import type { AgentSessionEntity, UpdateSessionForm } from '@renderer/types'
import type { UpdateAgentBaseOptions, UpdateAgentSessionFunction } from '@renderer/types/agent'
import { getErrorMessage } from '@renderer/utils/error'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import { parseAgentConfiguration } from './utils'

export const useUpdateSession = (agentId: string | null) => {
  const { t } = useTranslation()
  const { trigger: updateTrigger } = useMutation('PATCH', '/agents/:agentId/sessions/:sessionId', {
    refresh: ({ args }) => [
      `/agents/${args?.params?.agentId}/sessions`,
      `/agents/${args?.params?.agentId}/sessions/${args?.params?.sessionId}`
    ]
  })

  const updateSession: UpdateAgentSessionFunction = useCallback(
    async (form: UpdateSessionForm, options?: UpdateAgentBaseOptions): Promise<AgentSessionEntity | undefined> => {
      if (!agentId) return
      try {
        const { id, ...patch } = form
        const result = await updateTrigger({
          params: { agentId, sessionId: id },
          body: patch
        })
        if (options?.showSuccessToast ?? true) {
          window.toast.success(t('common.update_success'))
        }
        // Apply Zod defaults to configuration (DataAPI returns Record<string, unknown>)
        return {
          ...(result as unknown as AgentSessionEntity),
          configuration: parseAgentConfiguration(result.configuration, { entityId: result.id, entityType: 'session' })
        }
      } catch (error) {
        window.toast.error({ title: t('agent.session.update.error.failed'), description: getErrorMessage(error) })
        return undefined
      }
    },
    [agentId, updateTrigger, t]
  )

  const updateModel = useCallback(
    async (sessionId: string, modelId: string, options?: UpdateAgentBaseOptions) => {
      if (!agentId) return
      return updateSession({ id: sessionId, model: modelId }, options)
    },
    [agentId, updateSession]
  )

  return { updateSession, updateModel }
}
