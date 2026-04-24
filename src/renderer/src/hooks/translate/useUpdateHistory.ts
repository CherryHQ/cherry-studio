import { useMutation } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import { UNKNOWN } from '@renderer/config/translate'
import type { UpdateTranslateHistoryDto } from '@shared/data/api/schemas/translate'
import type { TranslateLangCode } from '@shared/data/preference/preferenceTypes'

import { type MutationFeedbackOptions, useMutationFeedback } from './_mutationFeedback'

const logger = loggerService.withContext('translate/useUpdateHistory')

/**
 * Renderer-side input for {@link useUpdateHistory}.
 *
 * Mirrors {@link UpdateTranslateHistoryDto} but widens the language fields to
 * accept the UI `UNKNOWN` sentinel (`'unknown'`); the hook coerces it to
 * `null` before hitting the DTO, which rejects the sentinel at the persistence
 * boundary.
 */
export type UpdateTranslateHistoryInput = {
  sourceText?: string
  targetText?: string
  sourceLanguage?: TranslateLangCode | null
  targetLanguage?: TranslateLangCode | null
  star?: boolean
}

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

  return useMutationFeedback(
    (data: UpdateTranslateHistoryInput) => {
      const body: UpdateTranslateHistoryDto = {}
      if (data.sourceText !== undefined) body.sourceText = data.sourceText
      if (data.targetText !== undefined) body.targetText = data.targetText
      if ('sourceLanguage' in data) {
        body.sourceLanguage = data.sourceLanguage === UNKNOWN.langCode ? null : data.sourceLanguage
      }
      if ('targetLanguage' in data) {
        body.targetLanguage = data.targetLanguage === UNKNOWN.langCode ? null : data.targetLanguage
      }
      if (data.star !== undefined) body.star = data.star
      return trigger({ body })
    },
    options,
    {
      logger,
      errorLogMessage: 'Failed to update translate history',
      successToastKey: 'translate.history.success.update',
      errorToastKey: 'translate.history.error.save',
      defaults: { showSuccessToast: false, showErrorToast: true, rethrowError: true }
    }
  )
}
