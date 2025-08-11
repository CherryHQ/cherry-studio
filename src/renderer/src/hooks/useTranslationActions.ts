import { loggerService } from '@logger'
import { translateText } from '@renderer/services/TranslateService'
import { useAppDispatch } from '@renderer/store'
import { messageBlocksSelectors, removeOneBlock } from '@renderer/store/messageBlock'
import { Message, Topic, TranslateLanguage } from '@renderer/types'
import { findTranslationBlocks, findTranslationBlocksById, getMainTextContent } from '@renderer/utils/messageUtils/find'
import { t } from 'i18next'
import { useCallback, useMemo, useState } from 'react'
import { useSelector } from 'react-redux'

import { useMessageOperations } from './useMessageOperations'
import useTranslate from './useTranslate'

const logger = loggerService.withContext('MessageMenubar')

export const useTranslationActions = (message: Message, topic: Topic) => {
  const { getTranslationUpdater, removeMessageBlock } = useMessageOperations(topic)
  const [isTranslating, setIsTranslating] = useState(false)
  const { translateLanguages } = useTranslate()
  const dispatch = useAppDispatch()
  const blockEntities = useSelector(messageBlocksSelectors.selectEntities)

  const hasTranslationBlocks = useMemo(() => {
    const translationBlocks = findTranslationBlocks(message)
    return translationBlocks.length > 0
  }, [message])

  const mainTextContent = useMemo(() => {
    // 只处理助手消息和来自推理模型的消息
    // if (message.role === 'assistant' && message.model && isReasoningModel(message.model)) {
    // return getMainTextContent(withMessageThought(message))
    // }
    return getMainTextContent(message)
  }, [message])

  const handleTranslate = useCallback(
    async (language: TranslateLanguage) => {
      if (isTranslating) return

      setIsTranslating(true)
      const messageId = message.id
      const translationUpdater = await getTranslationUpdater(messageId, language.langCode)
      if (!translationUpdater) return
      try {
        await translateText(mainTextContent, language, translationUpdater)
      } catch (error) {
        // console.error('Translation failed:', error)
        window.message.error({ content: t('translate.error.failed'), key: 'translate-message' })
        // 理应只有一个
        const translationBlocks = findTranslationBlocksById(message.id)
        logger.silly(`there are ${translationBlocks.length} translation blocks`)
        if (translationBlocks.length > 0) {
          const block = translationBlocks[0]
          logger.silly(`block`, block)
          if (!block.content) {
            dispatch(removeOneBlock(block.id))
          }
        }

        // clearStreamMessage(message.id)
      } finally {
        setIsTranslating(false)
      }
    },
    [isTranslating, message, getTranslationUpdater, mainTextContent, t, dispatch]
  )

  const translationMenuItems = useMemo(
    () => [
      ...translateLanguages.map((item) => ({
        label: item.emoji + ' ' + item.label(),
        key: item.langCode,
        onClick: () => handleTranslate(item)
      })),
      ...(hasTranslationBlocks
        ? [
            { type: 'divider' as const },
            {
              label: '📋 ' + t('common.copy'),
              key: 'translate-copy',
              onClick: () => {
                const translationBlocks = message.blocks
                  .map((blockId) => blockEntities[blockId])
                  .filter((block) => block?.type === 'translation')

                if (translationBlocks.length > 0) {
                  const translationContent = translationBlocks
                    .map((block) => block?.content || '')
                    .join('\n\n')
                    .trim()

                  if (translationContent) {
                    navigator.clipboard.writeText(translationContent)
                    window.message.success({ content: t('translate.copied'), key: 'translate-copy' })
                  } else {
                    window.message.warning({ content: t('translate.empty'), key: 'translate-copy' })
                  }
                }
              }
            },
            {
              label: '✖ ' + t('translate.close'),
              key: 'translate-close',
              onClick: () => {
                const translationBlocks = message.blocks
                  .map((blockId) => blockEntities[blockId])
                  .filter((block) => block?.type === 'translation')
                  .map((block) => block?.id)

                if (translationBlocks.length > 0) {
                  translationBlocks.forEach((blockId) => {
                    if (blockId) removeMessageBlock(message.id, blockId)
                  })
                  window.message.success({ content: t('translate.closed'), key: 'translate-close' })
                }
              }
            }
          ]
        : [])
    ],
    [translateLanguages, hasTranslationBlocks, message.blocks, blockEntities, removeMessageBlock, message.id]
  )

  return {
    isTranslating,
    mainTextContent,
    hasTranslationBlocks,
    translationMenuItems,
    handleTranslate
  }
}
