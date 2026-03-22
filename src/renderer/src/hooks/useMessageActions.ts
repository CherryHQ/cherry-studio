import { loggerService } from '@logger'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { appendMessageTrace, pauseTrace, restartTrace } from '@renderer/services/SpanManagerService'
import { estimateUserPromptUsage } from '@renderer/services/TokenService'
import store, { useAppDispatch } from '@renderer/store'
import { newMessagesActions, selectMessagesForTopic } from '@renderer/store/newMessage'
import {
  appendAssistantResponseThunk,
  clearTopicMessagesThunk,
  regenerateAssistantResponseThunk,
  resendMessageThunk,
  resendUserMessageWithEditThunk
} from '@renderer/store/thunk/messageThunk'
import type { Assistant, Model } from '@renderer/types'
import type { Message, MessageBlock } from '@renderer/types/newMessage'
import { MessageBlockType } from '@renderer/types/newMessage'
import { abortCompletion } from '@renderer/utils/abortController'
import { useCallback } from 'react'

const logger = loggerService.withContext('UseMessageActions')

/**
 * Hook 提供消息的各种操作（发送、重发、重新生成等）
 * @param topicId 主题ID
 * @param editMessageBlocks 编辑消息块的函数
 */
export function useMessageActions(
  topicId: string,
  editMessageBlocks: (messageId: string, editedBlocks: MessageBlock[]) => Promise<void>
) {
  const dispatch = useAppDispatch()

  /**
   * 重新发送用户消息，触发其所有助手回复的重新生成。 / Resends a user message, triggering regeneration of all its assistant responses.
   * Dispatches resendMessageThunk.
   */
  const resendMessage = useCallback(
    async (message: Message, assistant: Assistant) => {
      await restartTrace(message)
      await dispatch(resendMessageThunk(topicId, message, assistant))
    },
    [dispatch, topicId]
  )

  /**
   * 清除当前或指定主题的所有消息。 / Clears all messages for the current or specified topic.
   * Dispatches clearTopicMessagesThunk.
   */
  const clearTopicMessages = useCallback(
    async (_topicId?: string) => {
      const topicIdToClear = _topicId || topicId
      await dispatch(clearTopicMessagesThunk(topicIdToClear))
    },
    [dispatch, topicId]
  )

  /**
   * 发出事件以表示创建新上下文（清空消息 UI）。 / Emits an event to signal creating a new context (clearing messages UI).
   */
  const createNewContext = useCallback(async () => {
    EventEmitter.emit(EVENT_NAMES.NEW_CONTEXT)
  }, [])

  /**
   * 暂停当前主题正在进行的消息生成。 / Pauses ongoing message generation for the current topic.
   */
  const pauseMessages = useCallback(async () => {
    const state = store.getState()
    const topicMessages = selectMessagesForTopic(state, topicId)
    if (!topicMessages) return

    const streamingMessages = topicMessages.filter((m) => m.status === 'processing' || m.status === 'pending')
    const askIds = [...new Set(streamingMessages?.map((m) => m.askId).filter((id) => !!id) as string[])]

    for (const askId of askIds) {
      abortCompletion(askId)
    }
    pauseTrace(topicId)
    dispatch(newMessagesActions.setTopicLoading({ topicId: topicId, loading: false }))
  }, [topicId, dispatch])

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
      await restartTrace(message)
      if (message.role !== 'assistant') {
        logger.warn('regenerateAssistantMessage should only be called for assistant messages.')
        return
      }
      await dispatch(regenerateAssistantResponseThunk(topicId, message, assistant))
    },
    [dispatch, topicId]
  )

  /**
   * 使用指定模型追加一个新的助手回复，回复与现有助手消息相同的用户查询。 / Appends a new assistant response using a specified model, replying to the same user query as an existing assistant message.
   * Dispatches appendAssistantResponseThunk.
   */
  const appendAssistantResponse = useCallback(
    async (existingAssistantMessage: Message, newModel: Model, assistant: Assistant) => {
      await appendMessageTrace(existingAssistantMessage, newModel)
      if (existingAssistantMessage.role !== 'assistant') {
        logger.error('appendAssistantResponse should only be called for an existing assistant message.')
        return
      }
      if (!existingAssistantMessage.askId) {
        logger.error('Cannot append response: The existing assistant message is missing its askId.')
        return
      }
      await dispatch(
        appendAssistantResponseThunk(
          topicId,
          existingAssistantMessage.id,
          newModel,
          assistant,
          existingAssistantMessage.traceId
        )
      )
    },
    [dispatch, topicId]
  )

  /**
   * 编辑后重新发送用户消息。 / Edits and resends a user message.
   * Dispatches resendUserMessageWithEditThunk.
   */
  const resendUserMessageWithEdit = useCallback(
    async (message: Message, editedBlocks: MessageBlock[], assistant: Assistant) => {
      await editMessageBlocks(message.id, editedBlocks)

      const mainTextBlock = editedBlocks.find((block) => block.type === MessageBlockType.MAIN_TEXT)
      if (!mainTextBlock) {
        logger.error('[resendUserMessageWithEdit] Main text block not found in edited blocks')
        return
      }

      await restartTrace(message, mainTextBlock.content)

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
        newMessagesActions.updateMessage({ topicId: topicId, messageId: message.id, updates: messageUpdates })
      )
      await dispatch(resendUserMessageWithEditThunk(topicId, message, assistant))
    },
    [dispatch, editMessageBlocks, topicId]
  )

  return {
    resendMessage,
    clearTopicMessages,
    createNewContext,
    pauseMessages,
    resumeMessage,
    regenerateAssistantMessage,
    appendAssistantResponse,
    resendUserMessageWithEdit
  }
}
