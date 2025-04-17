import { createSelector } from '@reduxjs/toolkit'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import store, { type RootState, useAppDispatch, useAppSelector } from '@renderer/store'
import { messageBlocksSelectors, updateOneBlock as updateMessageBlock } from '@renderer/store/messageBlock'
import { clearTopicMessages as clearTopicMessagesThunk, deleteMessageAction } from '@renderer/store/messages'
import { newMessagesActions } from '@renderer/store/newMessage'
import type { Assistant, Topic } from '@renderer/types'
import type { Message } from '@renderer/types/newMessageTypes'
import { MessageBlockType } from '@renderer/types/newMessageTypes'
import { abortCompletion } from '@renderer/utils/abortController'
import { useCallback } from 'react'

import { TopicManager } from './useTopic'

const findMainTextBlockId = (message: Message): string | undefined => {
  if (!message || !message.blocks) return undefined
  const state = store.getState()
  for (const blockId of message.blocks) {
    const block = messageBlocksSelectors.selectById(state, String(blockId))
    if (block && block.type === MessageBlockType.MAIN_TEXT) {
      return block.id
    }
  }
  return undefined
}

const selectMessagesState = (state: RootState) => state.messages

export const selectNewTopicMessages = createSelector(
  [selectMessagesState, (state: RootState, topicId: string) => topicId],
  (messagesState, topicId) => messagesState.messagesByTopic[topicId] || []
)

export const selectNewTopicLoading = createSelector(
  [selectMessagesState, (state: RootState, topicId: string) => topicId],
  (messagesState, topicId) => messagesState.loadingByTopic[topicId] || false
)

export const selectNewDisplayCount = createSelector(
  [selectMessagesState],
  (messagesState) => messagesState.displayCount
)

/**
 *
 * @param topic 当前主题
 * @returns 一组消息操作方法
 */
export function useMessageOperations(topic: Topic) {
  const dispatch = useAppDispatch()

  /**
   * 删除单个消息
   * TODO: Needs a new thunk to delete message from newMessages and associated blocks from messageBlocks
   */
  const deleteMessage = useCallback(
    async (id: string) => {
      console.warn('[TODO] deleteMessage needs update for new stores')
      await dispatch(deleteMessageAction(topic, id))
    },
    [dispatch, topic]
  )

  /**
   * 删除一组消息（基于askId）
   * TODO: Needs a new thunk similar to deleteMessage
   */
  const deleteGroupMessages = useCallback(
    async (askId: string) => {
      console.warn('[TODO] deleteGroupMessages needs update for new stores')
      await dispatch(deleteMessageAction(topic, askId, 'askId'))
    },
    [dispatch, topic]
  )

  /**
   * 编辑消息 (Uses newMessagesActions.updateMessage)
   */
  const editMessage = useCallback(
    async (messageId: string, updates: Partial<Message>) => {
      await dispatch(newMessagesActions.updateMessage({ topicId: topic.id, messageId, updates }))
    },
    [dispatch, topic.id]
  )

  /**
   * 重新发送消息
   * TODO: Needs a new thunk (e.g., resendNewMessageThunk) interacting with new stores
   */
  const resendMessageAction = useCallback(
    // Suppress unused variable warnings for placeholder function
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async (message: Message, assistant: Assistant) => {
      console.warn('[TODO] resendMessageAction needs new thunk')
      // Placeholder: No dispatch, needs new thunk
      // Example: await dispatch(resendNewMessageThunk(message, assistant, topic))
      return Promise.resolve()
    },
    [dispatch] // Keep dispatch as dependency
  )

  /**
   * 重新发送用户消息（编辑后）
   * TODO: Depends on the new resend thunk
   */
  const resendUserMessageWithEdit = useCallback(
    // Suppress unused variable warnings for placeholder function
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async (message: Message, editedContent: string, assistant: Assistant) => {
      const mainTextBlockId = findMainTextBlockId(message)
      if (!mainTextBlockId) {
        console.error('Cannot resend edited message: Main text block not found.')
        return
      }
      // 1. Update the block content directly
      await dispatch(updateMessageBlock({ id: mainTextBlockId, changes: { content: editedContent } }))

      // 2. Call the (future) resend thunk
      console.warn('[TODO] resendUserMessageWithEdit needs new resend thunk')
      // Example: await dispatch(resendNewMessageThunk({ ...message, blocks: [...] }, assistant, topic)) // Need to reconstruct message if needed by thunk
      return Promise.resolve()
    },
    [dispatch] // Keep dispatch as dependency, removed comment
  )

  /**
   * 清除会话消息
   * TODO: Needs a new thunk to clear messages from newMessages and associated blocks from messageBlocks
   */
  const clearTopicMessagesAction = useCallback(
    async (_topicId?: string) => {
      const topicId = _topicId || topic.id
      console.warn('[TODO] clearTopicMessagesAction needs update for new stores')
      await dispatch(clearTopicMessagesThunk(topicId))
      await TopicManager.clearTopicMessages(topicId)
    },
    [dispatch, topic.id]
  )

  /**
   * 创建新的上下文（clear message）
   */
  const createNewContext = useCallback(async () => {
    EventEmitter.emit(EVENT_NAMES.NEW_CONTEXT)
  }, [])

  const displayCount = useAppSelector(selectNewDisplayCount)

  const pauseMessages = useCallback(async () => {
    const state = store.getState()
    const topicMessages = state.messages?.messagesByTopic?.[topic.id]
    if (!topicMessages) return

    const streamingMessages = topicMessages.filter((m) => m.status === 'processing' || m.status === 'sending')

    const askIds = [...new Set(streamingMessages.map((m) => m.askId).filter((id): id is string => !!id))]

    for (const askId of askIds) {
      abortCompletion(askId)
    }
    dispatch(newMessagesActions.setTopicLoading({ topicId: topic.id, loading: false }))
  }, [topic.id, dispatch])

  /**
   * 恢复/重发消息
   * TODO: Depends on the new resend thunk
   */
  const resumeMessage = useCallback(
    async (message: Message, assistant: Assistant) => {
      return resendMessageAction(message, assistant) // Calls the placeholder
    },
    [resendMessageAction]
  )

  return {
    displayCount,
    deleteMessage,
    deleteGroupMessages,
    editMessage,
    resendMessage: resendMessageAction,
    resendUserMessageWithEdit,
    createNewContext,
    clearTopicMessages: clearTopicMessagesAction,
    pauseMessages,
    resumeMessage
  }
}

export const useTopicMessages = (topic: Topic) => {
  const messages = useAppSelector((state) => selectNewTopicMessages(state, topic.id))
  return messages
}

export const useTopicLoading = (topic: Topic) => {
  const loading = useAppSelector((state) => selectNewTopicLoading(state, topic.id))
  return loading
}
