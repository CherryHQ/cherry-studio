/**
 * `useTranslate` — single owner of the translate-call boilerplate.
 *
 * Replaces the repeated `isTranslating` flag + try/catch + isAbortError
 * suppression + toast/log wiring that every translate consumer used to
 * hand-roll. See GitHub issue #14533 for motivation.
 *
 * Behaviour:
 *   - Only one translation is in flight at a time. Calling `translate()`
 *     while another is running aborts the previous one and starts fresh.
 *   - User-initiated aborts (`isAbortError(err)` or `cancel()`) resolve to
 *     `undefined` silently — no log, no toast — so consumers can rely on
 *     `if (result)` to gate success-side effects.
 *   - Non-abort errors are always logged via `loggerService`; the toast and
 *     the rethrow are opt-out via `options`.
 *   - Unmounting the host component aborts any in-flight translation so
 *     stale completions don't run state setters on a dead tree.
 *
 * Out of scope: streaming chat consumers like `ActionTranslate` — those use
 * `useChat` + `sendMessage`, not `translateText`.
 */

import { loggerService } from '@logger'
import { translateText } from '@renderer/services/TranslateService'
import { formatErrorMessageWithPrefix, isAbortError } from '@renderer/utils/error'
import type { TranslateLangCode } from '@shared/data/preference/preferenceTypes'
import type { TranslateLanguage } from '@shared/data/types/translate'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { v4 as uuid } from 'uuid'

export interface UseTranslateOptions {
  /** Default: true. Set false to suppress the default error toast. */
  showErrorToast?: boolean
  /** Default: 'translate.error.failed'. i18n key used as the toast prefix. */
  errorPrefixI18nKey?: string
  /**
   * Default: false. When true, non-abort errors rethrow after logging/toasting
   * so callers that need to keep popovers / modals open for retry can catch.
   */
  rethrowError?: boolean
  /** Optional progressive callback — passed through to {@link translateText}. */
  onResponse?: (text: string, isComplete: boolean) => void
  /** Logger context name. Default: 'useTranslate'. */
  loggerContext?: string
}

export interface UseTranslateResult {
  /**
   * Run a translation. Resolves with the trimmed text on success and
   * `undefined` on user-initiated abort or on a swallowed error
   * (when `rethrowError` is false).
   */
  translate: (text: string, targetLanguage: TranslateLangCode | TranslateLanguage) => Promise<string | undefined>
  isTranslating: boolean
  /** Abort the in-flight translation. No-op when nothing is running. */
  cancel: () => void
}

export function useTranslate(options?: UseTranslateOptions): UseTranslateResult {
  const { t } = useTranslation()
  const [isTranslating, setIsTranslating] = useState(false)

  const optionsRef = useRef(options)
  useEffect(() => {
    optionsRef.current = options
  })

  // Tracks the abort key of the currently in-flight translation. `null` when
  // nothing is running or the active translation has been cancelled /
  // superseded. Used as the source-of-truth for "is this call still ours?"
  // checks against late-resolving IPC promises. Paired with `activeControllerRef`
  // which owns the actual AbortSignal threaded into `translateText` →
  // `streamAbort`.
  const activeAbortKeyRef = useRef<string | null>(null)
  const activeControllerRef = useRef<AbortController | null>(null)

  const cancel = useCallback(() => {
    if (!activeAbortKeyRef.current) return
    // Clear the ref first so the in-flight translate's continuation sees
    // "you've been cancelled" and discards its result even if the abort
    // doesn't unwind the underlying IPC immediately.
    activeAbortKeyRef.current = null
    activeControllerRef.current?.abort()
    activeControllerRef.current = null
    setIsTranslating(false)
  }, [])

  const translate = useCallback<UseTranslateResult['translate']>(
    async (text, targetLanguage) => {
      // A new call supersedes any in-flight one — keeps semantics simple
      // (one translation per hook instance) and matches the existing stop-button
      // behaviour in TranslatePage.
      activeControllerRef.current?.abort()
      const controller = new AbortController()
      activeControllerRef.current = controller
      activeAbortKeyRef.current = uuid()
      const abortKey = activeAbortKeyRef.current

      setIsTranslating(true)

      // Gate the progressive callback so a late `onResponse` from a
      // cancelled / superseded run doesn't write into consumer state.
      const onResponse = optionsRef.current?.onResponse
      const guardedOnResponse = onResponse
        ? (chunkText: string, isComplete: boolean) => {
            if (activeAbortKeyRef.current !== abortKey) return
            onResponse(chunkText, isComplete)
          }
        : undefined

      const wasSuperseded = () => activeAbortKeyRef.current !== abortKey
      const finishIfActive = () => {
        if (activeAbortKeyRef.current === abortKey) {
          activeAbortKeyRef.current = null
          activeControllerRef.current = null
          setIsTranslating(false)
        }
      }

      try {
        const result = await translateText(text, targetLanguage, guardedOnResponse, controller.signal)
        if (wasSuperseded()) {
          // Cancelled or superseded mid-flight — discard the result so the
          // caller's `if (result)` success branch stays gated.
          return undefined
        }
        return result
      } catch (error) {
        if (wasSuperseded() || isAbortError(error)) {
          // User-initiated cancel — swallow silently.
          return undefined
        }
        const opts = optionsRef.current
        const showErrorToast = opts?.showErrorToast ?? true
        const errorPrefixI18nKey = opts?.errorPrefixI18nKey ?? 'translate.error.failed'
        loggerService.withContext(opts?.loggerContext ?? 'useTranslate').error('Translation failed', error as Error)
        if (showErrorToast) {
          window.toast?.error(formatErrorMessageWithPrefix(error, t(errorPrefixI18nKey)))
        }
        if (opts?.rethrowError) throw error
        return undefined
      } finally {
        finishIfActive()
      }
    },
    [t]
  )

  // On unmount: abort the active controller (propagates to main via streamAbort
  // inside translateText) and clear the marker so any late settle is discarded.
  useEffect(() => {
    return () => {
      activeAbortKeyRef.current = null
      activeControllerRef.current?.abort()
      activeControllerRef.current = null
    }
  }, [])

  return { translate, isTranslating, cancel }
}
