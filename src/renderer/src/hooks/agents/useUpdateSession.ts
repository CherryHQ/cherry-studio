import { ListAgentSessionsResponse, UpdateSessionForm } from '@renderer/types'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { mutate } from 'swr'

import { useAgentClient } from './useAgentClient'

export const useUpdateSession = (agentId: string) => {
  const { t } = useTranslation()
  const client = useAgentClient()
  const paths = client.getSessionPaths(agentId)
  const listKey = paths.base

  const updateSession = useCallback(
    async (form: UpdateSessionForm) => {
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
        window.toast.success(t('common.update_success'))
      } catch (error) {
        window.toast.error(formatErrorMessageWithPrefix(error, t('agent.update.error.failed')))
      }
    },
    [agentId, client, listKey, paths, t]
  )

  return updateSession
}
