import { useQuery } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import { UNKNOWN } from '@renderer/config/translate'
import type { TranslateLanguageVo } from '@renderer/types'
import { languageDtoToVo } from '@renderer/utils/translate'
import type { TranslateLangCode } from '@shared/data/preference/preferenceTypes'
import { isTranslateLangCode } from '@shared/data/preference/preferenceTypes'
import { langCodeToI18nKey } from '@shared/data/presets/translate-languages'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('translate/useLanguages')

/**
 * Fetches translate languages from the data API and converts DTOs to view objects.
 *
 * Surfaces load failures both to Sentry (via `logger.error`) and to the user (via
 * a one-shot toast debounced with a ref so SWR retries don't spam). Callers get
 * `error` back so consumers can differentiate "still loading" from "failed to
 * load" — the hook returning `languages: undefined` alone is ambiguous.
 *
 * @returns `{ languages, getLabel, getLanguage, error }` — `languages` is
 * `undefined` while loading or on failure; pair it with `error` to tell the two
 * apart.
 */
export const useLanguages = () => {
  const { data, error } = useQuery('/translate/languages')
  const { t } = useTranslation()

  // One-shot UX surface: we only want to tell the user "translate module
  // failed to initialize" once per session, not on every SWR retry tick.
  const toastedRef = useRef(false)
  useEffect(() => {
    if (error && !toastedRef.current) {
      toastedRef.current = true
      logger.error('Failed to load translate languages', error)
      window.toast.error(t('translate.error.languages_load_failed'))
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
        // String but not a valid lang code — log so malformed upstream data is
        // discoverable in Sentry. `null` is a legitimate UI sentinel and stays silent.
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

  return { languages, getLabel, getLanguage, error }
}
