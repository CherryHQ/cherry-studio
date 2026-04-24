import { useMutation } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import { UNKNOWN } from '@renderer/config/translate'
import type { CreateTranslateHistoryDto } from '@shared/data/api/schemas/translate'
import type { TranslateLangCode } from '@shared/data/preference/preferenceTypes'

import { type MutationFeedbackOptions, useMutationFeedback } from './_mutationFeedback'

const logger = loggerService.withContext('translate/useAddHistory')

/**
 * Renderer-side input for {@link useAddHistory}.
 *
 * Accepts the UI `UNKNOWN` sentinel (`'unknown'`) in either language field;
 * the hook coerces it to `null` before hitting the DTO, which rejects the
 * sentinel at the persistence boundary. Callers should not coerce themselves.
 */
export type AddTranslateHistoryInput = {
  sourceText: string
  targetText: string
  sourceLanguage: TranslateLangCode | null
  targetLanguage: TranslateLangCode | null
}

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

  return useMutationFeedback(
    (data: AddTranslateHistoryInput) => {
      const body: CreateTranslateHistoryDto = {
        sourceText: data.sourceText,
        targetText: data.targetText,
        sourceLanguage: data.sourceLanguage === UNKNOWN.langCode ? null : data.sourceLanguage,
        targetLanguage: data.targetLanguage === UNKNOWN.langCode ? null : data.targetLanguage
      }
      return trigger({ body })
    },
    options,
    {
      logger,
      errorLogMessage: 'Failed to add translate history',
      successToastKey: 'translate.history.success.add',
      errorToastKey: 'translate.history.error.add',
      defaults: { showSuccessToast: false, showErrorToast: true, rethrowError: true }
    }
  )
}
