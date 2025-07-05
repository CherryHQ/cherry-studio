import i18n from '@renderer/i18n'
import store from '@renderer/store'
import { Language } from '@renderer/types'

import { fetchTranslate } from './ApiService'
import { getDefaultTranslateAssistant } from './AssistantService'

export const translateText = async (
  text: string,
  targetLanguage: Language,
  onResponse?: (text: string, isComplete: boolean) => void
) => {
  const translateModel = store.getState().llm.translateModel

  if (!translateModel) {
    window.message.error({
      content: i18n.t('translate.error.not_configured'),
      key: 'translate-message'
    })
    return Promise.reject(new Error(i18n.t('translate.error.not_configured')))
  }

  const assistant = getDefaultTranslateAssistant(targetLanguage, text)

  const translatedText = await fetchTranslate({ content: text, assistant, onResponse })

  const trimmedText = translatedText.trim()

  if (!trimmedText) {
    return Promise.reject(new Error(i18n.t('translate.error.failed')))
  }

  return trimmedText
}
