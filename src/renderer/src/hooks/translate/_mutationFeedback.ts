import type { loggerService } from '@logger'
import { useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Shared options for translate mutation hooks. All flags default to each hook's
 * own per-operation defaults (documented on the hook) — override individually
 * at call sites that want different behavior.
 */
export interface MutationFeedbackOptions {
  /** Show a toast on success. */
  showSuccessToast?: boolean
  /** Show a toast on failure. */
  showErrorToast?: boolean
  /**
   * Rethrow the error after logging / toasting so callers can keep popovers
   * and modals open for retry. Set to `false` for fire-and-forget handlers.
   */
  rethrowError?: boolean
}

type FeedbackLogger = ReturnType<typeof loggerService.withContext>

interface FeedbackContext {
  logger: FeedbackLogger
  /** Label written to `logger.error` on failure. Never suppressed. */
  errorLogMessage: string
  /** i18n key for the success toast. */
  successToastKey: string
  /** i18n key for the error toast. */
  errorToastKey: string
  /** Per-hook defaults applied when the consumer omits an option. */
  defaults: Required<MutationFeedbackOptions>
}

/**
 * Wraps a mutation function with standardized feedback:
 *
 * - **Always** logs errors via `context.logger.error` (no opt-out, so Sentry
 *   never silently loses a mutation failure).
 * - Conditionally emits success/error toasts.
 * - Conditionally rethrows the error so consumers that rely on throw-to-keep-open
 *   semantics (PopoverConfirm, Modal submit) still work.
 *
 * @internal Only exported for use by the translate mutation hooks in this folder.
 */
export function useMutationFeedback<Args extends unknown[], Result>(
  mutation: (...args: Args) => Promise<Result>,
  options: MutationFeedbackOptions | undefined,
  context: FeedbackContext
): (...args: Args) => Promise<Result | undefined> {
  const { t } = useTranslation()

  const mutationRef = useRef(mutation)
  const contextRef = useRef(context)
  mutationRef.current = mutation
  contextRef.current = context

  const showSuccessToast = options?.showSuccessToast ?? context.defaults.showSuccessToast
  const showErrorToast = options?.showErrorToast ?? context.defaults.showErrorToast
  const rethrowError = options?.rethrowError ?? context.defaults.rethrowError

  return useCallback(
    async (...args: Args): Promise<Result | undefined> => {
      try {
        const result = await mutationRef.current(...args)
        // Optional chain in case the host window has no toast shim — failing
        // here would mask the success path; failing in catch would mask the
        // original mutation error.
        if (showSuccessToast) window.toast?.success(t(contextRef.current.successToastKey))
        return result
      } catch (e) {
        contextRef.current.logger.error(contextRef.current.errorLogMessage, e as Error)
        if (showErrorToast) window.toast?.error(t(contextRef.current.errorToastKey))
        if (rethrowError) throw e
        return undefined
      }
    },
    [t, showSuccessToast, showErrorToast, rethrowError]
  )
}
