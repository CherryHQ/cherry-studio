import { loggerService } from '@logger'
import store from '@renderer/store'
import { newMessagesActions } from '@renderer/store/newMessage'

const logger = loggerService.withContext('topicStreamStateSync')

let started = false

/**
 * Keeps topic loading/fulfilled flags in sync with the v2 AI stream.
 *
 * Mirrors Main-side AiStreamManager lifecycle events into Redux topic flags
 * so sidebar/topic UI can read streaming state without component-level effects.
 */
export function ensureTopicStreamStateSyncStarted(): void {
  if (started || typeof window === 'undefined') return

  started = true

  window.api.ai.onStreamChunk(({ topicId }) => {
    const state = store.getState().messages
    if (!state.loadingByTopic[topicId]) {
      store.dispatch(newMessagesActions.setTopicLoading({ topicId, loading: true }))
    }
    if (state.fulfilledByTopic[topicId]) {
      store.dispatch(newMessagesActions.setTopicFulfilled({ topicId, fulfilled: false }))
    }
  })

  window.api.ai.onStreamDone(({ topicId }) => {
    store.dispatch(newMessagesActions.setTopicLoading({ topicId, loading: false }))
    store.dispatch(newMessagesActions.setTopicFulfilled({ topicId, fulfilled: true }))
  })

  window.api.ai.onStreamError(({ topicId, error }) => {
    logger.warn('AI stream ended with error', { topicId, error })
    store.dispatch(newMessagesActions.setTopicLoading({ topicId, loading: false }))
  })
}
