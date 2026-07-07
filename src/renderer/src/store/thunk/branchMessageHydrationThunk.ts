import { loggerService } from '@logger'
import { dbService } from '@renderer/services/db/DbService'

import type { AppDispatch, RootState } from '../index'
import { upsertManyBlocks } from '../messageBlock'
import { newMessagesActions, selectMessagesForTopic } from '../newMessage'

const logger = loggerService.withContext('BranchMessageHydrationThunk')

interface HydrateBranchTopicMessagesOptions {
  forceReload?: boolean
}

export const hydrateBranchTopicMessagesThunk =
  (branchTopicId: string, options: HydrateBranchTopicMessagesOptions = {}) =>
  async (dispatch: AppDispatch, getState: () => RootState) => {
    const { forceReload = false } = options
    const state = getState()

    if (!forceReload && state.messages.messageIdsByTopic[branchTopicId]) {
      return selectMessagesForTopic(state, branchTopicId)
    }

    try {
      dispatch(newMessagesActions.setTopicLoading({ topicId: branchTopicId, loading: true }))

      const { messages, blocks } = await dbService.fetchMessages(branchTopicId)

      if (blocks.length > 0) {
        dispatch(upsertManyBlocks(blocks))
      }

      dispatch(newMessagesActions.branchTopicMessagesHydrated({ topicId: branchTopicId, messages }))
      dispatch(newMessagesActions.setTopicFulfilled({ topicId: branchTopicId, fulfilled: true }))

      return messages
    } catch (error) {
      logger.error(`Failed to hydrate branch topic messages for ${branchTopicId}:`, error as Error)
      throw error
    } finally {
      dispatch(newMessagesActions.setTopicLoading({ topicId: branchTopicId, loading: false }))
    }
  }
