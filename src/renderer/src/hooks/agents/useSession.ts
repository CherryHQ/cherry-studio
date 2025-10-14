import { useAppDispatch } from '@renderer/store'
import { loadTopicMessagesThunk } from '@renderer/store/thunk/messageThunk'
import { UpdateSessionForm } from '@renderer/types'
import { buildAgentSessionTopicId } from '@renderer/utils/agentSession'
import { useCallback, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import useSWR from 'swr'

import { useAgentClient } from './useAgentClient'

export const useSession = (agentId: string, sessionId: string) => {
  const { t } = useTranslation()
  const client = useAgentClient()
  const key = client.getSessionPaths(agentId).withId(sessionId)
  const dispatch = useAppDispatch()
  const sessionTopicId = useMemo(() => buildAgentSessionTopicId(sessionId), [sessionId])

  const fetcher = async () => {
    const data = await client.getSession(agentId, sessionId)
    return data
  }
  const { data, error, isLoading, mutate } = useSWR(key, fetcher)

  // Use loadTopicMessagesThunk to load messages (with caching mechanism)
  // This ensures messages are preserved when switching between sessions/tabs
  useEffect(() => {
    if (sessionId) {
      // loadTopicMessagesThunk will check if messages already exist in Redux
      // and skip loading if they do (unless forceReload is true)
      dispatch(loadTopicMessagesThunk(sessionTopicId))
    }
  }, [dispatch, sessionId, sessionTopicId])

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

  return {
    session: data,
    error,
    isLoading,
    updateSession,
    mutate
  }
}
