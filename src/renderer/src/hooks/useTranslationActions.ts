import { loggerService } from '@logger'
import { translateText } from '@renderer/services/TranslateService'
import { useAppDispatch } from '@renderer/store'
import { removeOneBlock } from '@renderer/store/messageBlock'
import { Message, Topic, TranslateLanguage } from '@renderer/types'
import { findTranslationBlocks, findTranslationBlocksById, getMainTextContent } from '@renderer/utils/messageUtils/find'
import { t } from 'i18next'
import { useCallback, useMemo, useState } from 'react'

import { useMessageOperations } from './useMessageOperations'
import useTranslate from './useTranslate'

const logger = loggerService.withContext('MessageMenubar')

export const useTranslationActions = (message: Message, topic: Topic) => {
  const { getTranslationUpdater } = useMessageOperations(topic)
  const [isTranslating, setIsTranslating] = useState(false)
  const { translateLanguages } = useTranslate()
  const dispatch = useAppDispatch()

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

  const translationMenuItems = useMemo(() => {
    // 生成翻译菜单项
  }, [translateLanguages, hasTranslationBlocks])

  return {
    isTranslating,
    mainTextContent,
    hasTranslationBlocks,
    translationMenuItems,
    handleTranslate
  }
}
