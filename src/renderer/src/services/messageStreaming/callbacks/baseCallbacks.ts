/**
 * @fileoverview Base callbacks for streaming message processing
 *
 * This module provides the core callback handlers for message streaming:
 * - onLLMResponseCreated: Initialize placeholder block for incoming response
 * - onError: Handle streaming errors and cleanup
 * - onComplete: Finalize streaming and persist to database
 *
 * ARCHITECTURE NOTE:
 * These callbacks now use StreamingService for state management instead of Redux dispatch.
 * This is part of the v2 data refactoring to use CacheService + Data API.
 *
 * Key changes:
 * - dispatch/getState replaced with streamingService methods
 * - saveUpdatesToDB replaced with streamingService.finalize()
 */

import { loggerService } from '@logger'
import { autoRenameTopic } from '@renderer/hooks/useTopic'
import i18n from '@renderer/i18n'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { NotificationService } from '@renderer/services/NotificationService'
import { estimateMessagesUsage } from '@renderer/services/TokenService'
import type { Assistant } from '@renderer/types'
import type { PlaceholderMessageBlock, Response, ThinkingMessageBlock } from '@renderer/types/newMessage'
import { AssistantMessageStatus, MessageBlockStatus, MessageBlockType } from '@renderer/types/newMessage'
import { uuid } from '@renderer/utils'
import { isAbortError, serializeError } from '@renderer/utils/error'
import { createBaseMessageBlock, createErrorBlock } from '@renderer/utils/messageUtils/create'
import { findAllBlocks, getMainTextContent } from '@renderer/utils/messageUtils/find'
import { isFocused, isOnHomePage } from '@renderer/utils/window'
import type { AISDKError } from 'ai'
import { NoOutputGeneratedError } from 'ai'

import type { BlockManager } from '../BlockManager'
import { streamingService } from '../StreamingService'

const logger = loggerService.withContext('BaseCallbacks')

/**
 * Dependencies required for base callbacks
 *
 * NOTE: Simplified from original design - removed dispatch, getState, and saveUpdatesToDB
 * since StreamingService now handles state management and persistence.
 */
interface BaseCallbacksDependencies {
  blockManager: BlockManager
  topicId: string
  assistantMsgId: string
  assistant: Assistant
  getCurrentThinkingInfo?: () => { blockId: string | null; millsec: number }
}

export const createBaseCallbacks = (deps: BaseCallbacksDependencies) => {
  const { blockManager, topicId, assistantMsgId, assistant, getCurrentThinkingInfo } = deps

  const startTime = Date.now()
  const notificationService = NotificationService.getInstance()

  /**
   * Find the block ID that should receive completion updates.
   * Priority: active block > latest block in message > initial placeholder
   */
  const findBlockIdForCompletion = () => {
    // Priority 1: Use active block from BlockManager
    const activeBlockInfo = blockManager.activeBlockInfo
    if (activeBlockInfo) {
      return activeBlockInfo.id
    }

    // Priority 2: Find latest block from StreamingService message
    const message = streamingService.getMessage(assistantMsgId)
    if (message) {
      const allBlocks = findAllBlocks(message)
      if (allBlocks.length > 0) {
        return allBlocks[allBlocks.length - 1].id
      }
    }

    // Priority 3: Initial placeholder block
    return blockManager.initialPlaceholderBlockId
  }

  return {
    /**
     * Called when LLM response stream is created.
     * Creates an initial placeholder block to receive streaming content.
     */
    onLLMResponseCreated: async () => {
      const baseBlock = createBaseMessageBlock(assistantMsgId, MessageBlockType.UNKNOWN, {
        status: MessageBlockStatus.PROCESSING
      })
      await blockManager.handleBlockTransition(baseBlock as PlaceholderMessageBlock, MessageBlockType.UNKNOWN)
    },

    /**
     * Called when an error occurs during streaming.
     * Updates block and message status, creates error block, and finalizes session.
     */
    onError: async (error: AISDKError) => {
      logger.debug('onError', error)
      if (NoOutputGeneratedError.isInstance(error)) {
        return
      }
      const isErrorTypeAbort = isAbortError(error)
      const serializableError = serializeError(error)
      if (isErrorTypeAbort) {
        serializableError.message = 'pause_placeholder'
      }

      const duration = Date.now() - startTime

      // Send error notification (except for abort errors)
      if (!isErrorTypeAbort) {
        const timeOut = duration > 30 * 1000
        if ((!isOnHomePage() && timeOut) || (!isFocused() && timeOut)) {
          await notificationService.send({
            id: uuid(),
            type: 'error',
            title: i18n.t('notification.assistant'),
            message: serializableError.message ?? '',
            silent: false,
            timestamp: Date.now(),
            source: 'assistant'
          })
        }
      }

      const possibleBlockId = findBlockIdForCompletion()

      if (possibleBlockId) {
        // Update previous block status to ERROR/PAUSED/PAUSED
        const changes: Partial<ThinkingMessageBlock> = {
          status: isErrorTypeAbort ? MessageBlockStatus.PAUSED : MessageBlockStatus.ERROR
        }
        // 如果是 thinking block，保留实际思考时间
        if (blockManager.lastBlockType === MessageBlockType.THINKING) {
          const thinkingInfo = getCurrentThinkingInfo?.()
          if (thinkingInfo?.blockId === possibleBlockId && thinkingInfo?.millsec && thinkingInfo.millsec > 0) {
            changes.thinking_millsec = thinkingInfo.millsec
          }
        }
        blockManager.smartBlockUpdate(possibleBlockId, changes, blockManager.lastBlockType!, true)
      }

      // Fix: Update all blocks still in STREAMING status to PAUSED/ERROR
      // This fixes the thinking timer continuing when response is stopped
      const currentMessage = streamingService.getMessage(assistantMsgId)
      if (currentMessage) {
        const allBlockRefs = findAllBlocks(currentMessage)
        // 获取当前思考信息（如果有），用于保留实际思考时间
        const thinkingInfo = getCurrentThinkingInfo?.()
        for (const blockRef of allBlockRefs) {
          const block = streamingService.getBlock(blockRef.id)
          if (block && block.status === MessageBlockStatus.STREAMING && block.id !== possibleBlockId) {
            // 构建更新对象
            const changes: Partial<ThinkingMessageBlock> = {
              status: isErrorTypeAbort ? MessageBlockStatus.PAUSED : MessageBlockStatus.ERROR
            }
            // 如果是 thinking block 且有思考时间信息，保留实际思考时间
            if (
              block.type === MessageBlockType.THINKING &&
              thinkingInfo?.blockId === block.id &&
              thinkingInfo?.millsec &&
              thinkingInfo.millsec > 0
            ) {
              changes.thinking_millsec = thinkingInfo.millsec
            }
            streamingService.updateBlock(block.id, changes)
          }
        }
      }

      // Create error block
      const errorBlock = createErrorBlock(assistantMsgId, serializableError, { status: MessageBlockStatus.SUCCESS })
      await blockManager.handleBlockTransition(errorBlock, MessageBlockType.ERROR)

      // Finalize session with error/success status
      const finalStatus = isErrorTypeAbort ? AssistantMessageStatus.SUCCESS : AssistantMessageStatus.ERROR
      await streamingService.finalize(assistantMsgId, finalStatus)

      EventEmitter.emit(EVENT_NAMES.MESSAGE_COMPLETE, {
        id: assistantMsgId,
        topicId,
        status: isErrorTypeAbort ? 'pause' : 'error',
        error: error.message
      })
    },

    /**
     * Called when streaming completes successfully.
     * Updates block status, processes usage stats, and finalizes session.
     */
    onComplete: async (status: AssistantMessageStatus, response?: Response) => {
      const finalAssistantMsg = streamingService.getMessage(assistantMsgId)

      if (status === 'success' && finalAssistantMsg) {
        const possibleBlockId = findBlockIdForCompletion()

        if (possibleBlockId) {
          const changes = {
            status: MessageBlockStatus.SUCCESS
          }
          blockManager.smartBlockUpdate(possibleBlockId, changes, blockManager.lastBlockType!, true)
        }

        const duration = Date.now() - startTime
        const content = getMainTextContent(finalAssistantMsg)

        const timeOut = duration > 30 * 1000
        // Send success notification for long-running messages
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

        // Rename topic if needed
        autoRenameTopic(assistant, topicId)

        // Process usage estimation
        // For OpenRouter, always use the accurate usage data from API, don't estimate
        const isOpenRouter = assistant.model?.provider === 'openrouter'
        if (
          !isOpenRouter &&
          response &&
          (response.usage?.total_tokens === 0 ||
            response?.usage?.prompt_tokens === 0 ||
            response?.usage?.completion_tokens === 0)
        ) {
          // Use context from task for usage estimation
          const task = streamingService.getTask(assistantMsgId)
          if (task?.contextMessages && task.contextMessages.length > 0) {
            // Include the final assistant message in context for accurate estimation
            const finalContextWithAssistant = [...task.contextMessages, finalAssistantMsg]
            const usage = await estimateMessagesUsage({ assistant, messages: finalContextWithAssistant })
            response.usage = usage
          } else {
            logger.debug('Skipping usage estimation - contextMessages not available in task')
          }
        }
      }

      // Handle metrics completion_tokens fallback
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

      // Update message with final stats before finalize
      if (response) {
        streamingService.updateMessage(assistantMsgId, {
          metrics: response.metrics,
          usage: response.usage
        })
      }

      // Finalize session and persist to database
      await streamingService.finalize(assistantMsgId, status)

      // Track token usage analytics
      const provider = assistant?.model?.provider
      const model = assistant?.model?.id
      if (status === 'success' && response?.usage && provider && model) {
        const { prompt_tokens, completion_tokens } = response.usage
        if (prompt_tokens > 0 || completion_tokens > 0) {
          window.api.analytics.trackTokenUsage({
            provider,
            model,
            input_tokens: prompt_tokens || 0,
            output_tokens: completion_tokens || 0
          })
        }
      }

      EventEmitter.emit(EVENT_NAMES.MESSAGE_COMPLETE, { id: assistantMsgId, topicId, status })
      logger.debug('onComplete finished')
    }
  }
}
