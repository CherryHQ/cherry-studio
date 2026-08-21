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
 *   - Unmounting aborts component-owned calls. Calls with an explicit
 *     `sessionId` are window-owned and can reconnect after a remount.
 *
 * Callers that need rich rendering can use `onResponse` to mirror the streamed
 * accumulated text into their own view state.
 */

import { loggerService } from '@logger'
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
  /**
   * Stable window-level session id. When set, the submitted translation keeps
   * running if its page unmounts and a remount reconnects to the same state.
   */
  sessionId?: string
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

export type TranslateSessionRuntimeStatus = 'completed' | 'error' | 'idle' | 'running'

interface TranslateSessionRuntimeSnapshot {
  isTranslating: boolean
  status: TranslateSessionRuntimeStatus
}

interface TranslateSessionRuntime {
  snapshot: TranslateSessionRuntimeSnapshot
  activeAbortKey: string | null
  controller: AbortController | null
  listeners: Set<() => void>
}

const IDLE_TRANSLATE_SESSION_SNAPSHOT: TranslateSessionRuntimeSnapshot = {
  isTranslating: false,
  status: 'idle'
}
const translateSessionRuntimes = new Map<string, TranslateSessionRuntime>()
const translateWorkspaceListeners = new Set<() => void>()
let translateWorkspaceStatus: TranslateSessionRuntimeStatus = 'idle'

const TRANSLATE_STATUS_PRIORITY: Record<TranslateSessionRuntimeStatus, number> = {
  idle: 0,
  completed: 1,
  running: 2,
  error: 3
}

function getTranslateSessionRuntime(sessionId: string): TranslateSessionRuntime {
  let runtime = translateSessionRuntimes.get(sessionId)
  if (!runtime) {
    runtime = {
      snapshot: IDLE_TRANSLATE_SESSION_SNAPSHOT,
      activeAbortKey: null,
      controller: null,
      listeners: new Set()
    }
    translateSessionRuntimes.set(sessionId, runtime)
  }
  return runtime
}

function refreshTranslateWorkspaceStatus(): void {
  let nextStatus: TranslateSessionRuntimeStatus = 'idle'
  for (const runtime of translateSessionRuntimes.values()) {
    if (TRANSLATE_STATUS_PRIORITY[runtime.snapshot.status] > TRANSLATE_STATUS_PRIORITY[nextStatus]) {
      nextStatus = runtime.snapshot.status
    }
  }
  if (nextStatus === translateWorkspaceStatus) return
  translateWorkspaceStatus = nextStatus
  for (const listener of translateWorkspaceListeners) listener()
}

function updateTranslateSessionRuntime(
  runtime: TranslateSessionRuntime,
  snapshot: TranslateSessionRuntimeSnapshot
): void {
  if (runtime.snapshot.isTranslating === snapshot.isTranslating && runtime.snapshot.status === snapshot.status) {
    return
  }
  runtime.snapshot = snapshot
  for (const listener of runtime.listeners) listener()
  refreshTranslateWorkspaceStatus()
}

/** Publish a non-text translation task into the same window-owned session runtime. */
export function setTranslateSessionRuntimeStatus(
  sessionId: string | undefined,
  status: TranslateSessionRuntimeStatus
): void {
  if (!sessionId) return
  updateTranslateSessionRuntime(getTranslateSessionRuntime(sessionId), {
    isTranslating: status === 'running',
    status
  })
}

/** Aggregate state for the Translate Sidebar entry. */
export function useTranslateWorkspaceRuntimeStatus(): TranslateSessionRuntimeStatus {
  return useSyncExternalStore(
    useCallback((listener) => {
      translateWorkspaceListeners.add(listener)
      return () => translateWorkspaceListeners.delete(listener)
    }, []),
    () => translateWorkspaceStatus,
    () => translateWorkspaceStatus
  )
}

/** Runtime state for one translate workspace/tab. */
export function useTranslateSessionRuntimeStatus(sessionId?: string): TranslateSessionRuntimeSnapshot {
  return useSyncExternalStore(
    useCallback(
      (listener) => {
        if (!sessionId) return () => undefined
        const runtime = getTranslateSessionRuntime(sessionId)
        runtime.listeners.add(listener)
        return () => runtime.listeners.delete(listener)
      },
      [sessionId]
    ),
    useCallback(
      () => (sessionId ? getTranslateSessionRuntime(sessionId).snapshot : IDLE_TRANSLATE_SESSION_SNAPSHOT),
      [sessionId]
    ),
    () => IDLE_TRANSLATE_SESSION_SNAPSHOT
  )
}

/** Clear terminal Translate indicators after the workspace is brought forward. */
export function markTranslateWorkspaceRuntimeSeen(): void {
  for (const runtime of translateSessionRuntimes.values()) {
    if (runtime.snapshot.isTranslating || runtime.snapshot.status === 'idle') continue
    updateTranslateSessionRuntime(runtime, IDLE_TRANSLATE_SESSION_SNAPSHOT)
  }
}

export function useTranslate(options?: UseTranslateOptions): UseTranslateResult {
  const { t } = useTranslation()
  const [isTranslating, setIsTranslating] = useState(false)
  const sessionId = options?.sessionId
  const sessionSnapshot = useTranslateSessionRuntimeStatus(sessionId)

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
    if (sessionId) {
      const runtime = getTranslateSessionRuntime(sessionId)
      if (!runtime.activeAbortKey) return
      runtime.activeAbortKey = null
      runtime.controller?.abort()
      runtime.controller = null
      updateTranslateSessionRuntime(runtime, IDLE_TRANSLATE_SESSION_SNAPSHOT)
      return
    }
    if (!activeAbortKeyRef.current) return
    // Clear the ref first so the in-flight translate's continuation sees
    // "you've been cancelled" and discards its result even if the abort
    // doesn't unwind the underlying IPC immediately.
    activeAbortKeyRef.current = null
    activeControllerRef.current?.abort()
    activeControllerRef.current = null
    setIsTranslating(false)
  }, [sessionId])

  const translate = useCallback<UseTranslateResult['translate']>(
    async (text, targetLanguage) => {
      if (sessionId) {
        const runtime = getTranslateSessionRuntime(sessionId)
        runtime.controller?.abort()
        const controller = new AbortController()
        const abortKey = uuid()
        runtime.controller = controller
        runtime.activeAbortKey = abortKey
        updateTranslateSessionRuntime(runtime, { isTranslating: true, status: 'running' })

        const opts = optionsRef.current
        const onResponse = opts?.onResponse
        const guardedOnResponse = onResponse
          ? (chunkText: string, isComplete: boolean) => {
              if (runtime.activeAbortKey !== abortKey) return
              onResponse(chunkText, isComplete)
            }
          : undefined
        const wasSuperseded = () => runtime.activeAbortKey !== abortKey

        try {
          const result = await translateText(text, targetLanguage, guardedOnResponse, controller.signal)
          if (wasSuperseded()) return undefined
          updateTranslateSessionRuntime(runtime, { isTranslating: true, status: 'completed' })
          return result
        } catch (error) {
          if (wasSuperseded() || isAbortError(error)) return undefined
          const showErrorToast = opts?.showErrorToast ?? true
          const errorPrefixI18nKey = opts?.errorPrefixI18nKey ?? 'translate.error.failed'
          loggerService.withContext(opts?.loggerContext ?? 'useTranslate').error('Translation failed', error as Error)
          if (showErrorToast) {
            toast.error(formatErrorMessageWithPrefix(localizeTranslateError(error, t), t(errorPrefixI18nKey)))
          }
          updateTranslateSessionRuntime(runtime, { isTranslating: true, status: 'error' })
          if (opts?.rethrowError) throw error
          return undefined
        } finally {
          if (runtime.activeAbortKey === abortKey) {
            runtime.activeAbortKey = null
            runtime.controller = null
            updateTranslateSessionRuntime(runtime, {
              isTranslating: false,
              status: runtime.snapshot.status
            })
          }
        }
      }

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
          toast.error(formatErrorMessageWithPrefix(localizeTranslateError(error, t), t(errorPrefixI18nKey)))
        }
        if (opts?.rethrowError) throw error
        return undefined
      } finally {
        finishIfActive()
      }
    },
    [sessionId, t]
  )

  // On unmount: abort the active controller (propagates to main via streamAbort
  // inside translateText) and clear the marker so any late settle is discarded.
  useEffect(() => {
    return () => {
      if (sessionId) return
      activeAbortKeyRef.current = null
      activeControllerRef.current?.abort()
      activeControllerRef.current = null
    }
  }, [sessionId])

  return { translate, isTranslating: sessionId ? sessionSnapshot.isTranslating : isTranslating, cancel }
}
