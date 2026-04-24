import { useMutation } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import type { UpdateTranslateLanguageDto } from '@shared/data/api/schemas/translate'

import { type MutationFeedbackOptions, useMutationFeedback } from './_mutationFeedback'

const logger = loggerService.withContext('translate/useUpdateLanguage')

/**
 * Hook that returns a callback to update a translate language.
 *
 * Uses the template path `/translate/languages/:langCode` so the SWR key stays
 * stable regardless of which language is being updated; the langCode travels
 * via trigger `params`. Optimistic update is intentionally omitted: the
 * previous implementation pre-filled cache from stale "current" data with empty
 * timestamps (would fail downstream Zod validation and render "Invalid Date"),
 * and the framework's static `optimisticData` cannot merge with per-trigger
 * arguments — a proper fix belongs at the `useMutation` layer and is out of
 * scope here.
 *
 * @param langCode - The language code to update; may be empty at hook init
 *   (e.g. when the consuming modal hasn't entered edit mode yet) — the trigger
 *   throws if called before a real code is bound.
 * @param options - Feedback options. Per-operation defaults:
 *   - `showSuccessToast: true` — table refreshes are subtle, toast confirms the update
 *   - `showErrorToast: true`
 *   - `rethrowError: true`
 */
export const useUpdateLanguage = (langCode: string, options?: MutationFeedbackOptions) => {
  const { trigger } = useMutation('PATCH', '/translate/languages/:langCode', {
    refresh: ['/translate/languages']
  })

  return useMutationFeedback(
    (data: UpdateTranslateLanguageDto) => {
      if (!langCode) {
        throw new Error('useUpdateLanguage: langCode must be non-empty when triggering update')
      }
      return trigger({ params: { langCode }, body: data })
    },
    options,
    {
      logger,
      errorLogMessage: 'Failed to update translate language',
      successToastKey: 'settings.translate.custom.success.update',
      errorToastKey: 'settings.translate.custom.error.update',
      defaults: { showSuccessToast: true, showErrorToast: true, rethrowError: true }
    }
  )
}
