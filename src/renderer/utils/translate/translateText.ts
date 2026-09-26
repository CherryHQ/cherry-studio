import { t } from 'i18next'
import { v4 as uuid } from 'uuid'

import { ipcApi } from '@renderer/ipc'
import { isTranslateLangCode, type TranslateLangCode } from '@shared/data/preference/preferenceTypes'
import type { TranslateLanguage } from '@shared/data/types/translate'

/** Must stay in sync with main-side prefix (validated in `translateService.open`). */
const TRANSLATE_STREAM_PREFIX = 'translate:'

/**
 * Translate `text` to `targetLanguage` via main's `translate.open` IPC.
 * Per-chunk `onResponse(accumulated, isComplete)` lets the caller pace the
 * display (see `useSmoothStream`). `signal` aborts via the `ai.stream.abort` route.
 * Optional image bytes are captured during the user's paste/select action and attached as a vision file part.
 */
export const translateText = async (
  text: string,
  targetLanguage: TranslateLangCode | TranslateLanguage,
  onResponse?: (text: string, isComplete: boolean) => void,
  signal?: AbortSignal,
  image?: { data: Uint8Array; filename: string }
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

  if (signal) {
    abortListener = () => {
      void ipcApi.request('ai.stream.abort', { topicId: streamId }).catch(() => {
        // Already aborted / stream gone — main drives the final reject via the stream error event.
      })
    }
    signal.addEventListener('abort', abortListener, { once: true })
  }

  return new Promise<string>((resolve, reject) => {
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
      ipcApi.on('ai.stream.done', ({ topicId, status }) => {
        if (topicId !== streamId) return
        if (status === 'paused' || signal?.aborted) {
          cleanup()
          reject(new DOMException('Translation aborted', 'AbortError'))
          return
        }
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

    const openRequest = ipcApi.request('translate.open', {
      streamId,
      text,
      targetLangCode,
      ...(image ? { image } : {})
    })
    if (signal?.aborted) abortListener?.()

    openRequest
      .then(() => {
        // `translate.open` may await FileManager before registering the stream.
        // An abort sent during that window is intentionally retried once the open
        // completes, when AiStreamManager is guaranteed to know this topic.
        if (signal?.aborted && !cleaned) abortListener?.()
      })
      .catch((openError: unknown) => {
        cleanup()
        reject(openError instanceof Error ? openError : new Error(String(openError)))
      })
  })
}
