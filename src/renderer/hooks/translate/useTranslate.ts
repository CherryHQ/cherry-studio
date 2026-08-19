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
 * Callers that need rich rendering can use `onResponse` to mirror the streamed
 * accumulated text into their own view state.
 */

import { loggerService } from '@logger'
import type { TabSessionHandle } from '@renderer/services/TabSessionRegistry'
import { toast } from '@renderer/services/toast'
import { formatErrorMessageWithPrefix, isAbortError } from '@renderer/utils/error'
import { translateText } from '@renderer/utils/translate'
import type { TranslateLangCode } from '@shared/data/preference/preferenceTypes'
import type { TranslateLanguage } from '@shared/data/types/translate'
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { v4 as uuid } from 'uuid'

const TRANSLATE_ERROR_KEY_PATTERN = /\btranslate\.error\.[a-zA-Z0-9_.-]+\b/

function localizeTranslateError(error: unknown, t: (key: string) => string): unknown {
  if (!(error instanceof Error)) return error

  const key = error.message.match(TRANSLATE_ERROR_KEY_PATTERN)?.[0]
  if (!key) return error

  const localizedError = new Error(t(key))
  localizedError.name = error.name
  localizedError.stack = error.stack
  localizedError.cause = error.cause
  return localizedError
}

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
  /**
   * Bind the run to a tab session instead of to this component. The session owns the abort
   * controller and carries `isTranslating` in cache, so hibernating the tab or switching away
   * from it no longer cancels the run and a remounted page picks it back up (#18885).
   *
   * Omit it wherever the component genuinely is the run's owner — a popup or an overlay that the
   * user dismissed has no reason to keep translating.
   */
  session?: TabSessionHandle | null
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

const NEVER_BUSY = () => false
const NO_SUBSCRIPTION = () => () => {}

export function useTranslate(options?: UseTranslateOptions): UseTranslateResult {
  const { t } = useTranslation()
  const session = options?.session ?? null

  const [localIsTranslating, setLocalIsTranslating] = useState(false)
  // A session-owned run outlives this component, so its running state has to be read from the
  // session rather than mirrored into component state — a page that remounts mid-run (tab switch,
  // hibernation) must come back showing the run that is still going.
  const sessionIsTranslating = useSyncExternalStore(
    session?.subscribe ?? NO_SUBSCRIPTION,
    session?.isBusy ?? NEVER_BUSY
  )
  const isTranslating = session ? sessionIsTranslating : localIsTranslating

  // Called from continuations that may outlive this mount; with a session the running state lives
  // in the session itself, so there is nothing to write here.
  const setTranslating = useCallback((running: boolean) => {
    setLocalIsTranslating(running)
  }, [])

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
    // With a session the run may have been started by an earlier mount, so this component's refs
    // can be empty while a translation is still going — go through the session, which holds it.
    if (session) {
      session.abortTasks()
      activeAbortKeyRef.current = null
      activeControllerRef.current = null
      return
    }

    if (!activeAbortKeyRef.current) return
    // Clear the ref first so the in-flight translate's continuation sees
    // "you've been cancelled" and discards its result even if the abort
    // doesn't unwind the underlying IPC immediately.
    activeAbortKeyRef.current = null
    activeControllerRef.current?.abort()
    activeControllerRef.current = null
    setTranslating(false)
  }, [session, setTranslating])

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
      const finishTask = session?.addTask(controller)

      if (!session) setTranslating(true)

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
        finishTask?.()
        if (activeAbortKeyRef.current === abortKey) {
          activeAbortKeyRef.current = null
          activeControllerRef.current = null
          setTranslating(false)
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
          toast.error(formatErrorMessageWithPrefix(localizeTranslateError(error, t), t(errorPrefixI18nKey)))
        }
        if (opts?.rethrowError) throw error
        return undefined
      } finally {
        finishIfActive()
      }
    },
    [session, setTranslating, t]
  )

  // On unmount: abort the active controller (propagates to main via streamAbort
  // inside translateText) and clear the marker so any late settle is discarded.
  // A session-owned run is exempt — the tab, not this component, decides when it ends.
  useEffect(() => {
    if (session) return
    return () => {
      activeAbortKeyRef.current = null
      activeControllerRef.current?.abort()
      activeControllerRef.current = null
    }
  }, [session])

  return { translate, isTranslating, cancel }
}
