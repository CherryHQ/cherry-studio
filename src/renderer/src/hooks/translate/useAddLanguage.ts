import { useMutation } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import type { CreateTranslateLanguageDto } from '@shared/data/api/schemas/translate'

import { type MutationFeedbackOptions, useMutationFeedback } from './_mutationFeedback'

const logger = loggerService.withContext('translate/useAddLanguage')

/**
 * Hook that returns a callback to add a translate language.
 *
 * Sends a `POST /translate/languages` request and refreshes the language list
 * on success.
 *
 * @param options - Feedback options. Per-operation defaults:
 *   - `showSuccessToast: true` — table refreshes are subtle, toast confirms the add
 *   - `showErrorToast: true`
 *   - `rethrowError: true`
 */
export const useAddLanguage = (options?: MutationFeedbackOptions) => {
  const { trigger } = useMutation('POST', '/translate/languages', {
    refresh: ['/translate/languages']
  })

  return useMutationFeedback((data: CreateTranslateLanguageDto) => trigger({ body: data }), options, {
    logger,
    errorLogMessage: 'Failed to add translate language',
    successToastKey: 'settings.translate.custom.success.add',
    errorToastKey: 'settings.translate.custom.error.add',
    defaults: { showSuccessToast: true, showErrorToast: true, rethrowError: true }
  })
}
