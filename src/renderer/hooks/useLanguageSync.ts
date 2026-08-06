import { usePreference } from '@data/hooks/usePreference'
import i18n from '@renderer/i18n/resolver'
import type { LanguageVarious } from '@shared/data/preference/preferenceTypes'
import { resolveAppLanguage } from '@shared/utils/languages'
import { useEffect } from 'react'

/**
 * Keep i18next's active language in sync with the `app.language` preference.
 *
 * The initial language is already applied by `prepareWindow`'s `initI18n()`; this
 * hook only reacts to runtime preference changes. It is the shared language owner
 * for every UI window (main / subWindow / quickAssistant / selection-action /
 * selection-toolbar). It deliberately does NOT touch the dayjs locale — date
 * localization is a separate concern, synced in `useWindowRuntime` only for the
 * windows that render localized dates (main / subWindow).
 */
export function useLanguageSync(): LanguageVarious {
  const [language] = usePreference('app.language')
  const resolvedLanguage = resolveAppLanguage(language || navigator.language)

  useEffect(() => {
    void i18n.changeLanguage(resolvedLanguage)
  }, [resolvedLanguage])

  return resolvedLanguage
}
