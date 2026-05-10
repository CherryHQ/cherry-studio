import { dataApiService } from '@data/DataApiService'
import { loggerService } from '@logger'
import type { AssistantSettings, FetchChatCompletionRequestOptions, ReasoningEffortOption } from '@renderer/types'
import type { Chunk } from '@renderer/types/chunk'
import { ChunkType } from '@renderer/types/chunk'
import { readyToAbort } from '@renderer/utils/abortController'
import { isAbortError } from '@renderer/utils/error'
import { isTranslateLangCode, type TranslateLangCode } from '@shared/data/preference/preferenceTypes'
import type { TranslateLanguage } from '@shared/data/types/translate'
import { NoOutputGeneratedError } from 'ai'
import { t } from 'i18next'

import { fetchChatCompletion } from './ApiService'
import { getDefaultTranslateAssistant } from './AssistantService'

const logger = loggerService.withContext('TranslateService')

type TranslateOptions = {
  reasoningEffort: ReasoningEffortOption
}

/**
 * Translate text into the target language via streaming chat completion.
 * @param text - The source text to translate
 * @param targetLanguage - Target language, either as a {@link TranslateLangCode} string or a {@link TranslateLanguage} object
 * @param onResponse - Streaming callback invoked on every chunk with the accumulated text and a completion flag
 * @param abortKey - Optional key used to abort the request via {@link readyToAbort}
 * @param options - Optional settings (e.g. reasoning effort)
 * @returns The trimmed translated text
 * @throws {Error} When translation is aborted, fails, or produces empty output
 */
export const translateText = async (
  text: string,
  targetLanguage: TranslateLangCode | TranslateLanguage,
  onResponse?: (text: string, isComplete: boolean) => void,
  abortKey?: string,
  options?: TranslateOptions
) => {
  let error: unknown
  const assistantSettings: Partial<AssistantSettings> | undefined = options
    ? { reasoning_effort: options?.reasoningEffort }
    : undefined

  // TODO: modify here when aisdk is migrated to main process
  if (typeof targetLanguage === 'string') {
    if (!isTranslateLangCode(targetLanguage) || targetLanguage === 'unknown') {
      throw new Error(`Invalid target language: ${targetLanguage}`)
    }
    const langDto = await dataApiService.get(`/translate/languages/${targetLanguage}`)
    targetLanguage = langDto
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
    if (!NoOutputGeneratedError.isInstance(e)) {
      throw e
    }
    logger.debug('Swallowed NoOutputGeneratedError', e as Error)
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
