import { createSelector } from '@reduxjs/toolkit'
import { type RootState, useAppSelector } from '@renderer/store'
import { selectMessagesForTopic } from '@renderer/store/newMessage'
import type { Topic } from '@renderer/types'

import { useMessageActions } from './useMessageActions'
import { useMessageBranching } from './useMessageBranching'
import { useMessageCRUD } from './useMessageCRUD'
import { useMessageTranslation } from './useMessageTranslation'

const selectMessagesState = (state: RootState) => state.messages

export const selectNewTopicLoading = createSelector(
  [selectMessagesState, (_, topicId: string) => topicId],
  (messagesState, topicId) => messagesState.loadingByTopic[topicId] || false
)

export const selectNewDisplayCount = createSelector(
  [selectMessagesState],
  (messagesState) => messagesState.displayCount
)

/**
 * Hook 提供针对特定主题的消息操作方法。 / Hook providing various operations for messages within a specific topic.
 * @param topic 当前主题对象。 / The current topic object.
 * @returns 包含消息操作函数的对象。 / An object containing message operation functions.
 */
export function useMessageOperations(topic: Topic) {
  // 使用拆分后的子模块
  const crudOps = useMessageCRUD(topic.id)
  const translationOps = useMessageTranslation(topic.id)
  const branchingOps = useMessageBranching()
  const actionOps = useMessageActions(topic.id, crudOps.editMessageBlocks)

  const displayCount = useAppSelector(selectNewDisplayCount)

  return {
    displayCount,
    // CRUD 操作
    deleteMessage: crudOps.deleteMessage,
    deleteGroupMessages: crudOps.deleteGroupMessages,
    editMessage: crudOps.editMessage,
    editMessageBlocks: crudOps.editMessageBlocks,
    removeMessageBlock: crudOps.removeMessageBlock,
    // 翻译操作
    getTranslationUpdater: translationOps.getTranslationUpdater,
    // 分支操作
    createTopicBranch: branchingOps.createTopicBranch,
    // 消息操作
    resendMessage: actionOps.resendMessage,
    regenerateAssistantMessage: actionOps.regenerateAssistantMessage,
    resendUserMessageWithEdit: actionOps.resendUserMessageWithEdit,
    appendAssistantResponse: actionOps.appendAssistantResponse,
    createNewContext: actionOps.createNewContext,
    clearTopicMessages: actionOps.clearTopicMessages,
    pauseMessages: actionOps.pauseMessages,
    resumeMessage: actionOps.resumeMessage
  }
}

export const useTopicMessages = (topicId: string) => {
  return useAppSelector((state) => selectMessagesForTopic(state, topicId))
}

export const useTopicLoading = (topic: Topic) => {
  return useAppSelector((state) => selectNewTopicLoading(state, topic.id))
}
