import db from '@renderer/databases'
import { fetchTranslate } from '@renderer/services/ApiService'
import { getDefaultTranslateAssistant } from '@renderer/services/AssistantService'
import store, { useAppDispatch, useAppSelector } from '@renderer/store'
import { setTranslating as _setTranslating } from '@renderer/store/runtime'
import { setTranslatedContent as _setTranslatedContent } from '@renderer/store/translate'
import { Language, LanguageCode, TranslateHistory } from '@renderer/types'
import { uuid } from '@renderer/utils'
import { t } from 'i18next'

export default function useTranslate() {
  const translatedContent = useAppSelector((state) => state.translate.translatedContent)
  const translating = useAppSelector((state) => state.runtime.translating)

  const dispatch = useAppDispatch()

  const setTranslatedContent = (content: string) => {
    dispatch(_setTranslatedContent(content))
  }

  const setTranslating = (translating: boolean) => {
    dispatch(_setTranslating(translating))
  }

  const translate = async (text: string, actualSourceLanguage: Language, actualTargetLanguage: Language) => {
    setTranslating(true)

    const assistant = getDefaultTranslateAssistant(actualTargetLanguage, text)

    await fetchTranslate({
      content: text,
      assistant,
      onResponse: (text) => {
        setTranslatedContent(text)
      }
    })
    const translatedContent = store.getState().translate.translatedContent
    await saveTranslateHistory(text, translatedContent, actualSourceLanguage.langCode, actualTargetLanguage.langCode)

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

  const deleteHistory = async (id: string) => {
    db.translate_history.delete(id)
  }

  const clearHistory = async () => {
    db.translate_history.clear()
  }

  return {
    translatedContent,
    translating,
    setTranslatedContent,
    setTranslating,
    translate,
    saveTranslateHistory,
    deleteHistory,
    clearHistory
  }
}
