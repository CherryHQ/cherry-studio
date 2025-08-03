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

/**
 * 添加自定义翻译语言
 * @param value - 语言名称
 * @param emoji - 语言对应的emoji图标
 * @param langCode - 语言代码
 * @returns {Promise<CustomTranslateLanguage>} 返回新添加的自定义语言对象
 * @throws {Error} 当语言已存在或添加失败时抛出错误
 */
export const addCustomLanguage = async (
  value: string,
  emoji: string,
  langCode: string
): Promise<CustomTranslateLanguage> => {
  // 按langcode判重
  const existing = await db.translate_languages.where('langCode').equals(value).first()
  if (existing) {
    logger.error(`Custom language ${value} exists.`)
    throw new Error(`Custom language ${value} exists.`)
  } else {
    try {
      const item = {
        id: uuid(),
        value,
        langCode: langCode.toLowerCase(),
        emoji
      }
      await db.translate_languages.add(item)
      return item
    } catch (e) {
      logger.error('Failed to add custom language.', e as Error)
      throw e
    }
  }
}

/**
 * 删除自定义翻译语言
 * @param id - 要删除的自定义语言ID
 * @throws {Error} 删除自定义语言失败时抛出错误
 */
export const deleteCustomLanguage = async (id: string) => {
  try {
    await db.translate_languages.delete(id)
  } catch (e) {
    logger.error('Delete custom language failed.', e as Error)
    throw e
  }
}

/**
 * 更新自定义翻译语言
 * @param old - 原有的自定义语言对象
 * @param value - 新的语言名称
 * @param emoji - 新的语言emoji图标
 * @param langCode - 新的语言代码
 * @throws {Error} 更新自定义语言失败时抛出错误
 */
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
      langCode: langCode.toLowerCase(),
      emoji
    })
  } catch (e) {
    logger.error('Update custom language failed.', e as Error)
    throw e
  }
}

/**
 * 获取所有自定义语言
 * @throws {Error} 获取自定义语言失败时抛出错误
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
