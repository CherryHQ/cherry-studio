import { useMutation } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import type { UpdateTranslateHistoryDto } from '@shared/data/api/schemas/translate'

import { type MutationFeedbackOptions, useMutationFeedback } from './_mutationFeedback'

const logger = loggerService.withContext('translate/useUpdateHistory')

/**
 * Hook that returns a callback to update a translate history entry.
 *
 * Sends a `PATCH /translate/histories/:id` request and refreshes the history
 * list on success.
 *
 * @param id - The ID of the translate history to update
 * @param options - Feedback options. Per-operation defaults:
 *   - `showSuccessToast: false` — visual changes (e.g. star toggle, text edit) are self-evident
 *   - `showErrorToast: true`
 *   - `rethrowError: true`
 */
export const useUpdateHistory = (id: string, options?: MutationFeedbackOptions) => {
  const { trigger } = useMutation('PATCH', `/translate/histories/${id}`, {
    refresh: ['/translate/histories']
  })

  return useMutationFeedback((data: UpdateTranslateHistoryDto) => trigger({ body: data }), options, {
    logger,
    errorLogMessage: 'Failed to update translate history',
    successToastKey: 'translate.history.success.update',
    errorToastKey: 'translate.history.error.save',
    defaults: { showSuccessToast: false, showErrorToast: true, rethrowError: true }
  })
}
