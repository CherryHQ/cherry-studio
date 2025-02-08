import i18n from '@renderer/i18n'
import store from '@renderer/store'

import { fetchTranslate } from './ApiService'
import { getDefaultTopic } from './AssistantService'
import { getDefaultTranslateAssistant } from './AssistantService'
import { getUserMessage } from './MessagesService'

export const translateText = async (text: string, targetLanguage: string, onResponse?: (text: string) => void) => {
  const translateModel = store.getState().llm.translateModel

  if (!translateModel) {
    window.message.error({
      content: i18n.t('translate.error.not_configured'),
      key: 'translate-message'
    })
    return Promise.reject(new Error(i18n.t('translate.error.not_configured')))
  }

  const assistant = getDefaultTranslateAssistant(targetLanguage, text)
  const message = getUserMessage({
    assistant,
    topic: getDefaultTopic('default'),
    type: 'text',
    content: ''
  })

  const translatedText = await fetchTranslate({ message, assistant, onResponse })

  const trimmedText = translatedText.trim()

  if (!trimmedText) {
    return Promise.reject(new Error(i18n.t('translate.error.failed')))
  }

  return trimmedText
}
