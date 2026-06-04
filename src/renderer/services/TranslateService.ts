import { isTranslateLangCode, type TranslateLangCode } from '@shared/data/preference/preferenceTypes'
import type { TranslateLanguage } from '@shared/data/types/translate'
import { t } from 'i18next'
import { v4 as uuid } from 'uuid'

/** Must stay in sync with main-side prefix (validated in `translateService.open`). */
const TRANSLATE_STREAM_PREFIX = 'translate:'

/**
 * Translate `text` to `targetLanguage` via main's `Ai_Translate_Open` IPC.
 * Per-chunk `onResponse(accumulated, isComplete)` lets the caller pace the
 * display (see `useSmoothStream`). `signal` aborts via `Ai_Stream_Abort`.
 */
export const translateText = async (
  text: string,
  targetLanguage: TranslateLangCode | TranslateLanguage,
  onResponse?: (text: string, isComplete: boolean) => void,
  signal?: AbortSignal
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
      void window.api.ai.streamAbort({ topicId: streamId }).catch(() => {
        // Already aborted / stream gone — main drives the final reject via onStreamError.
      })
    }
    signal.addEventListener('abort', abortListener, { once: true })
  }

  return new Promise<string>((resolve, reject) => {
    // Subscribe **before** calling main. Main starts the stream synchronously
    // inside `translate.open`, so the first chunk can land between `open()`'s
    // resolve and any post-await subscriber registration.
    unsubscribers.push(
      window.api.ai.onStreamChunk(({ topicId, chunk }) => {
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
      window.api.ai.onStreamDone(({ topicId }) => {
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
      window.api.ai.onStreamError(({ topicId, error }) => {
        if (topicId !== streamId) return
        cleanup()
        // Preserve error.name (e.g. 'AbortError') so downstream
        // `isAbortError(...)` classifies user stops correctly.
        const err = new Error(error?.message ?? 'Translation stream error')
        if (error?.name) err.name = error.name
        reject(err)
      })
    )

    window.api.translate.open({ streamId, text, targetLangCode }).catch((openError: unknown) => {
      cleanup()
      reject(openError instanceof Error ? openError : new Error(String(openError)))
    })
  })
}
