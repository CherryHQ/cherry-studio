import { dataApiService } from '@data/DataApiService'
import { preferenceService } from '@data/PreferenceService'
import { fromSharedModel } from '@renderer/config/models/_bridge'
import { isQwenMTModel } from '@renderer/config/models/qwen'
import type { Model, ReasoningEffortOption } from '@renderer/types'
import { isTranslateLangCode, type TranslateLangCode } from '@shared/data/preference/preferenceTypes'
import { createUniqueModelId, isUniqueModelId, type UniqueModelId } from '@shared/data/types/model'
import type { TranslateLanguage } from '@shared/data/types/translate'
import { t } from 'i18next'

type TranslateOptions = {
  reasoningEffort: ReasoningEffortOption
}

/** Minimal bag for a translate turn — the model to call + the fully-interpolated prompt. */
export interface TranslatePayload {
  model: Model
  content: string
}

/**
 * Resolve the configured translate model + interpolate the translate prompt.
 *
 * Reads `feature.translate.model_id` from v2 Preference and fetches the
 * matching model row via DataApi; throws when either lookup fails. Qwen MT
 * models bypass prompt interpolation (the model handles language pairing
 * itself) — matches the legacy v1 behaviour.
 */
export async function resolveTranslatePayload(
  targetLanguage: TranslateLanguage,
  text: string
): Promise<TranslatePayload> {
  const modelId = await preferenceService.get('feature.translate.model_id')
  if (!modelId || !isUniqueModelId(modelId)) {
    throw new Error(t('translate.error.not_configured'))
  }
  const sharedModel = await dataApiService.get(`/models/${modelId}`).catch(() => undefined)
  if (!sharedModel) {
    throw new Error(t('translate.error.not_configured'))
  }
  const model = fromSharedModel(sharedModel)

  const content = isQwenMTModel(model)
    ? text
    : (await preferenceService.get('feature.translate.model_prompt'))
        .replaceAll('{{target_language}}', targetLanguage.value)
        .replaceAll('{{text}}', text)

  return { model, content }
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
 * @param options - Optional settings (e.g. reasoning effort) — currently unused while the IPC `generateText` signature
 *                  doesn't accept per-call assistant settings; preserved for future use without breaking callers.
 * @returns The trimmed translated text
 * @throws {Error} On invalid target language or empty output
 */
export const translateText = async (
  text: string,
  targetLanguage: TranslateLangCode | TranslateLanguage,
  onResponse?: (text: string, isComplete: boolean) => void,
  _abortKey?: string,
  _options?: TranslateOptions
) => {
  if (typeof targetLanguage === 'string') {
    if (!isTranslateLangCode(targetLanguage) || targetLanguage === 'unknown') {
      throw new Error(`Invalid target language: ${targetLanguage}`)
    }
    const langDto = await dataApiService.get(`/translate/languages/${targetLanguage}`)
    targetLanguage = langDto
  }

  const { model, content } = await resolveTranslatePayload(targetLanguage, text)

  const { text: result } = await window.api.ai.generateText({
    uniqueModelId: createUniqueModelId(model.provider, model.id) as UniqueModelId,
    // No persisted assistant for ad-hoc translate calls — main resolves the
    // model directly via `uniqueModelId`.
    prompt: content
  })

  onResponse?.(result, true)

  const trimmedText = result.trim()

  if (!trimmedText) {
    return Promise.reject(new Error(t('translate.error.empty')))
  }

  return trimmedText
}
