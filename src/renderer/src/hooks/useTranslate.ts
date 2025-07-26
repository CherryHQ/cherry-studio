import db from '@renderer/databases'
import { fetchTranslate } from '@renderer/services/ApiService'
import store, { useAppDispatch, useAppSelector } from '@renderer/store'
import {
  setTranslatedContent as _setTranslatedContent,
  setTranslating as _setTranslating
} from '@renderer/store/translate'
import { Assistant, LanguageCode, TranslateHistory } from '@renderer/types'
import { uuid } from '@renderer/utils'
import { t } from 'i18next'

export default function useTranslate() {
  const translatedContent = useAppSelector((state) => state.translate.translatedContent)
  const translating = useAppSelector((state) => state.translate.translating)

  const dispatch = useAppDispatch()

  const setTranslatedContent = (content: string) => {
    dispatch(_setTranslatedContent(content))
  }

  const setTranslating = (translating: boolean) => {
    dispatch(_setTranslating(translating))
  }

  const translate = async (
    text: string,
    assistant: Assistant,
    actualSourceLanguage: LanguageCode,
    actualTargetLanguage: LanguageCode
  ) => {
    setTranslating(true)
    await fetchTranslate({
      content: text,
      assistant,
      onResponse: (text) => {
        setTranslatedContent(text)
      }
    })
    const translatedContent = store.getState().translate.translatedContent
    await saveTranslateHistory(text, translatedContent, actualSourceLanguage, actualTargetLanguage)

    setTranslating(false)

    const pathname = store.getState().runtime.activeRoute

    if (pathname !== '/translate') {
      // ALTERNATIVE: 也许可以改成通知的形式
      window.message.success(t('translate.complete'))
    }
  }

  const saveTranslateHistory = async (
    sourceText: string,
    targetText: string,
    sourceLanguage: LanguageCode,
    targetLanguage: LanguageCode
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

  return {
    translatedContent,
    translating,
    setTranslatedContent,
    setTranslating,
    translate,
    saveTranslateHistory
  }
}
