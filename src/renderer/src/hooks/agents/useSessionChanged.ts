import { useAppDispatch } from '@renderer/store'
import { newMessagesActions } from '@renderer/store/newMessage'
import { buildAgentSessionTopicId } from '@renderer/utils/agentSession'
import { useEffect } from 'react'

export function useSessionChanged(agentId: string | undefined, mutate: () => void) {
  const dispatch = useAppDispatch()

  useEffect(() => {
    if (!agentId) return
    const cleanup = window.api.agentSessionStream.onSessionChanged((data) => {
      if (data.agentId === agentId) {
        mutate()
        // Show fulfilled indicator (green dot) on the session item
        dispatch(
          newMessagesActions.setTopicFulfilled({
            topicId: buildAgentSessionTopicId(data.sessionId),
            fulfilled: true
          })
        )
      }
    })
    return cleanup
  }, [agentId, dispatch, mutate])
}
