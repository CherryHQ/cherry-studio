import { useInvalidateCache } from '@renderer/data/hooks/useDataApi'
import type { AgentSessionEntity, UpdateSessionForm } from '@renderer/types'
import type { UpdateAgentBaseOptions, UpdateAgentSessionFunction } from '@renderer/types/agent'
import { getErrorMessage } from '@renderer/utils/error'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import { useAgentClient } from './useAgentClient'

export const useUpdateSession = (agentId: string | null) => {
  const { t } = useTranslation()
  const client = useAgentClient()
  const invalidate = useInvalidateCache()

  const updateSession: UpdateAgentSessionFunction = useCallback(
    async (form: UpdateSessionForm, options?: UpdateAgentBaseOptions): Promise<AgentSessionEntity | undefined> => {
      if (!agentId || !client) return

      try {
        const result = await client.updateSession(agentId, form)
        await invalidate([`/agents/${agentId}/sessions`, `/agents/${agentId}/sessions/${form.id}`])
        if (options?.showSuccessToast ?? true) {
          window.toast.success(t('common.update_success'))
        }
        return result
      } catch (error) {
        await invalidate([`/agents/${agentId}/sessions`, `/agents/${agentId}/sessions/${form.id}`])
        window.toast.error({ title: t('agent.session.update.error.failed'), description: getErrorMessage(error) })
        return undefined
      }
    },
    [agentId, client, invalidate, t]
  )

  const updateModel = useCallback(
    async (sessionId: string, modelId: string, options?: UpdateAgentBaseOptions) => {
      if (!agentId) return
      return updateSession(
        {
          id: sessionId,
          model: modelId
        },
        options
      )
    },
    [agentId, updateSession]
  )

  return { updateSession, updateModel }
}
