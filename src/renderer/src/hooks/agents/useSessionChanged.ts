import store, { useAppDispatch } from '@renderer/store'
import { newMessagesActions } from '@renderer/store/newMessage'
import { loadTopicMessagesThunk } from '@renderer/store/thunk/messageThunk'
import { buildAgentSessionTopicId } from '@renderer/utils/agentSession'
import { useEffect } from 'react'

export function useSessionChanged(agentId: string | undefined, mutate: () => void) {
  const dispatch = useAppDispatch()

  useEffect(() => {
    if (!agentId) return
    const cleanup = window.api.agentSessionStream.onSessionChanged((data) => {
      if (data.agentId === agentId) {
        mutate()
        const topicId = buildAgentSessionTopicId(data.sessionId)
        // Show fulfilled indicator (green dot) on the session item
        dispatch(
          newMessagesActions.setTopicFulfilled({
            topicId,
            fulfilled: true
          })
        )
        // If the user is currently viewing this session, force-reload messages
        // from SQLite so headless-persisted exchanges appear immediately.
        const currentTopicId = store.getState().messages.currentTopicId
        if (currentTopicId === topicId) {
          void dispatch(loadTopicMessagesThunk(topicId, true))
        }
      }
    })
    return cleanup
  }, [agentId, dispatch, mutate])
}
