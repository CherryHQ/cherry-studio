import { loggerService } from '@logger'
import { builtinLanguages, UNKNOWN } from '@renderer/config/translate'
import { useAppSelector } from '@renderer/store'
import { TranslateState, updateSettings } from '@renderer/store/translate'
import { TranslateLanguage } from '@renderer/types'
import { runAsyncFunction } from '@renderer/utils'
import { getTranslateOptions } from '@renderer/utils/translate'
import { useCallback, useEffect, useState } from 'react'
import { useDispatch } from 'react-redux'

const logger = loggerService.withContext('useTranslate')

/**
 * 翻译相关功能的核心钩子函数
 * @returns 返回翻译相关的状态和方法
 * - prompt: 翻译模型的提示词
 * - translateLanguages: 可用的翻译语言列表
 * - getLanguageByLangcode: 通过语言代码获取语言对象
 */
export default function useTranslate() {
  const prompt = useAppSelector((state) => state.settings.translateModelPrompt)
  const settings = useAppSelector((state) => state.translate.settings)
  const [translateLanguages, setTranslateLanguages] = useState<TranslateLanguage[]>(builtinLanguages)
  const [isLoaded, setIsLoaded] = useState(false)

  const dispatch = useDispatch()

  useEffect(() => {
    runAsyncFunction(async () => {
      const options = await getTranslateOptions()
      setTranslateLanguages(options)
      setIsLoaded(true)
    })
  }, [])

  const getLanguageByLangcode = useCallback(
    (langCode: string) => {
      if (!isLoaded) {
        logger.verbose('Translate languages are not loaded yet. Return UNKNOWN.')
        return UNKNOWN
      }

      const result = translateLanguages.find((item) => item.langCode === langCode)
      if (result) {
        return result
      } else {
        logger.warn(`Unknown language ${langCode}`)
        return UNKNOWN
      }
    },
    [isLoaded, translateLanguages]
  )

  const handleUpdateSettings = useCallback(
    (update: Partial<TranslateState['settings']>) => {
      dispatch(updateSettings(update))
    },
    [dispatch]
  )

  return {
    prompt,
    settings,
    translateLanguages,
    getLanguageByLangcode,
    updateSettings: handleUpdateSettings
  }
}
