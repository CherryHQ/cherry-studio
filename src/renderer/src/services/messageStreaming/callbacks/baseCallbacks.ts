import { loggerService } from '@logger'
import { autoRenameTopic } from '@renderer/hooks/useTopic'
import i18n from '@renderer/i18n'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { NotificationService } from '@renderer/services/NotificationService'
import { estimateMessagesUsage } from '@renderer/services/TokenService'
import { selectMessagesForTopic } from '@renderer/store/newMessage'
import { newMessagesActions } from '@renderer/store/newMessage'
import type { Assistant } from '@renderer/types'
import type { Response } from '@renderer/types/newMessage'
import {
  AssistantMessageStatus,
  MessageBlockStatus,
  MessageBlockType,
  PlaceholderMessageBlock
} from '@renderer/types/newMessage'
import { uuid } from '@renderer/utils'
import { formatErrorMessage, isAbortError } from '@renderer/utils/error'
import { createBaseMessageBlock, createErrorBlock } from '@renderer/utils/messageUtils/create'
import { findAllBlocks, getMainTextContent } from '@renderer/utils/messageUtils/find'
import { isFocused, isOnHomePage } from '@renderer/utils/window'

import { BlockManager } from '../BlockManager'

const logger = loggerService.withContext('BaseCallbacks')
interface BaseCallbacksDependencies {
  blockManager: BlockManager
  dispatch: any
  getState: any
  topicId: string
  assistantMsgId: string
  saveUpdatesToDB: any
  assistant: Assistant
}

export const createBaseCallbacks = (deps: BaseCallbacksDependencies) => {
  const { blockManager, dispatch, getState, topicId, assistantMsgId, saveUpdatesToDB, assistant } = deps

  const startTime = Date.now()
  const notificationService = NotificationService.getInstance()

  // 通用的 block 查找函数
  const findBlockIdForCompletion = (message?: any) => {
    // 优先使用 BlockManager 中的 activeBlockInfo
    const activeBlockInfo = blockManager.activeBlockInfo

    if (activeBlockInfo) {
      return activeBlockInfo.id
    }

    // 如果没有活跃的block，从message中查找最新的block作为备选
    const targetMessage = message || getState().messages.entities[assistantMsgId]
    if (targetMessage) {
      const allBlocks = findAllBlocks(targetMessage)
      if (allBlocks.length > 0) {
        return allBlocks[allBlocks.length - 1].id // 返回最新的block
      }
    }

    // 最后的备选方案：从 blockManager 获取占位符块ID
    return blockManager.initialPlaceholderBlockId
  }

  return {
    onLLMResponseCreated: async () => {
      const baseBlock = createBaseMessageBlock(assistantMsgId, MessageBlockType.UNKNOWN, {
        status: MessageBlockStatus.PROCESSING
      })
      await blockManager.handleBlockTransition(baseBlock as PlaceholderMessageBlock, MessageBlockType.UNKNOWN)
    },

    onError: async (error: any) => {
      logger.debug('onError', error)
      const isErrorTypeAbort = isAbortError(error)
      let pauseErrorLanguagePlaceholder = ''
      if (isErrorTypeAbort) {
        pauseErrorLanguagePlaceholder = 'pause_placeholder'
      }

      const serializableError = {
        name: error.name,
        message: pauseErrorLanguagePlaceholder || error.message || formatErrorMessage(error),
        originalMessage: error.message,
        stack: error.stack,
        status: error.status || error.code,
        requestId: error.request_id
      }

      const duration = Date.now() - startTime
      // 发送错误通知（除了中止错误）
      if (!isErrorTypeAbort) {
        const timeOut = duration > 30 * 1000
        if ((!isOnHomePage() && timeOut) || (!isFocused() && timeOut)) {
          await notificationService.send({
            id: uuid(),
            type: 'error',
            title: i18n.t('notification.assistant'),
            message: serializableError.message,
            silent: false,
            timestamp: Date.now(),
            source: 'assistant'
          })
        }
      }

      const possibleBlockId = findBlockIdForCompletion()

      if (possibleBlockId) {
        // 更改上一个block的状态为ERROR
        const changes = {
          status: isErrorTypeAbort ? MessageBlockStatus.PAUSED : MessageBlockStatus.ERROR
        }
        blockManager.smartBlockUpdate(possibleBlockId, changes, blockManager.lastBlockType!, true)
      }

      const errorBlock = createErrorBlock(assistantMsgId, serializableError, { status: MessageBlockStatus.SUCCESS })
      await blockManager.handleBlockTransition(errorBlock, MessageBlockType.ERROR)
      const messageErrorUpdate = {
        status: isErrorTypeAbort ? AssistantMessageStatus.SUCCESS : AssistantMessageStatus.ERROR
      }
      dispatch(
        newMessagesActions.updateMessage({
          topicId,
          messageId: assistantMsgId,
          updates: messageErrorUpdate
        })
      )
      await saveUpdatesToDB(assistantMsgId, topicId, messageErrorUpdate, [])

      EventEmitter.emit(EVENT_NAMES.MESSAGE_COMPLETE, {
        id: assistantMsgId,
        topicId,
        status: isErrorTypeAbort ? 'pause' : 'error',
        error: error.message
      })
    },

    onComplete: async (status: AssistantMessageStatus, response?: Response) => {
      const finalStateOnComplete = getState()
      const finalAssistantMsg = finalStateOnComplete.messages.entities[assistantMsgId]

      if (status === 'success' && finalAssistantMsg) {
        const userMsgId = finalAssistantMsg.askId
        const orderedMsgs = selectMessagesForTopic(finalStateOnComplete, topicId)
        const userMsgIndex = orderedMsgs.findIndex((m) => m.id === userMsgId)
        const contextForUsage = userMsgIndex !== -1 ? orderedMsgs.slice(0, userMsgIndex + 1) : []
        const finalContextWithAssistant = [...contextForUsage, finalAssistantMsg]

        const possibleBlockId = findBlockIdForCompletion(finalAssistantMsg)

        if (possibleBlockId) {
          const changes = {
            status: MessageBlockStatus.SUCCESS
          }
          blockManager.smartBlockUpdate(possibleBlockId, changes, blockManager.lastBlockType!, true)
        }

        const duration = Date.now() - startTime
        const content = getMainTextContent(finalAssistantMsg)

        const timeOut = duration > 30 * 1000
        // 发送长时间运行消息的成功通知
        if ((!isOnHomePage() && timeOut) || (!isFocused() && timeOut)) {
          await notificationService.send({
            id: uuid(),
            type: 'success',
            title: i18n.t('notification.assistant'),
            message: content.length > 50 ? content.slice(0, 47) + '...' : content,
            silent: false,
            timestamp: Date.now(),
            source: 'assistant',
            channel: 'system'
          })
        }

        // 更新topic的name
        autoRenameTopic(assistant, topicId)

        // 处理usage估算
        // For OpenRouter, always use the accurate usage data from API, don't estimate
        const isOpenRouter = assistant.model?.provider === 'openrouter'
        if (
          !isOpenRouter &&
          response &&
          (response.usage?.total_tokens === 0 ||
            response?.usage?.prompt_tokens === 0 ||
            response?.usage?.completion_tokens === 0)
        ) {
          const usage = await estimateMessagesUsage({ assistant, messages: finalContextWithAssistant })
          response.usage = usage
        }
      }

      if (response && response.metrics) {
        if (response.metrics.completion_tokens === 0 && response.usage?.completion_tokens) {
          response = {
            ...response,
            metrics: {
              ...response.metrics,
              completion_tokens: response.usage.completion_tokens
            }
          }
        }
      }

      const messageUpdates = { status, metrics: response?.metrics, usage: response?.usage }
      dispatch(
        newMessagesActions.updateMessage({
          topicId,
          messageId: assistantMsgId,
          updates: messageUpdates
        })
      )
      await saveUpdatesToDB(assistantMsgId, topicId, messageUpdates, [])
      EventEmitter.emit(EVENT_NAMES.MESSAGE_COMPLETE, { id: assistantMsgId, topicId, status })
      logger.debug('onComplete finished')
    }
  }
}
