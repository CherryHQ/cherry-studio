import { db } from '@renderer/databases'
import i18n from '@renderer/i18n'
import store from '@renderer/store'
import { CustomTranslateLanguage, Language } from '@renderer/types'
import { uuid } from '@renderer/utils'

import { fetchTranslate } from './ApiService'
import { getDefaultTranslateAssistant } from './AssistantService'
import { loggerService } from './LoggerService'

const logger = loggerService.withContext('TranslateService')

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

export const addCustomLanguage = async (value: string, emoji: string, langCode: string) => {
  // 按langcode判重
  const existing = await db.translate_languages.where('langCode').equals(value).first()
  if (existing) {
    logger.error(`Custom language ${value} exists.`)
    throw new Error(`Custom language ${value} exists.`)
  } else {
    try {
      db.translate_languages.add({
        id: uuid(),
        value,
        langCode,
        emoji
      })
    } catch (e) {
      logger.error('Failed to add custom language.', e as Error)
      throw e
    }
  }
}

export const deleteCustomLanguage = async (id: string) => {
  try {
    await db.translate_languages.delete(id)
  } catch (e) {
    logger.error('Delete custom language failed.', e as Error)
    throw e
  }
}

export const updateCustomLanguage = async (
  old: CustomTranslateLanguage,
  value: string,
  emoji: string,
  langCode: string
) => {
  try {
    await db.translate_languages.put({
      id: old.id,
      value,
      langCode,
      emoji
    })
  } catch (e) {
    logger.error('Update custom language failed.', e as Error)
    throw e
  }
}

/**
 * 获取所有自定义语言
 * @returns Promise<CustomTranslateLanguage[]>
 */
export const getAllCustomLanguages = async () => {
  try {
    const languages = await db.translate_languages.toArray()
    return languages
  } catch (e) {
    logger.error('Failed to get all custom languages.', e as Error)
    throw new Error('Failed to get all custom languages.')
  }
}
