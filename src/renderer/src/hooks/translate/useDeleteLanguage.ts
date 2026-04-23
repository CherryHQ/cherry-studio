import { useMutation } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'

import { type MutationFeedbackOptions, useMutationFeedback } from './_mutationFeedback'

const logger = loggerService.withContext('translate/useDeleteLanguage')

/**
 * Hook that returns a callback to delete a translate language.
 *
 * Sends a `DELETE /translate/languages/:langCode` request and refreshes the
 * language list on success.
 *
 * @param langCode - The language code to delete
 * @param options - Feedback options. Per-operation defaults:
 *   - `showSuccessToast: true` — table refreshes are subtle, toast confirms the delete
 *   - `showErrorToast: true`
 *   - `rethrowError: true`
 */
export const useDeleteLanguage = (langCode: string, options?: MutationFeedbackOptions) => {
  const { trigger } = useMutation('DELETE', `/translate/languages/${langCode}`, {
    refresh: ['/translate/languages']
  })

  return useMutationFeedback(() => trigger(), options, {
    logger,
    errorLogMessage: 'Failed to delete translate language',
    successToastKey: 'settings.translate.custom.success.delete',
    errorToastKey: 'settings.translate.custom.error.delete',
    defaults: { showSuccessToast: true, showErrorToast: true, rethrowError: true }
  })
}
