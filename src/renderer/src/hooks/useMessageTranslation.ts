import { loggerService } from '@logger'
import store, { useAppDispatch } from '@renderer/store'
import { updateOneBlock } from '@renderer/store/messageBlock'
import { initiateTranslationThunk, updateTranslationBlockThunk } from '@renderer/store/thunk/messageThunk'
import type { TranslateLanguageCode } from '@renderer/types'
import type { MessageBlock } from '@renderer/types/newMessage'
import { MessageBlockStatus, MessageBlockType } from '@renderer/types/newMessage'
import throttle from 'lodash/throttle'
import { useCallback } from 'react'

const logger = loggerService.withContext('UseMessageTranslation')

/**
 * Hook 提供消息翻译相关操作
 * @param topicId 主题ID
 */
export function useMessageTranslation(topicId: string) {
  const dispatch = useAppDispatch()

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
      if (!topicId) return null

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
          initiateTranslationThunk(messageId, topicId, targetLanguage, sourceBlockId, sourceLanguage)
        )
      }

      if (!blockId) {
        logger.error('[getTranslationUpdater] Failed to create translation block.')
        return null
      }

      return throttle(
        (accumulatedText: string, isComplete: boolean = false) => {
          dispatch(updateTranslationBlockThunk(blockId!, accumulatedText, isComplete))
        },
        200,
        { leading: true, trailing: true }
      )
    },
    [dispatch, topicId]
  )

  return {
    getTranslationUpdater
  }
}
