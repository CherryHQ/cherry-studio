import { loggerService } from '@logger'
import { createSelector } from '@reduxjs/toolkit'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import store, { type RootState, useAppDispatch, useAppSelector } from '@renderer/store'
import { updateOneBlock } from '@renderer/store/messageBlock'
import { selectMessagesForTopic } from '@renderer/store/newMessage'
import {
  cloneMessagesToNewTopicThunk,
  initiateTranslationThunk,
  updateMessageAndBlocksThunk,
  updateTranslationBlockThunk
} from '@renderer/store/thunk/messageThunk'
import { type Assistant, type Model, objectKeys, type Topic, type TranslateLanguageCode } from '@renderer/types'
import type { Message, MessageBlock } from '@renderer/types/newMessage'
import { AssistantMessageStatus, MessageBlockStatus, MessageBlockType } from '@renderer/types/newMessage'
import type { CherryMessagePart } from '@shared/data/types/message'
import { difference, throttle } from 'lodash'
import { createContext, use, useCallback } from 'react'

/** AI SDK useChat status — V2 single source of truth for request state. */
export type RequestStatus = 'submitted' | 'streaming' | 'ready' | 'error'

/**
 * V2 chat overrides injected via React Context.
 * When present, operations delegate to DataApi + useAiChat
 * instead of Redux thunks.
 */
export interface V2ChatOverrides {
  regenerate: (messageId?: string) => Promise<void>
  resend: (messageId?: string) => Promise<void>
  /** Delete a single message. cascade=false reparents children to grandparent. */
  deleteMessage: (id: string) => Promise<void>
  /** Delete a message and all its descendants (cascade). */
  deleteMessageGroup: (id: string) => Promise<void>
  /** Stop the current streaming response. */
  pause: () => void
  /** Clear all messages for the current topic. */
  clearTopicMessages: () => Promise<void>
  /** Edit a message's content (update parts via DataApi). */
  editMessage: (messageId: string, editedParts: CherryMessagePart[]) => Promise<void>
  /** Raw AI SDK chat status. Single source of truth for request state. */
  requestStatus: RequestStatus
  refresh: () => Promise<unknown>
}

const V2ChatOverridesContext = createContext<V2ChatOverrides | null>(null)

/**
 * Provider that injects V2 chat operation overrides into the component tree.
 * Wrap V2ChatContent's children with this so that useMessageOperations
 * can detect V2 mode and delegate accordingly.
 */
export const V2ChatOverridesProvider = V2ChatOverridesContext.Provider

const logger = loggerService.withContext('UseMessageOperations')

const selectMessagesState = (state: RootState) => state.messages

export const selectNewTopicLoading = createSelector(
  [selectMessagesState, selectMessagesForTopic, (_, topicId: string) => topicId],
  (messagesState, topicMessages, topicId) => {
    const topicFlag = messagesState.loadingByTopic[topicId] || false
    const hasActiveAssistantMessage = topicMessages.some(
      (message) =>
        message.role === 'assistant' &&
        [AssistantMessageStatus.PENDING, AssistantMessageStatus.PROCESSING, AssistantMessageStatus.SEARCHING].includes(
          message.status as AssistantMessageStatus
        )
    )

    return topicFlag || hasActiveAssistantMessage
  }
)

const DEFAULT_DISPLAY_COUNT = 10

/**
 * Hook 提供针对特定主题的消息操作方法。 / Hook providing various operations for messages within a specific topic.
 * @param topic 当前主题对象。 / The current topic object.
 * @returns 包含消息操作函数的对象。 / An object containing message operation functions.
 */
export function useMessageOperations(topic: Topic) {
  const dispatch = useAppDispatch()
  const v2 = use(V2ChatOverridesContext)

  /**
   * 删除单个消息。 / Deletes a single message.
   * V2: DataApi DELETE; V1: Redux thunk.
   */
  const deleteMessage = useCallback(
    async (id: string, traceId?: string, modelName?: string) => {
      await v2?.deleteMessage(id)
      void window.api.trace.cleanHistory(topic.id, traceId || '', modelName)
    },
    [topic.id, v2]
  )

  /**
   * 删除一组消息（基于 askId）。 / Deletes a group of messages (based on askId).
   * V2: DataApi DELETE; V1: Redux thunk.
   */
  const deleteGroupMessages = useCallback(
    async (askId: string) => {
      // In V2, askId is the user message ID (parentId of assistant messages).
      // Cascade-deleting the user message removes the entire exchange.
      await v2?.deleteMessageGroup(askId)
    },
    [v2]
  )

  /**
   * 编辑消息。 / Edits a message.
   */
  const editMessage = useCallback(
    async (messageId: string, updates: Partial<Omit<Message, 'id' | 'topicId' | 'blocks'>>) => {
      if (!topic?.id) {
        logger.error('[editMessage] Topic prop is not valid.')
        return
      }
      const uiStates = ['multiModelMessageStyle', 'foldSelected'] as const satisfies (keyof Message)[]
      const extraUpdate = difference(objectKeys(updates), uiStates)
      const isUiUpdateOnly = extraUpdate.length === 0
      const messageUpdates: Partial<Message> & Pick<Message, 'id'> = {
        id: messageId,
        updatedAt: isUiUpdateOnly ? undefined : new Date().toISOString(),
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
    async (message: Message, _assistant: Assistant) => {
      logger.info('[resendMessage] delegating to useAiChat.resend')
      await v2?.resend(message.id)
    },
    [v2]
  )

  /**
   * 清除当前或指定主题的所有消息。 / Clears all messages for the current or specified topic.
   * Dispatches clearTopicMessagesThunk.
   */
  const clearTopicMessages = useCallback(async () => {
    await v2?.clearTopicMessages()
  }, [v2])

  /**
   * 发出事件以表示创建新上下文（清空消息 UI）。 / Emits an event to signal creating a new context (clearing messages UI).
   */
  const createNewContext = useCallback(async () => {
    void EventEmitter.emit(EVENT_NAMES.NEW_CONTEXT)
  }, [])

  const displayCount = DEFAULT_DISPLAY_COUNT

  /**
   * 暂停当前主题正在进行的消息生成。 / Pauses ongoing message generation for the current topic.
   */
  const pauseMessages = useCallback(() => {
    v2?.pause()
  }, [v2])

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
    async (message: Message, _assistant: Assistant) => {
      logger.info('[regenerateAssistantMessage] delegating to useAiChat.regenerate')
      await v2?.regenerate(message.id)
    },
    [v2]
  )

  /**
   * 使用指定模型追加一个新的助手回复，回复与现有助手消息相同的用户查询。 / Appends a new assistant response using a specified model, replying to the same user query as an existing assistant message.
   * Dispatches appendAssistantResponseThunk.
   */
  const appendAssistantResponse = useCallback(
    async (existingAssistantMessage: Message, newModel: Model, _assistant: Assistant) => {
      logger.warn('[appendAssistantResponse] Not yet supported in V2.', {
        topicId: topic.id,
        messageId: existingAssistantMessage.id,
        modelId: newModel.id
      })
    },
    [topic.id]
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
      targetLanguage: TranslateLanguageCode,
      sourceBlockId?: string,
      sourceLanguage?: TranslateLanguageCode
    ): Promise<((accumulatedText: string, isComplete?: boolean) => void) | null> => {
      if (!topic.id) return null

      if (v2) {
        logger.warn(
          '[getTranslationUpdater] V2 translation writes are disabled until DataApi semantics are finalized.',
          {
            topicId: topic.id,
            messageId,
            targetLanguage
          }
        )
        return null
      }

      const state = store.getState()
      const message = state.messages.entities[messageId]
      if (!message) {
        logger.error(`[getTranslationUpdater] cannot find message: ${messageId}`)
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
        await dispatch(updateTranslationBlockThunk(blockId, '', false))
      } else {
        blockId = await dispatch(
          initiateTranslationThunk(messageId, topic.id, targetLanguage, sourceBlockId, sourceLanguage)
        )
      }

      if (!blockId) {
        logger.error('[getTranslationUpdater] Failed to create translation block.')
        return null
      }

      return throttle(
        (accumulatedText: string, isComplete: boolean = false) => {
          void dispatch(updateTranslationBlockThunk(blockId, accumulatedText, isComplete))
        },
        200,
        { leading: true, trailing: true }
      )
    },
    [dispatch, topic.id, v2]
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
      logger.info(`Cloning messages from topic ${sourceTopicId} to new topic ${newTopic.id}`)
      return dispatch(cloneMessagesToNewTopicThunk(sourceTopicId, branchPointIndex, newTopic))
    },
    [dispatch]
  )

  /**
   * Removes a specific block from a message.
   */
  const removeMessageBlock = useCallback(
    async (messageId: string, blockIdToRemove: string) => {
      if (!topic?.id) {
        logger.error('[removeMessageBlock] Topic prop is not valid.')
        return
      }

      const state = store.getState()
      const message = state.messages.entities[messageId]
      if (!message || !message.blocks) {
        logger.error(`[removeMessageBlock] Message not found or has no blocks: ${messageId}`)
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

  /**
   * Edit a message's parts directly (V2 only).
   * Skips block→part conversion by sending CherryMessagePart[] directly to the V2 API.
   * Falls back to no-op if not in V2 mode.
   */
  const editMessageParts = useCallback(
    async (messageId: string, editedParts: CherryMessagePart[]) => {
      if (!v2) {
        logger.warn('[editMessageParts] Called outside V2 mode — no-op')
        return
      }
      await v2.editMessage(messageId, editedParts)
    },
    [v2]
  )

  /**
   * Resend a user message with edited parts (V2 only).
   * Persists the edited parts then triggers a resend.
   * Falls back to no-op if not in V2 mode.
   */
  const resendUserMessageWithEditParts = useCallback(
    async (message: Message, editedParts: CherryMessagePart[]) => {
      if (!v2) {
        logger.warn('[resendUserMessageWithEditParts] Called outside V2 mode — no-op')
        return
      }
      await v2.editMessage(message.id, editedParts)
      await v2.resend(message.id)
    },
    [v2]
  )

  return {
    displayCount,
    deleteMessage,
    deleteGroupMessages,
    editMessage,
    resendMessage,
    regenerateAssistantMessage,
    appendAssistantResponse,
    createNewContext,
    clearTopicMessages,
    pauseMessages,
    resumeMessage,
    getTranslationUpdater,
    createTopicBranch,
    editMessageParts,
    resendUserMessageWithEditParts,
    removeMessageBlock
  }
}

export const useTopicMessages = (topicId: string) => {
  return useAppSelector((state) => selectMessagesForTopic(state, topicId))
}

export const useTopicLoading = (): boolean => {
  const v2 = use(V2ChatOverridesContext)
  if (!v2) return false
  return v2.requestStatus === 'submitted' || v2.requestStatus === 'streaming'
}

export const useRequestStatus = (): RequestStatus | undefined => {
  const v2 = use(V2ChatOverridesContext)
  return v2?.requestStatus
}
