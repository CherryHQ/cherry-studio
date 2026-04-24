import { useMutation } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'

import { type MutationFeedbackOptions, useMutationFeedback } from './_mutationFeedback'

const logger = loggerService.withContext('translate/useDeleteLanguage')

/**
 * Hook that returns a callback to delete a translate language.
 *
 * Uses the template path `/translate/languages/:langCode` so the SWR key stays
 * stable regardless of which language is being deleted; the langCode travels
 * via trigger `params`.
 *
 * @param langCode - The language code to delete; must be non-empty when the
 *   returned callback is invoked.
 * @param options - Feedback options. Per-operation defaults:
 *   - `showSuccessToast: true` — table refreshes are subtle, toast confirms the delete
 *   - `showErrorToast: true`
 *   - `rethrowError: true`
 */
export const useDeleteLanguage = (langCode: string, options?: MutationFeedbackOptions) => {
  const { trigger } = useMutation('DELETE', '/translate/languages/:langCode', {
    refresh: ['/translate/languages']
  })

  return useMutationFeedback(
    () => {
      if (!langCode) {
        throw new Error('useDeleteLanguage: langCode must be non-empty when triggering delete')
      }
      return trigger({ params: { langCode } })
    },
    options,
    {
      logger,
      errorLogMessage: 'Failed to delete translate language',
      successToastKey: 'settings.translate.custom.success.delete',
      errorToastKey: 'settings.translate.custom.error.delete',
      defaults: { showSuccessToast: true, showErrorToast: true, rethrowError: true }
    }
  )
}
