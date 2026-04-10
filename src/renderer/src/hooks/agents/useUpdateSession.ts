import { DEFAULT_SESSION_PAGE_SIZE } from '@renderer/api/agent'
import type { AgentSessionEntity, ListAgentSessionsResponse, UpdateSessionForm } from '@renderer/types'
import type { UpdateAgentBaseOptions, UpdateAgentSessionFunction } from '@renderer/types/agent'
import { getErrorMessage } from '@renderer/utils/error'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { mutate } from 'swr'
import { unstable_serialize } from 'swr/infinite'

import { useAgentClient } from './useAgentClient'

type InfiniteData = ListAgentSessionsResponse[]

const mutateInfiniteList = (
  infKey: string,
  sessionId: string,
  updater: (session: AgentSessionEntity) => AgentSessionEntity
) => {
  void mutate<InfiniteData>(
    infKey,
    (prev) => {
      if (!prev) return prev
      return prev.map((page) => ({
        ...page,
        data: page.data.map((session) => (session.id === sessionId ? updater(session) : session))
      }))
    },
    { revalidate: false }
  )
}

export const useUpdateSession = (agentId: string | null) => {
  const { t } = useTranslation()
  const client = useAgentClient()

  const updateSession: UpdateAgentSessionFunction = useCallback(
    async (form: UpdateSessionForm, options?: UpdateAgentBaseOptions): Promise<AgentSessionEntity | undefined> => {
      if (!agentId) return
      const paths = client.getSessionPaths(agentId)
      const listKey = paths.base
      const sessionId = form.id
      const itemKey = paths.withId(sessionId)
      const infKey = unstable_serialize(() => [listKey, 0, DEFAULT_SESSION_PAGE_SIZE])

      // Optimistic update
      mutateInfiniteList(infKey, sessionId, (session) => ({ ...session, ...form }))
      void mutate<AgentSessionEntity>(itemKey, (prev) => (prev ? { ...prev, ...form } : prev), { revalidate: false })

      try {
        const result = await client.updateSession(agentId, form)
        // Update with server response
        mutateInfiniteList(infKey, sessionId, () => result)
        void mutate(itemKey, result, { revalidate: false })
        if (options?.showSuccessToast ?? true) {
          window.toast.success(t('common.update_success'))
        }
        return result
      } catch (error) {
        // Rollback: revalidate to get fresh data
        void mutate(infKey)
        void mutate(itemKey)
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
