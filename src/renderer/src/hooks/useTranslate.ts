import { loggerService } from '@logger'
import { builtinLanguages, UNKNOWN } from '@renderer/config/translate'
import db from '@renderer/databases'
import { fetchTranslate } from '@renderer/services/ApiService'
import { getDefaultTranslateAssistant } from '@renderer/services/AssistantService'
import store, { useAppDispatch, useAppSelector } from '@renderer/store'
import { setTranslating as _setTranslating } from '@renderer/store/runtime'
import { setTranslatedContent as _setTranslatedContent } from '@renderer/store/translate'
import { TranslateAssistant, TranslateHistory, TranslateLanguage, TranslateLanguageCode } from '@renderer/types'
import { runAsyncFunction, uuid } from '@renderer/utils'
import { getTranslateOptions } from '@renderer/utils/translate'
import { t } from 'i18next'
import { throttle } from 'lodash'
import { useCallback, useEffect, useState } from 'react'

const logger = loggerService.withContext('useTranslate')

/**
 * 翻译相关功能的核心钩子函数
 * @returns 返回翻译相关的状态和方法
 * - 翻译页面
 *   - translatedContent: 翻译页面中翻译后的内容
 *   - translating: 翻译页面是否正在翻译
 *   - setTranslatedContent: 设置翻译后的内容
 *   - setTranslating: 设置翻译状态
 *   - translate: 执行翻译操作
 *   - saveTranslateHistory: 保存翻译历史
 *   - deleteHistory: 删除指定翻译历史
 *   - clearHistory: 清空所有翻译历史
 * - 通用
 *   - translateOptions: 翻译选项
 *   - getLanguageByLangcode: 从langCode获取Language对象
 */
export default function useTranslate() {
  const translatedContent = useAppSelector((state) => state.translate.translatedContent)
  const translating = useAppSelector((state) => state.runtime.translating)
  const [translateLanguages, setTranslateLanguages] = useState<TranslateLanguage[]>(builtinLanguages)

  const dispatch = useAppDispatch()

  const setTranslatedContent = (content: string) => {
    dispatch(_setTranslatedContent(content))
  }

  const setTranslating = (translating: boolean) => {
    dispatch(_setTranslating(translating))
  }

  /**
   * 翻译文本并保存历史记录，包含完整的异常处理，不会抛出异常
   * @param text - 需要翻译的文本
   * @param actualSourceLanguage - 源语言
   * @param actualTargetLanguage - 目标语言
   */
  const translate = async (
    text: string,
    actualSourceLanguage: TranslateLanguage,
    actualTargetLanguage: TranslateLanguage
  ): Promise<void> => {
    try {
      if (translating) {
        return
      }

      setTranslating(true)

      let assistant: TranslateAssistant
      try {
        assistant = getDefaultTranslateAssistant(actualTargetLanguage, text)
      } catch (e) {
        if (e instanceof Error) {
          window.message.error(e.message)
          return
        } else {
          throw e
        }
      }

      try {
        await fetchTranslate({
          content: text,
          assistant,
          onResponse: throttle(setTranslatedContent, 100)
        })
      } catch (e) {
        logger.error('Failed to translate text', e as Error)
        window.message.error(t('translate.error.failed'))
        setTranslating(false)
        return
      }

      window.message.success(t('translate.complete'))

      try {
        const translatedContent = store.getState().translate.translatedContent
        await saveTranslateHistory(
          text,
          translatedContent,
          actualSourceLanguage.langCode,
          actualTargetLanguage.langCode
        )
      } catch (e) {
        logger.error('Failed to save translate history', e as Error)
        window.message.error(t('translate.history.error.save'))
      }

      setTranslating(false)
    } catch (e) {
      logger.error('Failed to translate', e as Error)
      window.message.error(t('translate.error.unknown'))
      setTranslating(false)
    }
  }

  /**
   * 保存翻译历史记录到数据库
   * @param sourceText - 原文内容
   * @param targetText - 翻译后的内容
   * @param sourceLanguage - 源语言代码
   * @param targetLanguage - 目标语言代码
   * @returns Promise<void>
   */
  const saveTranslateHistory = async (
    sourceText: string,
    targetText: string,
    sourceLanguage: TranslateLanguageCode,
    targetLanguage: TranslateLanguageCode
  ) => {
    const history: TranslateHistory = {
      id: uuid(),
      sourceText,
      targetText,
      sourceLanguage,
      targetLanguage,
      createdAt: new Date().toISOString()
    }
    await db.translate_history.add(history)
  }

  /**
   * 删除指定的翻译历史记录
   * @param id - 要删除的翻译历史记录ID
   * @returns Promise<void>
   */
  const deleteHistory = async (id: string) => {
    db.translate_history.delete(id)
  }

  /**
   * 清空所有翻译历史记录
   * @returns Promise<void>
   */
  const clearHistory = async () => {
    db.translate_history.clear()
  }

  useEffect(() => {
    runAsyncFunction(async () => {
      const options = await getTranslateOptions()
      setTranslateLanguages(options)
    })
  }, [])

  const getLanguageByLangcode = useCallback(
    (langCode: string) => {
      const result = translateLanguages.find((item) => item.langCode === langCode)
      if (result) {
        return result
      } else {
        logger.warn(`Unkonwn language ${langCode}`)
        return UNKNOWN
      }
    },
    [translateLanguages]
  )

  return {
    translatedContent,
    translating,
    setTranslatedContent,
    setTranslating,
    translate,
    saveTranslateHistory,
    deleteHistory,
    clearHistory,
    translateLanguages,
    getLanguageByLangcode
  }
}
