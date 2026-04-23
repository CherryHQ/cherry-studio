import { useMutation } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'

import { type MutationFeedbackOptions, useMutationFeedback } from './_mutationFeedback'

const logger = loggerService.withContext('translate/useClearHistory')

/**
 * Hook that returns a callback to clear all translate history entries.
 *
 * Sends a `DELETE /translate/histories` request and refreshes the history list
 * on success.
 *
 * @param options - Feedback options. Per-operation defaults:
 *   - `showSuccessToast: false` — the list empties immediately as feedback
 *   - `showErrorToast: true`
 *   - `rethrowError: true`
 */
export const useClearHistory = (options?: MutationFeedbackOptions) => {
  const { trigger } = useMutation('DELETE', '/translate/histories', {
    refresh: ['/translate/histories']
  })

  return useMutationFeedback(() => trigger(), options, {
    logger,
    errorLogMessage: 'Failed to clear translate history',
    successToastKey: 'translate.history.success.clear',
    errorToastKey: 'translate.history.error.clear',
    defaults: { showSuccessToast: false, showErrorToast: true, rethrowError: true }
  })
}
