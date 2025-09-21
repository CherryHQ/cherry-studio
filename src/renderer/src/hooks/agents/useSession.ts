import { useAppDispatch } from '@renderer/store'
import { removeManyBlocks, upsertManyBlocks } from '@renderer/store/messageBlock'
import { newMessagesActions } from '@renderer/store/newMessage'
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

  const fetcher = async () => {
    const data = await client.getSession(agentId, sessionId)
    return data
  }
  const { data, error, isLoading, mutate } = useSWR(key, fetcher)

  useEffect(() => {
    const messages = data?.messages ?? []
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

  useEffect(() => {
    return () => {
      if (blockIdsRef.current.length > 0) {
        dispatch(removeManyBlocks(blockIdsRef.current))
      }
      dispatch(newMessagesActions.clearTopicMessages(sessionTopicId))
    }
  }, [dispatch, sessionTopicId])

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
