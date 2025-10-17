import { useAppDispatch } from '@renderer/store'
import { loadTopicMessagesThunk } from '@renderer/store/thunk/messageThunk'
import { buildAgentSessionTopicId } from '@renderer/utils/agentSession'
import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import useSWR from 'swr'

import { useAgentClient } from './useAgentClient'
import { useUpdateSession } from './useUpdateSession'

export const useSession = (agentId: string | null, sessionId: string | null) => {
  const { t } = useTranslation()
  const client = useAgentClient()
  const key = agentId && sessionId ? client.getSessionPaths(agentId).withId(sessionId) : null
  const dispatch = useAppDispatch()
  const sessionTopicId = useMemo(() => (sessionId ? buildAgentSessionTopicId(sessionId) : null), [sessionId])
  const { updateSession } = useUpdateSession(agentId)

  const fetcher = async () => {
    if (!agentId) throw new Error(t('agent.get.error.null_id'))
    if (!sessionId) throw new Error(t('agent.session.get.error.null_id'))
    const data = await client.getSession(agentId, sessionId)
    return data
  }
  const { data, error, isLoading, mutate } = useSWR(key, fetcher)

  // Use loadTopicMessagesThunk to load messages (with caching mechanism)
  // This ensures messages are preserved when switching between sessions/tabs
  useEffect(() => {
    if (sessionTopicId) {
      // loadTopicMessagesThunk will check if messages already exist in Redux
      // and skip loading if they do (unless forceReload is true)
      dispatch(loadTopicMessagesThunk(sessionTopicId))
    }
  }, [dispatch, sessionId, sessionTopicId])

  return {
    session: data,
    error,
    isLoading,
    updateSession,
    mutate
  }
}
