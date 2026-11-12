import { t } from 'i18next'
import { v4 as uuid } from 'uuid'

import { ipcApi } from '@renderer/ipc'
import { isTranslateLangCode, type TranslateLangCode } from '@shared/data/preference/preferenceTypes'
import type { UniqueModelId } from '@shared/data/types/model'
import type { TranslateLanguage } from '@shared/data/types/translate'

/** Must stay in sync with main-side prefix (validated in `translateService.open`). */
const TRANSLATE_STREAM_PREFIX = 'translate:'

/**
 * Translate `text` to `targetLanguage` via main's `translate.open` IPC.
 * Per-chunk `onResponse(accumulated, isComplete)` lets the caller pace the
 * display (see `useSmoothStream`). `signal` aborts via the `ai.stream.abort` route.
 */
export const translateText = async (
  text: string,
  targetLanguage: TranslateLangCode | TranslateLanguage,
  onResponse?: (text: string, isComplete: boolean) => void,
  signal?: AbortSignal,
  modelId?: UniqueModelId
): Promise<string> => {
  if (signal?.aborted) {
    throw new DOMException('Translation aborted before start', 'AbortError')
  }

  const targetLangCode = typeof targetLanguage === 'string' ? targetLanguage : targetLanguage.langCode
  if (!isTranslateLangCode(targetLangCode) || targetLangCode === 'unknown') {
    throw new Error(`Invalid target language: ${targetLangCode}`)
  }

  const streamId = `${TRANSLATE_STREAM_PREFIX}${uuid()}`

  let accumulated = ''
  let cleaned = false
  const unsubscribers: Array<() => void> = []

  let abortListener: (() => void) | undefined
  const cleanup = () => {
    if (cleaned) return
    cleaned = true
    for (const off of unsubscribers) {
      try {
        off()
      } catch {
        // listener unsub never throws meaningfully
      }
    }
    if (signal && abortListener) signal.removeEventListener('abort', abortListener)
  }

  return new Promise<string>((resolve, reject) => {
    let aborted = false
    const sendAbort = () => {
      void ipcApi.request('ai.stream.abort', { topicId: streamId }).catch(() => {})
    }
    abortListener = () => {
      if (cleaned) return
      aborted = true
      cleanup()
      reject(new DOMException('Translation aborted', 'AbortError'))
      sendAbort()
    }
    signal?.addEventListener('abort', abortListener, { once: true })

    // Subscribe **before** calling main. Main starts the stream synchronously
    // inside `translate.open`, so the first chunk can land between `open()`'s
    // resolve and any post-await subscriber registration.
    unsubscribers.push(
      ipcApi.on('ai.stream.chunk', ({ topicId, chunk }) => {
        if (topicId !== streamId) return
        if (
          chunk &&
          (chunk as { type?: string }).type === 'text-delta' &&
          typeof (chunk as { delta?: unknown }).delta === 'string'
        ) {
          accumulated += (chunk as { delta: string }).delta
          onResponse?.(accumulated, false)
        }
      })
    )

    unsubscribers.push(
      ipcApi.on('ai.stream.done', ({ topicId }) => {
        if (topicId !== streamId) return
        const trimmed = accumulated.trim()
        cleanup()
        if (!trimmed) {
          reject(new Error(t('translate.error.empty')))
          return
        }
        onResponse?.(trimmed, true)
        resolve(trimmed)
      })
    )

    unsubscribers.push(
      ipcApi.on('ai.stream.error', ({ topicId, error }) => {
        if (topicId !== streamId) return
        cleanup()
        // Preserve error.name (e.g. 'AbortError') so downstream
        // `isAbortError(...)` classifies user stops correctly.
        const err = new Error(error?.message ?? 'Translation stream error')
        if (error?.name) err.name = error.name
        reject(err)
      })
    )

    void ipcApi
      .request('translate.open', { streamId, text, targetLangCode, ...(modelId !== undefined && { modelId }) })
      .then(
        () => {
          if (aborted) sendAbort()
        },
        (openError: unknown) => {
          if (cleaned) return
          cleanup()
          reject(openError instanceof Error ? openError : new Error(String(openError)))
        }
      )
  })
}
