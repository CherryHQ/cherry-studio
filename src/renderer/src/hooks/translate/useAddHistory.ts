import { useMutation } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import type { CreateTranslateHistoryDto } from '@shared/data/api/schemas/translate'

import { type MutationFeedbackOptions, useMutationFeedback } from './_mutationFeedback'

const logger = loggerService.withContext('translate/useAddHistory')

/**
 * Hook that returns a callback to create a new translate history record.
 *
 * Sends a `POST /translate/histories` request and refreshes the history list
 * on success.
 *
 * @param options - Feedback options. Per-operation defaults:
 *   - `showSuccessToast: false` — the new entry appears in the history list automatically
 *   - `showErrorToast: true`
 *   - `rethrowError: true`
 */
export const useAddHistory = (options?: MutationFeedbackOptions) => {
  const { trigger } = useMutation('POST', '/translate/histories', {
    refresh: ['/translate/histories']
  })

  return useMutationFeedback((data: CreateTranslateHistoryDto) => trigger({ body: data }), options, {
    logger,
    errorLogMessage: 'Failed to add translate history',
    successToastKey: 'translate.history.success.add',
    errorToastKey: 'translate.history.error.add',
    defaults: { showSuccessToast: false, showErrorToast: true, rethrowError: true }
  })
}
