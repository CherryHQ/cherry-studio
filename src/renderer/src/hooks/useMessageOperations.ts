import { createSelector } from '@reduxjs/toolkit'
import Logger from '@renderer/config/logger'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { estimateUserPromptUsage } from '@renderer/services/TokenService'
import store, { type RootState, useAppDispatch, useAppSelector } from '@renderer/store'
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
  removeBlocksThunk,
  resendMessageThunk,
  resendUserMessageWithEditThunk,
  updateBlockThunk,
  updateMessageAndBlocksThunk
} from '@renderer/store/thunk/messageThunk'
import type { Assistant, LanguageCode, Model, Topic } from '@renderer/types'
import type { Message, MessageBlock } from '@renderer/types/newMessage'
import { MessageBlockStatus, MessageBlockType } from '@renderer/types/newMessage'
import { abortCompletion } from '@renderer/utils/abortController'
import { throttle } from 'lodash'
import { useCallback } from 'react'

import { TopicManager } from './useTopic'

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
    [dispatch, topic.id]
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
   * 编辑消息。 / Edits a message.
   * 使用 newMessagesActions.updateMessage.
   */
  const editMessage = useCallback(
    async (messageId: string, updates: Partial<Omit<Message, 'id' | 'topicId' | 'blocks'>>) => {
      if (!topic?.id) {
        console.error('[editMessage] Topic prop is not valid.')
        return
      }

      const messageUpdates: Partial<Message> & Pick<Message, 'id'> = {
        id: messageId,
        updatedAt: new Date().toISOString(),
        ...updates
      }

      // Call the thunk with topic.id and only message updates
      await dispatch(updateMessageAndBlocksThunk(topic.id, messageUpdates, []))
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
    [dispatch, topic.id]
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
    const state = store.getState()
    const topicMessages = selectMessagesForTopic(state, topic.id)
    if (!topicMessages) return

    const streamingMessages = topicMessages.filter((m) => m.status === 'processing' || m.status === 'pending')
    const askIds = [...new Set(streamingMessages?.map((m) => m.askId).filter((id) => !!id) as string[])]

    for (const askId of askIds) {
      abortCompletion(askId)
    }
    dispatch(newMessagesActions.setTopicLoading({ topicId: topic.id, loading: false }))
  }, [topic.id, dispatch])

  /**
   * 恢复/重发用户消息（目前复用 resendMessage 逻辑）。 / Resumes/Resends a user message (currently reuses resendMessage logic).
   */
  const resumeMessage = useCallback(
    async (message: Message, assistant: Assistant) => {
      return resendMessage(message, assistant)
    },
    [resendMessage]
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
    [dispatch, topic.id]
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
    [dispatch, topic.id]
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
      targetLanguage: LanguageCode,
      sourceBlockId?: string,
      sourceLanguage?: LanguageCode
    ): Promise<((accumulatedText: string, isComplete?: boolean) => void) | null> => {
      if (!topic.id) return null

      const state = store.getState()
      const message = state.messages.entities[messageId]
      if (!message) {
        console.error('[getTranslationUpdater] cannot find message:', messageId)
        return null
      }

      let existingTranslationBlockId: string | undefined
      if (message.blocks && message.blocks.length > 0) {
        for (const blockId of message.blocks) {
          const block = state.messageBlocks.entities[blockId]
          if (block && block.type === MessageBlockType.TRANSLATION) {
            existingTranslationBlockId = blockId
            break
          }
        }
      }

      let blockId: string | undefined
      if (existingTranslationBlockId) {
        blockId = existingTranslationBlockId
        const changes: Partial<MessageBlock> = {
          content: '',
          status: MessageBlockStatus.STREAMING,
          metadata: {
            targetLanguage,
            sourceBlockId,
            sourceLanguage
          }
        }
        dispatch(updateOneBlock({ id: blockId, changes }))
        await dispatch(updateBlockThunk(blockId, '', false))
      } else {
        blockId = await dispatch(
          initiateTranslationThunk(messageId, topic.id, targetLanguage, sourceBlockId, sourceLanguage)
        )
      }

      if (!blockId) {
        console.error('[getTranslationUpdater] Failed to create translation block.')
        return null
      }

      return throttle(
        (accumulatedText: string, isComplete: boolean = false) => {
          dispatch(updateBlockThunk(blockId!, accumulatedText, isComplete))
        },
        200,
        { leading: true, trailing: true }
      )
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
      Logger.log(`Cloning messages from topic ${sourceTopicId} to new topic ${newTopic.id}`)
      return dispatch(cloneMessagesToNewTopicThunk(sourceTopicId, branchPointIndex, newTopic))
    },
    [dispatch]
  )

  /**
   * Updates message blocks by comparing original and edited blocks.
   * Handles adding, updating, and removing blocks in a single operation.
   * @param messageId The ID of the message to update
   * @param editedBlocks The complete set of blocks after editing
   */
  const editMessageBlocks = useCallback(
    async (messageId: string, editedBlocks: MessageBlock[]) => {
      if (!topic?.id) {
        console.error('[editMessageBlocks] Topic prop is not valid.')
        return
      }

      try {
        // 1. Get the current state of the message and its blocks
        const state = store.getState()
        const message = state.messages.entities[messageId]
        if (!message) {
          console.error('[editMessageBlocks] Message not found:', messageId)
          return
        }

        // 2. Get all original blocks
        const originalBlocks = message.blocks
          ? (message.blocks
              .map((blockId) => state.messageBlocks.entities[blockId])
              .filter((block) => block !== undefined) as MessageBlock[])
          : []

        // 3. Create sets for efficient comparison
        const originalBlockIds = new Set(originalBlocks.map((block) => block.id))
        const editedBlockIds = new Set(editedBlocks.map((block) => block.id))

        // 4. Identify blocks to remove, update, and add
        const blockIdsToRemove = originalBlocks
          .filter((block) => !editedBlockIds.has(block.id))
          .map((block) => block.id)

        const blocksToUpdate = editedBlocks
          .filter((block) => originalBlockIds.has(block.id))
          .map((block) => ({
            ...block,
            updatedAt: new Date().toISOString()
          }))

        const blocksToAdd = editedBlocks
          .filter((block) => !originalBlockIds.has(block.id))
          .map((block) => ({
            ...block,
            updatedAt: new Date().toISOString()
          }))

        // 5. Prepare message update with new block IDs
        const updatedBlockIds = editedBlocks.map((block) => block.id)
        const messageUpdates: Partial<Message> & Pick<Message, 'id'> = {
          id: messageId,
          updatedAt: new Date().toISOString(),
          blocks: updatedBlockIds
        }

        // 6. Log operations for debugging
        // console.log('[editMessageBlocks] Operations:', {
        //   blocksToRemove: blockIdsToRemove.length,
        //   blocksToUpdate: blocksToUpdate.length,
        //   blocksToAdd: blocksToAdd.length
        // })

        // 7. Update Redux state and database
        // First update message and add/update blocks
        if (blocksToAdd.length > 0) {
          await dispatch(updateMessageAndBlocksThunk(topic.id, messageUpdates, blocksToAdd))
        }

        if (blocksToUpdate.length > 0) {
          await dispatch(updateMessageAndBlocksThunk(topic.id, messageUpdates, blocksToUpdate))
        }

        // Then remove blocks if needed
        if (blockIdsToRemove.length > 0) {
          await dispatch(removeBlocksThunk(topic.id, messageId, blockIdsToRemove))
        }
      } catch (error) {
        console.error('[editMessageBlocks] Failed to update message blocks:', error)
      }
    },
    [dispatch, topic?.id]
  )

  /**
   * 在用户消息的主文本块被编辑后重新发送该消息。 / Resends a user message after its main text block has been edited.
   * Dispatches resendUserMessageWithEditThunk.
   */
  const resendUserMessageWithEdit = useCallback(
    async (message: Message, editedBlocks: MessageBlock[], assistant: Assistant) => {
      await editMessageBlocks(message.id, editedBlocks)

      const mainTextBlock = editedBlocks.find((block) => block.type === MessageBlockType.MAIN_TEXT)
      if (!mainTextBlock) {
        console.error('[resendUserMessageWithEdit] Main text block not found in edited blocks')
        return
      }

      const fileBlocks = editedBlocks.filter(
        (block) => block.type === MessageBlockType.FILE || block.type === MessageBlockType.IMAGE
      )

      const files = fileBlocks.map((block) => block.file).filter((file) => file !== undefined)

      const usage = await estimateUserPromptUsage({ content: mainTextBlock.content, files })
      const messageUpdates: Partial<Message> & Pick<Message, 'id'> = {
        id: message.id,
        updatedAt: new Date().toISOString(),
        usage
      }

      await dispatch(
        newMessagesActions.updateMessage({ topicId: topic.id, messageId: message.id, updates: messageUpdates })
      )
      // 对于message的修改会在下面的thunk中保存
      await dispatch(resendUserMessageWithEditThunk(topic.id, message, assistant))
    },
    [dispatch, editMessageBlocks, topic.id]
  )

  /**
   * Removes a specific block from a message.
   */
  const removeMessageBlock = useCallback(
    async (messageId: string, blockIdToRemove: string) => {
      if (!topic?.id) {
        console.error('[removeMessageBlock] Topic prop is not valid.')
        return
      }

      const state = store.getState()
      const message = state.messages.entities[messageId]
      if (!message || !message.blocks) {
        console.error('[removeMessageBlock] Message not found or has no blocks:', messageId)
        return
      }

      const updatedBlocks = message.blocks.filter((blockId) => blockId !== blockIdToRemove)

      const messageUpdates: Partial<Message> & Pick<Message, 'id'> = {
        id: messageId,
        updatedAt: new Date().toISOString(),
        blocks: updatedBlocks
      }

      await dispatch(updateMessageAndBlocksThunk(topic.id, messageUpdates, []))
    },
    [dispatch, topic?.id]
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
    createTopicBranch,
    editMessageBlocks,
    removeMessageBlock
  }
}

export const useTopicMessages = (topicId: string) => {
  return useAppSelector((state) => selectMessagesForTopic(state, topicId))
}

export const useTopicLoading = (topic: Topic) => {
  return useAppSelector((state) => selectNewTopicLoading(state, topic.id))
}

export const getTopicByMessageId = async (messageId: string) => {
  const state = store.getState()
  const message = state.messages.entities[messageId]
  if (!message) {
    return null
  }
  const topicId = message.topicId
  console.log('[getTopicByMessageId] topicId', topicId)
  const topic = await TopicManager.getTopic(topicId)
  if (!topic) {
    return null
  }
  return topic
}
