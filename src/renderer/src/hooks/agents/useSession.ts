import { AgentSessionMessageEntity, UpdateSessionForm } from '@renderer/types'
import { cloneDeep } from 'lodash'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import useSWR from 'swr'

import { useAgentClient } from './useAgentClient'

export const useSession = (agentId: string, sessionId: string) => {
  const { t } = useTranslation()
  const client = useAgentClient()
  const key = client.getSessionPaths(agentId).withId(sessionId)

  const fetcher = async () => {
    const data = await client.getSession(agentId, sessionId)
    return data
  }
  const { data, error, isLoading, mutate } = useSWR(key, fetcher)

  const updateSession = useCallback(
    async (form: UpdateSessionForm) => {
      if (!agentId) return
      try {
        const result = await client.updateSession(agentId, form)
        mutate(result)
      } catch (error) {
        window.toast.error(t('agent.session.update.error.failed'))
      }
    },
    [agentId, client, mutate, t]
  )

  const createSessionMessage = useCallback(
    async (content: string) => {
      if (!agentId || !sessionId || !data) return
      const origin = cloneDeep(data)
      const newMessageDraft = {
        id: -1,
        session_id: '',
        role: 'user',
        content: {
          role: 'user',
          content: content,
          providerOptions: undefined
        },
        agent_session_id: '',
        created_at: '',
        updated_at: ''
      } satisfies AgentSessionMessageEntity
      try {
        mutate((prev) => ({
          ...prev,
          accessible_paths: prev?.accessible_paths ?? [],
          model: prev?.model ?? '',
          id: prev?.id ?? '',
          agent_id: prev?.id ?? '',
          agent_type: prev?.agent_type ?? 'claude-code',
          created_at: prev?.created_at ?? '',
          updated_at: prev?.updated_at ?? '',
          messages: [...(prev?.messages ?? []), newMessageDraft]
        }))
        await client.createMessage(agentId, sessionId, content)
      } catch (error) {
        mutate(origin)
        window.toast.error(t('common.errors.create_message'))
      }
    },
    [agentId, sessionId, data, mutate, client, t]
  )

  return {
    session: data,
    messages: data?.messages ?? [],
    error,
    isLoading,
    updateSession,
    createSessionMessage
  }
}
