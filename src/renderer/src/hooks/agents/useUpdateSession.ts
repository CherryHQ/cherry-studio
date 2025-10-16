import { ListAgentSessionsResponse, UpdateSessionForm } from '@renderer/types'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { mutate } from 'swr'

import { UpdateAgentBaseOptions } from './types'
import { useAgentClient } from './useAgentClient'

export const useUpdateSession = (agentId: string | null) => {
  const { t } = useTranslation()
  const client = useAgentClient()

  const updateSession = useCallback(
    async (form: UpdateSessionForm, options?: UpdateAgentBaseOptions) => {
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
      } catch (error) {
        window.toast.error(formatErrorMessageWithPrefix(error, t('agent.update.error.failed')))
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
