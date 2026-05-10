import { useMutation } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import type { CreateTranslateHistoryDto, UpdateTranslateHistoryDto } from '@shared/data/api/schemas/translate'
import {
  parsePersistedLangCode,
  type PersistedLangCode,
  type TranslateLangCode
} from '@shared/data/preference/preferenceTypes'
import { useCallback } from 'react'

import { type MutationFeedbackOptions, useMutationFeedback } from './_mutationFeedback'

const logger = loggerService.withContext('translate/useTranslateHistory')

const toPersistedLangCodeOrNull = (langCode: TranslateLangCode | null | undefined): PersistedLangCode | null => {
  if (langCode === null || langCode === undefined || langCode === 'unknown') return null
  return parsePersistedLangCode(langCode)
}

export type AddTranslateHistoryInput = {
  sourceText: string
  targetText: string
  sourceLanguage: TranslateLangCode | null
  targetLanguage: TranslateLangCode | null
}

export type UpdateTranslateHistoryInput = {
  sourceText?: string
  targetText?: string
  sourceLanguage?: TranslateLangCode | null
  targetLanguage?: TranslateLangCode | null
  star?: boolean
}

export const useTranslateHistory = (options?: {
  add?: MutationFeedbackOptions
  update?: MutationFeedbackOptions
  remove?: MutationFeedbackOptions
  clear?: MutationFeedbackOptions
}) => {
  const { trigger: addTrigger } = useMutation('POST', '/translate/histories', {
    refresh: ['/translate/histories']
  })
  const { trigger: updateTrigger } = useMutation('PATCH', '/translate/histories/:id', {
    refresh: ['/translate/histories']
  })
  const { trigger: removeTrigger } = useMutation('DELETE', '/translate/histories/:id', {
    refresh: ['/translate/histories']
  })
  const { trigger: clearTrigger } = useMutation('DELETE', '/translate/histories', {
    refresh: ['/translate/histories']
  })

  const addMutation = useMutationFeedback(
    useCallback(
      (data: AddTranslateHistoryInput) => {
        const body: CreateTranslateHistoryDto = {
          sourceText: data.sourceText,
          targetText: data.targetText,
          sourceLanguage: toPersistedLangCodeOrNull(data.sourceLanguage),
          targetLanguage: toPersistedLangCodeOrNull(data.targetLanguage)
        }
        return addTrigger({ body })
      },
      [addTrigger]
    ),
    options?.add,
    {
      logger,
      errorLogMessage: 'Failed to add translate history',
      successToastKey: 'translate.history.success.add',
      errorToastKey: 'translate.history.error.add',
      defaults: { showSuccessToast: false, showErrorToast: true, rethrowError: true }
    }
  )

  const updateMutation = useMutationFeedback(
    useCallback(
      (id: string, data: UpdateTranslateHistoryInput) => {
        const body: UpdateTranslateHistoryDto = {}
        if (data.sourceText !== undefined) body.sourceText = data.sourceText
        if (data.targetText !== undefined) body.targetText = data.targetText
        if ('sourceLanguage' in data) {
          body.sourceLanguage = toPersistedLangCodeOrNull(data.sourceLanguage)
        }
        if ('targetLanguage' in data) {
          body.targetLanguage = toPersistedLangCodeOrNull(data.targetLanguage)
        }
        if (data.star !== undefined) body.star = data.star
        return updateTrigger({ params: { id }, body })
      },
      [updateTrigger]
    ),
    options?.update,
    {
      logger,
      errorLogMessage: 'Failed to update translate history',
      successToastKey: 'translate.history.success.update',
      errorToastKey: 'translate.history.error.save',
      defaults: { showSuccessToast: false, showErrorToast: true, rethrowError: true }
    }
  )

  const removeMutation = useMutationFeedback(
    useCallback((id: string) => removeTrigger({ params: { id } }), [removeTrigger]),
    options?.remove,
    {
      logger,
      errorLogMessage: 'Failed to delete translate history',
      successToastKey: 'translate.history.success.delete',
      errorToastKey: 'translate.history.error.delete',
      defaults: { showSuccessToast: false, showErrorToast: true, rethrowError: true }
    }
  )

  const clearMutation = useMutationFeedback(
    useCallback(() => clearTrigger(), [clearTrigger]),
    options?.clear,
    {
      logger,
      errorLogMessage: 'Failed to clear translate history',
      successToastKey: 'translate.history.success.clear',
      errorToastKey: 'translate.history.error.clear',
      defaults: { showSuccessToast: false, showErrorToast: true, rethrowError: true }
    }
  )

  return {
    add: addMutation,
    update: updateMutation,
    remove: removeMutation,
    clear: clearMutation
  }
}
