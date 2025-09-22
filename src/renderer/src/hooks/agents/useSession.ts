import { useAppDispatch, useAppSelector } from '@renderer/store'
import { upsertManyBlocks } from '@renderer/store/messageBlock'
import { newMessagesActions, selectMessagesForTopic } from '@renderer/store/newMessage'
import { AgentPersistedMessage, UpdateSessionForm } from '@renderer/types'
import { buildAgentSessionTopicId } from '@renderer/utils/agentSession'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import useSWR from 'swr'

import { useAgentClient } from './useAgentClient'

export const useSession = (agentId: string, sessionId: string) => {
  const { t } = useTranslation()
  const client = useAgentClient()
  const key = client.getSessionPaths(agentId).withId(sessionId)
  const dispatch = useAppDispatch()
  const sessionTopicId = useMemo(() => buildAgentSessionTopicId(sessionId), [sessionId])
  const blockIdsRef = useRef<string[]>([])

  // Check if messages are already in Redux
  const messagesInRedux = useAppSelector((state) => selectMessagesForTopic(state, sessionTopicId))

  const fetcher = async () => {
    const data = await client.getSession(agentId, sessionId)
    return data
  }
  const { data, error, isLoading, mutate } = useSWR(key, fetcher)

  useEffect(() => {
    const messages = data?.messages ?? []

    // Always reload messages to Redux when data is available
    // This ensures messages are restored when switching back to a session
    if (!messages.length) {
      dispatch(newMessagesActions.messagesReceived({ topicId: sessionTopicId, messages: [] }))
      blockIdsRef.current = []
      return
    }

    const persistedEntries = messages
      .map((entity) => entity.content as AgentPersistedMessage | undefined)
      .filter((entry): entry is AgentPersistedMessage => Boolean(entry))

    const allBlocks = persistedEntries.flatMap((entry) => entry.blocks)
    if (allBlocks.length > 0) {
      dispatch(upsertManyBlocks(allBlocks))
    }

    blockIdsRef.current = allBlocks.map((block) => block.id)

    const messageRecords = persistedEntries.map((entry) => entry.message)
    dispatch(newMessagesActions.messagesReceived({ topicId: sessionTopicId, messages: messageRecords }))
  }, [data?.messages, dispatch, sessionTopicId])

  // Also ensure messages are reloaded when component mounts if they're missing from Redux
  useEffect(() => {
    // If we have data but no messages in Redux, reload them
    if (data?.messages && data.messages.length > 0 && messagesInRedux.length === 0) {
      const messages = data.messages
      const persistedEntries = messages
        .map((entity) => entity.content as AgentPersistedMessage | undefined)
        .filter((entry): entry is AgentPersistedMessage => Boolean(entry))

      const allBlocks = persistedEntries.flatMap((entry) => entry.blocks)
      if (allBlocks.length > 0) {
        dispatch(upsertManyBlocks(allBlocks))
      }

      const messageRecords = persistedEntries.map((entry) => entry.message)
      dispatch(newMessagesActions.messagesReceived({ topicId: sessionTopicId, messages: messageRecords }))
    }
  }, [data?.messages, dispatch, messagesInRedux.length, sessionTopicId])

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
