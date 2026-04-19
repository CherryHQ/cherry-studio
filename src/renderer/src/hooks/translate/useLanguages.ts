import { useQuery } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import { UNKNOWN } from '@renderer/config/translate'
import type { TranslateLanguageVo } from '@renderer/types'
import { languageDtoToVo } from '@renderer/utils/translate'
import type { TranslateLangCode } from '@shared/data/preference/preferenceTypes'
import { isTranslateLangCode } from '@shared/data/preference/preferenceTypes'
import { langCodeToI18nKey } from '@shared/data/presets/translate-languages'
import { useCallback, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('translate/useLanguages')

/**
 * Fetches translate languages from the data API and converts DTOs to view objects.
 *
 * @returns An array of {@link TranslateLanguageVo} view objects, or `undefined` while loading.
 */
export const useLanguages = () => {
  const { data, error } = useQuery('/translate/languages')
  const { t } = useTranslation()

  useEffect(() => {
    if (error) {
      logger.error('Failed to load translate languages', error)
    }
  }, [error])

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
        // string but not valid lang code
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

  return { languages, getLabel, getLanguage, error }
}
