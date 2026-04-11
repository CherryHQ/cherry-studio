import store from '@renderer/store'
import type { AgentEntity, ListAgentsResponse, UpdateAgentForm, UpdateSessionForm } from '@renderer/types'
import type { UpdateAgentBaseOptions, UpdateAgentFunction } from '@renderer/types/agent'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { mutate } from 'swr'

import { useAgentClient } from './useAgentClient'

/** Fields that should be synced from agent to its active session */
const SYNC_FIELDS = [
  'model',
  'plan_model',
  'small_model',
  'allowed_tools',
  'configuration',
  'mcps',
  'instructions'
] as const

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

        // Sync changed fields to the active session for this agent
        const { activeSessionIdMap } = store.getState().runtime.chat
        const activeSessionId = activeSessionIdMap[form.id]
        if (activeSessionId) {
          const sessionUpdate: UpdateSessionForm = { id: activeSessionId }
          let hasChanges = false
          for (const field of SYNC_FIELDS) {
            if (Object.prototype.hasOwnProperty.call(form, field)) {
              sessionUpdate[field] = form[field]
              hasChanges = true
            }
          }
          if (hasChanges) {
            try {
              const updatedSession = await client.updateSession(form.id, sessionUpdate)
              const sessionKey = client.getSessionPaths(form.id).withId(activeSessionId)
              void mutate(sessionKey, updatedSession, { revalidate: false })
            } catch {
              // Session sync is best-effort; agent update already succeeded
            }
          }
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
