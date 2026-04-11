import { loggerService } from '@logger'
import { db } from '@renderer/databases'
import type {
  AssistantSettings,
  CustomTranslateLanguage,
  ReasoningEffortOption,
  TranslateHistory,
  TranslateLanguage,
  TranslateLanguageCode
} from '@renderer/types'
import { uuid } from '@renderer/utils'
import { t } from 'i18next'

import { getDefaultTranslateAssistant } from './AssistantService'

const logger = loggerService.withContext('TranslateService')

type TranslateOptions = {
  reasoningEffort: ReasoningEffortOption
}

/**
 * 翻译文本到目标语言（流式 IPC）
 */
export const translateText = async (
  text: string,
  targetLanguage: TranslateLanguage,
  onResponse?: (text: string, isComplete: boolean) => void,
  _abortKey?: string,
  options?: TranslateOptions
) => {
  const assistantSettings: Partial<AssistantSettings> | undefined = options
    ? { reasoning_effort: options?.reasoningEffort }
    : undefined
  const assistant = await getDefaultTranslateAssistant(targetLanguage, text, assistantSettings)

  const model = assistant.model
  if (!model) {
    throw new Error(t('translate.error.empty'))
  }

  const requestId = crypto.randomUUID()
  let translatedText = ''

  const result = await new Promise<string>((resolve, reject) => {
    const unsubscribers: Array<() => void> = []
    const cleanup = () => unsubscribers.forEach((u) => u())

    // Listen for stream chunks
    unsubscribers.push(
      window.api.ai.onStreamChunk((data) => {
        if (data.requestId !== requestId) return
        const chunk = data.chunk
        if (chunk.type === 'text-delta') {
          translatedText += chunk.delta
          onResponse?.(translatedText, false)
        }
      })
    )

    // Listen for completion
    unsubscribers.push(
      window.api.ai.onStreamDone((data) => {
        if (data.requestId !== requestId) return
        cleanup()
        onResponse?.(translatedText, true)
        resolve(translatedText)
      })
    )

    // Listen for errors
    unsubscribers.push(
      window.api.ai.onStreamError((data) => {
        if (data.requestId !== requestId) return
        cleanup()
        reject(new Error(data.error.message ?? 'Translation stream error'))
      })
    )

    // Fire the stream request
    window.api.ai
      .streamText({
        requestId,
        chatId: `translate-${requestId}`,
        trigger: 'submit-message',
        messages: [{ id: crypto.randomUUID(), role: 'user', parts: [{ type: 'text', text: assistant.content }] }],
        providerId: model.provider,
        modelId: model.id,
        assistantId: assistant.id
      })
      .catch((error: unknown) => {
        cleanup()
        reject(error instanceof Error ? error : new Error(String(error)))
      })
  })

  const trimmedText = result.trim()

  if (!trimmedText) {
    return Promise.reject(new Error(t('translate.error.empty')))
  }

  return trimmedText
}

/**
 * 添加自定义翻译语言
 */
export const addCustomLanguage = async (
  value: string,
  emoji: string,
  langCode: string
): Promise<CustomTranslateLanguage> => {
  const existing = await db.translate_languages.where('langCode').equals(langCode).first()
  if (existing) {
    logger.error(`Custom language ${langCode} exists.`)
    throw new Error(t('settings.translate.custom.error.langCode.exists'))
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
 */
export const getAllCustomLanguages = async () => {
  try {
    const languages = await db.translate_languages.toArray()
    return languages
  } catch (e) {
    logger.error('Failed to get all custom languages.', e as Error)
    throw e
  }
}

/**
 * 保存翻译历史记录到数据库
 */
export const saveTranslateHistory = async (
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
 * 更新翻译历史记录
 */
export const updateTranslateHistory = async (id: string, update: Omit<Partial<TranslateHistory>, 'id'>) => {
  try {
    const history: Partial<TranslateHistory> = {
      ...update,
      id
    }
    await db.translate_history.update(id, history)
  } catch (e) {
    logger.error('Failed to update translate history', e as Error)
    throw e
  }
}

/**
 * 删除指定的翻译历史记录
 */
export const deleteHistory = async (id: string) => {
  try {
    void db.translate_history.delete(id)
  } catch (e) {
    logger.error('Failed to delete translate history', e as Error)
    throw e
  }
}

/**
 * 清空所有翻译历史记录
 */
export const clearHistory = async () => {
  void db.translate_history.clear()
}
