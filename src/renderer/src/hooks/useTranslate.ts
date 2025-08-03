import { loggerService } from '@logger'
import { builtinLanguages, UNKNOWN } from '@renderer/config/translate'
import { useAppSelector } from '@renderer/store'
import { TranslateLanguage } from '@renderer/types'
import { runAsyncFunction } from '@renderer/utils'
import { getTranslateOptions } from '@renderer/utils/translate'
import { useCallback, useEffect, useState } from 'react'

const logger = loggerService.withContext('useTranslate')

/**
 * 翻译相关功能的核心钩子函数
 * @returns 返回翻译相关的状态和方法
 * - 仅翻译页面
 * - 翻译功能
 *   - prompt: 翻译模型的提示词
 *   - translatedContent: 翻译后的内容
 *   - translating: 是否正在翻译
 *   - setTranslatedContent: 设置翻译后的内容
 *   - setTranslating: 设置翻译状态
 *   - translate: 执行翻译操作
 * - 历史记录
 *   - saveTranslateHistory: 保存翻译历史
 *   - deleteHistory: 删除指定翻译历史
 *   - clearHistory: 清空所有翻译历史
 * - 语言相关
 *   - translateLanguages: 可用的翻译语言列表
 *   - getLanguageByLangcode: 通过语言代码获取语言对象
 */
export default function useTranslate() {
  const prompt = useAppSelector((state) => state.settings.translateModelPrompt)
  const translatedContent = useAppSelector((state) => state.translate.translatedContent)
  const translating = useAppSelector((state) => state.runtime.translating)
  const [translateLanguages, setTranslateLanguages] = useState<TranslateLanguage[]>(builtinLanguages)

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
    prompt,
    translatedContent,
    translating,
    translateLanguages,
    getLanguageByLangcode
  }
}
