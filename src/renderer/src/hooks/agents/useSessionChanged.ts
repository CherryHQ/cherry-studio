import store, { useAppDispatch } from '@renderer/store'
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
        // Only force-reload from DB when the exchange was persisted headlessly
        // (i.e. the renderer was NOT streaming in real-time). When the renderer
        // was watching, it already has the rich data in Redux via BlockManager,
        // and force-reloading here would race with its fire-and-forget DB writes.
        if (data.headless) {
          const topicId = buildAgentSessionTopicId(data.sessionId)
          const currentTopicId = store.getState().messages.currentTopicId
          if (currentTopicId === topicId) {
            void dispatch(loadTopicMessagesThunk(topicId, true))
          }
        }
      }
    })
    return cleanup
  }, [agentId, dispatch, mutate])
}
