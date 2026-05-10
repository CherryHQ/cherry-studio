import { useMutation, useQuery } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import { UNKNOWN } from '@renderer/config/translate'
import type { TranslateLanguageVo } from '@renderer/types'
import { languageDtoToVo } from '@renderer/utils/translate'
import type { CreateTranslateLanguageDto, UpdateTranslateLanguageDto } from '@shared/data/api/schemas/translate'
import type { TranslateLangCode } from '@shared/data/preference/preferenceTypes'
import { isTranslateLangCode } from '@shared/data/preference/preferenceTypes'
import { langCodeToI18nKey } from '@shared/data/presets/translate-languages'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { type MutationFeedbackOptions, useMutationFeedback } from './_mutationFeedback'

const logger = loggerService.withContext('translate/useTranslateLanguages')

export const useTranslateLanguages = (options?: {
  add?: MutationFeedbackOptions
  update?: MutationFeedbackOptions
  remove?: MutationFeedbackOptions
}) => {
  const { data, error } = useQuery('/translate/languages')
  const { t } = useTranslation()

  const toastedRef = useRef(false)
  useEffect(() => {
    if (error && !toastedRef.current) {
      toastedRef.current = true
      logger.error('Failed to load translate languages', error)
      window.toast?.error(t('translate.error.languages_load_failed'))
    }
  }, [error, t])

  const languages = useMemo(() => {
    if (data !== undefined) {
      return data.map(languageDtoToVo)
    } else {
      return undefined
    }
  }, [data])

  const getLabel = useCallback(
    (lang: TranslateLangCode | TranslateLanguageVo | null, withEmoji: boolean = true) => {
      if (languages === undefined) {
        return undefined
      }
      if (isTranslateLangCode(lang)) {
        lang = languages.find((l) => l.langCode === lang) ?? UNKNOWN
      } else if (typeof lang === 'string' || lang === null) {
        if (lang !== null) {
          logger.warn('getLabel received an invalid lang code, falling back to UNKNOWN', { lang })
        }
        lang = UNKNOWN
      }
      const i18nKey = langCodeToI18nKey.get(lang.langCode)
      const text = i18nKey ? t(i18nKey) : lang.value
      const label = withEmoji ? `${lang.emoji} ${text}` : text
      return label
    },
    [languages, t]
  )

  const getLanguage = useCallback(
    (langCode: TranslateLangCode) => {
      if (languages === undefined) {
        return undefined
      }
      return languages.find((l) => l.langCode === langCode) ?? UNKNOWN
    },
    [languages]
  )

  const { trigger: addTrigger } = useMutation('POST', '/translate/languages', {
    refresh: ['/translate/languages']
  })
  const { trigger: updateTrigger } = useMutation('PATCH', '/translate/languages/:langCode', {
    refresh: ['/translate/languages']
  })
  const { trigger: removeTrigger } = useMutation('DELETE', '/translate/languages/:langCode', {
    refresh: ['/translate/languages']
  })

  const add = useMutationFeedback(
    useCallback((data: CreateTranslateLanguageDto) => addTrigger({ body: data }), [addTrigger]),
    options?.add,
    {
      logger,
      errorLogMessage: 'Failed to add translate language',
      successToastKey: 'settings.translate.custom.success.add',
      errorToastKey: 'settings.translate.custom.error.add',
      defaults: { showSuccessToast: true, showErrorToast: true, rethrowError: true }
    }
  )

  const update = useMutationFeedback(
    useCallback(
      (langCode: string | undefined, data: UpdateTranslateLanguageDto) => {
        if (!langCode) {
          throw new Error('useTranslateLanguages.update: langCode must be set when triggering update')
        }
        return updateTrigger({ params: { langCode }, body: data })
      },
      [updateTrigger]
    ),
    options?.update,
    {
      logger,
      errorLogMessage: 'Failed to update translate language',
      successToastKey: 'settings.translate.custom.success.update',
      errorToastKey: 'settings.translate.custom.error.update',
      defaults: { showSuccessToast: true, showErrorToast: true, rethrowError: true }
    }
  )

  const remove = useMutationFeedback(
    useCallback(
      (langCode: string) => {
        if (!langCode) {
          throw new Error('useTranslateLanguages.remove: langCode must be non-empty when triggering delete')
        }
        return removeTrigger({ params: { langCode } })
      },
      [removeTrigger]
    ),
    options?.remove,
    {
      logger,
      errorLogMessage: 'Failed to delete translate language',
      successToastKey: 'settings.translate.custom.success.delete',
      errorToastKey: 'settings.translate.custom.error.delete',
      defaults: { showSuccessToast: true, showErrorToast: true, rethrowError: true }
    }
  )

  const status: 'loading' | 'error' | 'ready' =
    languages !== undefined ? 'ready' : error !== undefined ? 'error' : 'loading'

  return { languages, getLabel, getLanguage, add, update, remove, error, status }
}

export const useLanguages = useTranslateLanguages
