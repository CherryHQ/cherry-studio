import { createSelector } from '@reduxjs/toolkit'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import store, { type RootState, useAppDispatch, useAppSelector } from '@renderer/store'
import { messageBlocksSelectors } from '@renderer/store/messageBlock'
import { updateOneBlock } from '@renderer/store/messageBlock'
import { newMessagesActions, selectMessagesForTopic } from '@renderer/store/newMessage'
import {
  appendAssistantResponseThunk,
  clearTopicMessagesThunk,
  cloneMessagesToNewTopicThunk,
  deleteMessageGroupThunk,
  deleteSingleMessageThunk,
  initiateTranslationThunk,
  regenerateAssistantResponseThunk,
  resendMessageThunk,
  resendUserMessageWithEditThunk
} from '@renderer/store/thunk/messageThunk'
import { throttledBlockDbUpdate } from '@renderer/store/thunk/messageThunk'
import type { Assistant, Model, Topic } from '@renderer/types'
import type { Message, MessageBlock } from '@renderer/types/newMessage'
import { MessageBlockStatus, MessageBlockType } from '@renderer/types/newMessage'
import { abortCompletion } from '@renderer/utils/abortController'
import { useCallback } from 'react'

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
  const dispatch = useAppDispatch()

  /**
   * 删除单个消息。 / Deletes a single message.
   * Dispatches deleteSingleMessageThunk.
   */
  const deleteMessage = useCallback(
    async (id: string) => {
      await dispatch(deleteSingleMessageThunk(topic.id, id))
    },
    [dispatch, topic.id] // Use topic.id directly
  )

  /**
   * 删除一组消息（基于 askId）。 / Deletes a group of messages (based on askId).
   * Dispatches deleteMessageGroupThunk.
   */
  const deleteGroupMessages = useCallback(
    async (askId: string) => {
      await dispatch(deleteMessageGroupThunk(topic.id, askId))
    },
    [dispatch, topic.id]
  )

  /**
   * 编辑消息。（目前仅更新 Redux state）。 / Edits a message. (Currently only updates Redux state).
   * 使用 newMessagesActions.updateMessage.
   */
  const editMessage = useCallback(
    async (messageId: string, updates: Partial<Message>) => {
      // Basic update remains the same
      await dispatch(newMessagesActions.updateMessage({ topicId: topic.id, messageId, updates }))
      // TODO: Add token recalculation logic here if necessary
      // if ('content' in updates or other relevant fields change) {
      //   const state = store.getState(); // Need store or selector access
      //   const message = state.messages.messagesByTopic[topic.id]?.find(m => m.id === messageId);
      //   if (message) {
      //      const updatedUsage = await estimateTokenUsage(...); // Call estimation service
      //      await dispatch(newMessagesActions.updateMessage({ topicId: topic.id, messageId, updates: { usage: updatedUsage } }));
      //   }
      // }
    },
    [dispatch, topic.id]
  )

  /**
   * 重新发送用户消息，触发其所有助手回复的重新生成。 / Resends a user message, triggering regeneration of all its assistant responses.
   * Dispatches resendMessageThunk.
   */
  const resendMessage = useCallback(
    async (message: Message, assistant: Assistant) => {
      await dispatch(resendMessageThunk(topic.id, message, assistant))
    },
    [dispatch, topic.id] // topic object needed by thunk
  )

  /**
   * 在用户消息的主文本块被编辑后重新发送该消息。 / Resends a user message after its main text block has been edited.
   * Dispatches resendUserMessageWithEditThunk.
   */
  const resendUserMessageWithEdit = useCallback(
    async (message: Message, editedContent: string, assistant: Assistant) => {
      const mainTextBlockId = findMainTextBlockId(message)
      if (!mainTextBlockId) {
        console.error('Cannot resend edited message: Main text block not found.')
        return
      }

      await dispatch(resendUserMessageWithEditThunk(topic.id, message, mainTextBlockId, editedContent, assistant))
    },
    [dispatch, topic.id] // topic object needed by thunk
  )

  /**
   * 清除当前或指定主题的所有消息。 / Clears all messages for the current or specified topic.
   * Dispatches clearTopicMessagesThunk.
   */
  const clearTopicMessages = useCallback(
    async (_topicId?: string) => {
      const topicIdToClear = _topicId || topic.id
      await dispatch(clearTopicMessagesThunk(topicIdToClear))
    },
    [dispatch, topic.id]
  )

  /**
   * 发出事件以表示创建新上下文（清空消息 UI）。 / Emits an event to signal creating a new context (clearing messages UI).
   */
  const createNewContext = useCallback(async () => {
    EventEmitter.emit(EVENT_NAMES.NEW_CONTEXT)
  }, [])

  const displayCount = useAppSelector(selectNewDisplayCount)

  /**
   * 暂停当前主题正在进行的消息生成。 / Pauses ongoing message generation for the current topic.
   */
  const pauseMessages = useCallback(async () => {
    // Use selector if preferred, but direct access is okay in callback
    const state = store.getState()
    const topicMessages = selectMessagesForTopic(state, topic.id)
    if (!topicMessages) return

    // Find messages currently in progress (adjust statuses if needed)
    const streamingMessages = topicMessages.filter((m) => m.status === 'processing' || m.status === 'pending')

    const askIds = [...new Set(streamingMessages?.map((m) => m.askId).filter((id) => !!id) as string[])]

    for (const askId of askIds) {
      abortCompletion(askId)
    }
    // Ensure loading state is set to false
    dispatch(newMessagesActions.setTopicLoading({ topicId: topic.id, loading: false }))
  }, [topic.id, dispatch])

  /**
   * 恢复/重发用户消息（目前复用 resendMessage 逻辑）。 / Resumes/Resends a user message (currently reuses resendMessage logic).
   */
  const resumeMessage = useCallback(
    async (message: Message, assistant: Assistant) => {
      // Directly call the resendMessage function from this hook
      return resendMessage(message, assistant)
    },
    [resendMessage] // Dependency is the resendMessage function itself
  )

  /**
   * 重新生成指定的助手消息回复。 / Regenerates a specific assistant message response.
   * Dispatches regenerateAssistantResponseThunk.
   */
  const regenerateAssistantMessage = useCallback(
    async (message: Message, assistant: Assistant) => {
      if (message.role !== 'assistant') {
        console.warn('regenerateAssistantMessage should only be called for assistant messages.')
        return
      }
      await dispatch(regenerateAssistantResponseThunk(topic.id, message, assistant))
    },
    [dispatch, topic.id] // topic object needed by thunk
  )

  /**
   * 使用指定模型追加一个新的助手回复，回复与现有助手消息相同的用户查询。 / Appends a new assistant response using a specified model, replying to the same user query as an existing assistant message.
   * Dispatches appendAssistantResponseThunk.
   */
  const appendAssistantResponse = useCallback(
    async (existingAssistantMessage: Message, newModel: Model, assistant: Assistant) => {
      if (existingAssistantMessage.role !== 'assistant') {
        console.error('appendAssistantResponse should only be called for an existing assistant message.')
        return
      }
      if (!existingAssistantMessage.askId) {
        console.error('Cannot append response: The existing assistant message is missing its askId.')
        return
      }
      await dispatch(appendAssistantResponseThunk(topic.id, existingAssistantMessage.id, newModel, assistant))
    },
    [dispatch, topic.id] // Dependencies
  )

  /**
   * 初始化翻译块并返回一个更新函数。 / Initiates a translation block and returns an updater function.
   * @param messageId 要翻译的消息 ID。 / The ID of the message to translate.
   * @param targetLanguage 目标语言代码。 / The target language code.
   * @param sourceBlockId (可选) 源块的 ID。 / (Optional) The ID of the source block.
   * @param sourceLanguage (可选) 源语言代码。 / (Optional) The source language code.
   * @returns 用于更新翻译块的异步函数，如果初始化失败则返回 null。 / An async function to update the translation block, or null if initiation fails.
   */
  const getTranslationUpdater = useCallback(
    async (
      messageId: string,
      targetLanguage: string,
      sourceBlockId?: string,
      sourceLanguage?: string
    ): Promise<((accumulatedText: string, isComplete?: boolean) => void) | null> => {
      if (!topic.id) return null

      // 1. Initiate the block and get its ID
      const blockId = await dispatch(
        initiateTranslationThunk(messageId, topic.id, targetLanguage, sourceBlockId, sourceLanguage)
      )

      if (!blockId) {
        console.error('[getTranslationUpdater] Failed to initiate translation block.')
        return null
      }

      // 2. Return the updater function
      // TODO:下面这个逻辑也可以放在thunk中
      return (accumulatedText: string, isComplete: boolean = false) => {
        const status = isComplete ? MessageBlockStatus.SUCCESS : MessageBlockStatus.STREAMING
        const changes: Partial<MessageBlock> = { content: accumulatedText, status: status } // Use Partial<MessageBlock>

        // Dispatch update to Redux store
        dispatch(updateOneBlock({ id: blockId, changes }))

        // Throttle update to DB
        throttledBlockDbUpdate(blockId, changes) // Use the throttled function

        // if (isComplete) {
        //   console.log(`[TranslationUpdater] Final update for block ${blockId}.`)
        //   // Ensure the throttled function flushes if needed, or call an immediate save
        //   // For simplicity, we rely on the throttle's trailing call for now.
        // }
      }
    },
    [dispatch, topic.id]
  )

  /**
   * 创建一个主题分支，克隆消息到新主题。
   * Creates a topic branch by cloning messages to a new topic.
   * @param sourceTopicId 源主题ID / Source topic ID
   * @param branchPointIndex 分支点索引，此索引之前的消息将被克隆 / Branch point index, messages before this index will be cloned
   * @param newTopic 新的主题对象，必须已经创建并添加到Redux store中 / New topic object, must be already created and added to Redux store
   * @returns 操作是否成功 / Whether the operation was successful
   */
  const createTopicBranch = useCallback(
    (sourceTopicId: string, branchPointIndex: number, newTopic: Topic) => {
      console.log(`Cloning messages from topic ${sourceTopicId} to new topic ${newTopic.id}`)
      return dispatch(cloneMessagesToNewTopicThunk(sourceTopicId, branchPointIndex, newTopic))
    },
    [dispatch]
  )

  return {
    displayCount,
    deleteMessage,
    deleteGroupMessages,
    editMessage,
    resendMessage,
    regenerateAssistantMessage,
    resendUserMessageWithEdit,
    appendAssistantResponse,
    createNewContext,
    clearTopicMessages,
    pauseMessages,
    resumeMessage,
    getTranslationUpdater,
    createTopicBranch
  }
}

export const useTopicMessages = (topic: Topic) => {
  const messages = useAppSelector((state) => selectMessagesForTopic(state, topic.id))
  return messages
}

export const useTopicLoading = (topic: Topic) => {
  const loading = useAppSelector((state) => selectNewTopicLoading(state, topic.id))
  return loading
}
