import { useMutation } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'

import { type MutationFeedbackOptions, useMutationFeedback } from './_mutationFeedback'

const logger = loggerService.withContext('translate/useDeleteHistory')

/**
 * Hook that returns a callback to delete a translate history entry.
 *
 * Sends a `DELETE /translate/histories/:id` request and refreshes the history
 * list on success.
 *
 * @param id - The ID of the translate history to delete
 * @param options - Feedback options. Per-operation defaults:
 *   - `showSuccessToast: false` — the row disappears from the history list
 *   - `showErrorToast: true`
 *   - `rethrowError: true`
 */
export const useDeleteHistory = (id: string, options?: MutationFeedbackOptions) => {
  const { trigger } = useMutation('DELETE', `/translate/histories/${id}`, {
    refresh: ['/translate/histories']
  })

  return useMutationFeedback(() => trigger(), options, {
    logger,
    errorLogMessage: 'Failed to delete translate history',
    successToastKey: 'translate.history.success.delete',
    errorToastKey: 'translate.history.error.delete',
    defaults: { showSuccessToast: false, showErrorToast: true, rethrowError: true }
  })
}
