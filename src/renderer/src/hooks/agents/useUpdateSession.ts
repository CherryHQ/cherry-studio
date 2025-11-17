import type { AgentSessionEntity, ListAgentSessionsResponse, UpdateSessionForm } from '@renderer/types'
import type { UpdateAgentBaseOptions, UpdateAgentSessionFunction } from '@renderer/types/agent'
import { getErrorMessage } from '@renderer/utils/error'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { mutate } from 'swr'

import { useAgentClient } from './useAgentClient'

export const useUpdateSession = (agentId: string | null) => {
  const { t } = useTranslation()
  const client = useAgentClient()

  const updateSession: UpdateAgentSessionFunction = useCallback(
    async (form: UpdateSessionForm, options?: UpdateAgentBaseOptions): Promise<AgentSessionEntity | undefined> => {
      if (!agentId) return
      const paths = client.getSessionPaths(agentId)
      const listKey = paths.base
      const sessionId = form.id
      try {
        const itemKey = paths.withId(sessionId)
        // may change to optimistic update
        const result = await client.updateSession(agentId, form)
        mutate<ListAgentSessionsResponse['data']>(
          listKey,
          (prev) => prev?.map((session) => (session.id === result.id ? result : session)) ?? []
        )
        mutate(itemKey, result)
        if (options?.showSuccessToast ?? true) {
          window.toast.success(t('common.update_success'))
        }
        return result
      } catch (error) {
        window.toast.error({ title: t('agent.session.update.error.failed'), description: getErrorMessage(error) })
        return undefined
      }
    },
    [agentId, client, t]
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
