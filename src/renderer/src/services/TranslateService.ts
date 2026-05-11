import { dataApiService } from '@data/DataApiService'
import type { AssistantSettings, ReasoningEffortOption } from '@renderer/types'
import { isTranslateLangCode, type TranslateLangCode } from '@shared/data/preference/preferenceTypes'
import { createUniqueModelId } from '@shared/data/types/model'
import type { TranslateLanguage } from '@shared/data/types/translate'
import { t } from 'i18next'

import { getDefaultTranslateAssistant } from './AssistantService'

type TranslateOptions = {
  reasoningEffort: ReasoningEffortOption
}

/**
 * Translate text into the target language.
 *
 * Currently non-streaming: legacy `fetchChatCompletion` (renderer-side streaming
 * via Provider SDK) was removed during the ai-service migration to Main IPC.
 * The accumulated-text callback is invoked once on completion so the existing
 * `onResponse(text, isComplete)` contract still works for callers.
 *
 * @param text - The source text to translate
 * @param targetLanguage - Either a {@link TranslateLangCode} (resolved via DataApi) or a {@link TranslateLanguage} object
 * @param onResponse - Invoked once with the final translated text and `isComplete=true`
 * @param _abortKey - Currently unused (legacy streaming-abort path is gone)
 * @param options - Optional settings (e.g. reasoning effort)
 * @returns The trimmed translated text
 * @throws {Error} On invalid target language or empty output
 */
export const translateText = async (
  text: string,
  targetLanguage: TranslateLangCode | TranslateLanguage,
  onResponse?: (text: string, isComplete: boolean) => void,
  _abortKey?: string,
  options?: TranslateOptions
) => {
  const assistantSettings: Partial<AssistantSettings> | undefined = options
    ? { reasoning_effort: options?.reasoningEffort }
    : undefined

  if (typeof targetLanguage === 'string') {
    if (!isTranslateLangCode(targetLanguage) || targetLanguage === 'unknown') {
      throw new Error(`Invalid target language: ${targetLanguage}`)
    }
    const langDto = await dataApiService.get(`/translate/languages/${targetLanguage}`)
    targetLanguage = langDto
  }
  const assistant = await getDefaultTranslateAssistant(targetLanguage, text, assistantSettings)

  const model = assistant.model
  if (!model) {
    throw new Error(t('translate.error.empty'))
  }

  const { text: result } = await window.api.ai.generateText({
    uniqueModelId: createUniqueModelId(model.provider, model.id),
    assistantId: assistant.id,
    prompt: assistant.content
  })

  onResponse?.(result, true)

  const trimmedText = result.trim()

  if (!trimmedText) {
    return Promise.reject(new Error(t('translate.error.empty')))
  }

  return trimmedText
}
