import store from '@renderer/store'
import type { AgentEntity, ListAgentsResponse, UpdateAgentForm } from '@renderer/types'
import type { UpdateAgentBaseOptions, UpdateAgentFunction } from '@renderer/types/agent'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { mutate } from 'swr'

import { useAgentClient } from './useAgentClient'

export const useUpdateAgent = () => {
  const { t } = useTranslation()
  const client = useAgentClient()
  const listKey = client.agentPaths.base

  const updateAgent: UpdateAgentFunction = useCallback(
    async (form: UpdateAgentForm, options?: UpdateAgentBaseOptions): Promise<AgentEntity | undefined> => {
      try {
        const itemKey = client.agentPaths.withId(form.id)
        // may change to optimistic update
        const result = await client.updateAgent(form)
        void mutate<ListAgentsResponse['data']>(
          listKey,
          (prev) => prev?.map((a) => (a.id === result.id ? result : a)) ?? []
        )
        void mutate(itemKey, result)
        if (options?.showSuccessToast ?? true) {
          window.toast.success({ key: 'update-agent', title: t('common.update_success') })
        }

        // Backend syncs agent settings to all sessions (skipping user-customized fields).
        // Revalidate the active session's SWR cache so the UI picks up changes immediately.
        // Other sessions refresh via SWR stale-while-revalidate when navigated to.
        // Using store.getState() instead of useSelector to avoid adding reactive deps to useCallback.
        const { activeSessionIdMap } = store.getState().runtime.chat
        const activeSessionId = activeSessionIdMap?.[form.id]
        if (activeSessionId) {
          const sessionKey = client.getSessionPaths(form.id).withId(activeSessionId)
          void mutate(sessionKey)
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
      void updateAgent({ id: agentId, model: modelId }, options)
    },
    [updateAgent]
  )

  return { updateAgent, updateModel }
}
