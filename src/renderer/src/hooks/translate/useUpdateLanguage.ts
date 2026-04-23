import { useMutation } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import type { UpdateTranslateLanguageDto } from '@shared/data/api/schemas/translate'

import { type MutationFeedbackOptions, useMutationFeedback } from './_mutationFeedback'

const logger = loggerService.withContext('translate/useUpdateLanguage')

/**
 * Hook that returns a callback to update a translate language.
 *
 * Sends a `PATCH /translate/languages/:langCode` request and refreshes the
 * language list on success. Optimistic update is intentionally omitted: the
 * previous implementation pre-filled cache from stale "current" data with empty
 * timestamps (would fail downstream Zod validation and render "Invalid Date"),
 * and the framework's static `optimisticData` cannot merge with per-trigger
 * arguments — a proper fix belongs at the `useMutation` layer and is out of
 * scope here.
 *
 * @param langCode - The language code to update
 * @param options - Feedback options. Per-operation defaults:
 *   - `showSuccessToast: true` — table refreshes are subtle, toast confirms the update
 *   - `showErrorToast: true`
 *   - `rethrowError: true`
 */
export const useUpdateLanguage = (langCode: string, options?: MutationFeedbackOptions) => {
  const { trigger } = useMutation('PATCH', `/translate/languages/${langCode}`, {
    refresh: ['/translate/languages']
  })

  return useMutationFeedback((data: UpdateTranslateLanguageDto) => trigger({ body: data }), options, {
    logger,
    errorLogMessage: 'Failed to update translate language',
    successToastKey: 'settings.translate.custom.success.update',
    errorToastKey: 'settings.translate.custom.error.update',
    defaults: { showSuccessToast: true, showErrorToast: true, rethrowError: true }
  })
}
