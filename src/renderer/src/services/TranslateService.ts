import { dataApiService } from '@data/DataApiService'
import type {
  AssistantSettings,
  FetchChatCompletionRequestOptions,
  ReasoningEffortOption,
  TranslateLanguageVo
} from '@renderer/types'
import type { Chunk } from '@renderer/types/chunk'
import { ChunkType } from '@renderer/types/chunk'
import { readyToAbort } from '@renderer/utils/abortController'
import { isAbortError } from '@renderer/utils/error'
import { languageDtoToVo } from '@renderer/utils/translate'
import type {
  CreateTranslateHistoryDto,
  CreateTranslateLanguageDto,
  UpdateTranslateHistoryDto,
  UpdateTranslateLanguageDto
} from '@shared/data/api/schemas/translate'
import { isTranslateLangCode, type TranslateLangCode } from '@shared/data/preference/preferenceTypes'
import { NoOutputGeneratedError } from 'ai'
import { t } from 'i18next'

import { fetchChatCompletion } from './ApiService'
import { getDefaultTranslateAssistant } from './AssistantService'

type TranslateOptions = {
  reasoningEffort: ReasoningEffortOption
}

/**
 * Translate text into the target language via streaming chat completion.
 * @param text - The source text to translate
 * @param targetLanguage - Target language, either as a {@link TranslateLangCode} string or a {@link TranslateLanguageVo} object
 * @param onResponse - Streaming callback invoked on every chunk with the accumulated text and a completion flag
 * @param abortKey - Optional key used to abort the request via {@link readyToAbort}
 * @param options - Optional settings (e.g. reasoning effort)
 * @returns The trimmed translated text
 * @throws {Error} When translation is aborted, fails, or produces empty output
 */
export const translateText = async (
  text: string,
  targetLanguage: TranslateLangCode | TranslateLanguageVo,
  onResponse?: (text: string, isComplete: boolean) => void,
  abortKey?: string,
  options?: TranslateOptions
) => {
  let error: unknown
  const assistantSettings: Partial<AssistantSettings> | undefined = options
    ? { reasoning_effort: options?.reasoningEffort }
    : undefined

  // TODO: modify here when aisdk is migrated to main process
  if (isTranslateLangCode(targetLanguage)) {
    const langDto = await dataApiService.get(`/translate/languages/${targetLanguage}`)
    targetLanguage = languageDtoToVo(langDto)
  } else if (typeof targetLanguage === 'string') {
    throw new Error(`Invalid target language: ${targetLanguage}`)
  }
  const assistant = await getDefaultTranslateAssistant(targetLanguage, text, assistantSettings)

  const signal = abortKey ? readyToAbort(abortKey) : undefined

  let translatedText = ''
  let completed = false
  const onChunk = (chunk: Chunk) => {
    if (chunk.type === ChunkType.TEXT_DELTA) {
      translatedText = chunk.text
    } else if (chunk.type === ChunkType.TEXT_COMPLETE) {
      completed = true
    } else if (chunk.type === ChunkType.ERROR) {
      error = chunk.error
      if (isAbortError(chunk.error)) {
        completed = true
      }
    }
    onResponse?.(translatedText, completed)
  }

  const requestOptions = {
    signal
  } satisfies FetchChatCompletionRequestOptions

  try {
    await fetchChatCompletion({
      prompt: assistant.content,
      assistant,
      requestOptions,
      onChunkReceived: onChunk
    })
  } catch (e) {
    // dismiss no output generated error. it will be thrown when aborted.
    if (!NoOutputGeneratedError.isInstance(e)) {
      throw e
    }
  }

  if (error !== undefined) {
    throw error
  }

  const trimmedText = translatedText.trim()

  if (!trimmedText) {
    return Promise.reject(new Error(t('translate.error.empty')))
  }

  return trimmedText
}

/**
 * Create a new translate language.
 * @param data - Language payload (langCode, value, emoji)
 * @returns The created {@link TranslateLanguage} object
 */
export const addLanguage = (data: CreateTranslateLanguageDto) => {
  return dataApiService.post('/translate/languages', { body: data })
}

/**
 * Update an existing translate language (only value/emoji; langCode is immutable).
 * @param langCode - The language code to update
 * @param data - Fields to update
 * @returns The updated {@link TranslateLanguage} object
 */
export const updateLanguage = (langCode: string, data: UpdateTranslateLanguageDto) => {
  return dataApiService.patch(`/translate/languages/${langCode}`, { body: data })
}

/**
 * Delete a translate language.
 * @param langCode - The language code to delete
 */
export const deleteLanguage = (langCode: string) => {
  return dataApiService.delete(`/translate/languages/${langCode}`)
}

// ---------------------------------------------------------------------------
// History CRUD
// ---------------------------------------------------------------------------

/**
 * Create a new translate history record.
 * @param data - History payload (sourceText, targetText, languages, etc.)
 * @returns The created {@link TranslateHistory} object
 */
export const addHistory = (data: CreateTranslateHistoryDto) => {
  return dataApiService.post('/translate/histories', { body: data })
}

/**
 * Update an existing translate history record.
 * @param id - The history record ID
 * @param data - Fields to update
 * @returns The updated {@link TranslateHistory} object
 */
export const updateHistory = (id: string, data: UpdateTranslateHistoryDto) => {
  return dataApiService.patch(`/translate/histories/${id}`, { body: data })
}

/**
 * Delete a translate history record.
 * @param id - The history record ID
 */
export const deleteHistory = (id: string) => {
  return dataApiService.delete(`/translate/histories/${id}`)
}
