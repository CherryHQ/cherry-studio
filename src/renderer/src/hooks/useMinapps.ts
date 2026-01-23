import { DEFAULT_MIN_APPS } from '@renderer/config/minapps'
import { getLanguage } from '@renderer/i18n'
import type { RootState } from '@renderer/store'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import { setDisabledMinApps, setMinApps, setPinnedMinApps } from '@renderer/store/minapps'
import type { MinAppType } from '@renderer/types'
import { useCallback, useMemo } from 'react'

/**
 * Data Flow Design:
 *
 * PRINCIPLE: Locale filtering is a VIEW concern, not a DATA concern.
 *
 * - Redux stores ALL apps (including locale-restricted ones) to preserve user preferences
 * - DEFAULT_MIN_APPS is the template data source containing locale definitions
 * - This hook applies locale filtering only when READING for UI display
 * - When WRITING, locale-hidden apps are merged back to prevent data loss
 */

// Check if app should be visible for the given locale
const isVisibleForLocale = (app: MinAppType, language: string): boolean => {
  if (!app.locales) return true // No locale restriction, show to all
  return app.locales.includes(language)
}

// Filter apps by locale - only show apps that match current language
const filterByLocale = (apps: MinAppType[], language: string): MinAppType[] => {
  return apps.filter((app) => isVisibleForLocale(app, language))
}

// Get locale-hidden apps from DEFAULT_MIN_APPS for the current language
// This uses DEFAULT_MIN_APPS as source of truth for locale definitions
const getLocaleHiddenApps = (language: string): MinAppType[] => {
  return DEFAULT_MIN_APPS.filter((app) => !isVisibleForLocale(app, language))
}

export const useMinapps = () => {
  const { enabled, disabled, pinned } = useAppSelector((state: RootState) => state.minapps)

  const reduxLanguage = useAppSelector((state: RootState) => state.settings.language)
  const dispatch = useAppDispatch()

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const language = useMemo(() => getLanguage(), [reduxLanguage])

  // Map stored app references to full app data from DEFAULT_MIN_APPS
  const mapApps = useCallback(
    (apps: MinAppType[]) => apps.map((app) => DEFAULT_MIN_APPS.find((item) => item.id === app.id) || app),
    []
  )

  const getAllApps = useCallback(
    (apps: MinAppType[], disabledApps: MinAppType[]) => {
      const mappedApps = mapApps(apps)
      const existingIds = new Set(mappedApps.map((app) => app.id))
      const disabledIds = new Set(disabledApps.map((app) => app.id))
      const missingApps = DEFAULT_MIN_APPS.filter((app) => !existingIds.has(app.id) && !disabledIds.has(app.id))
      return [...mappedApps, ...missingApps]
    },
    [mapApps]
  )

  // READ: Get apps filtered by locale for UI display
  const minapps = useMemo(() => {
    const allApps = getAllApps(enabled, disabled)
    const disabledIds = new Set(disabled.map((app) => app.id))
    const withoutDisabled = allApps.filter((app) => !disabledIds.has(app.id))
    // Apply locale filter only for display
    return filterByLocale(withoutDisabled, language)
  }, [enabled, disabled, language, getAllApps])

  const disabledApps = useMemo(() => filterByLocale(mapApps(disabled), language), [disabled, language, mapApps])
  const pinnedApps = useMemo(() => filterByLocale(mapApps(pinned), language), [pinned, language, mapApps])

  const updateMinapps = useCallback(
    (visibleApps: MinAppType[]) => {
      const disabledIds = new Set(disabled.map((app) => app.id))

      const withoutDisabled = visibleApps.filter((app) => !disabledIds.has(app.id))

      const localeHiddenApps = getLocaleHiddenApps(language)

      const localeHiddenIds = new Set(localeHiddenApps.map((app) => app.id))
      const preservedLocaleHidden = enabled.filter((app) => localeHiddenIds.has(app.id) && !disabledIds.has(app.id))

      const visibleIds = new Set(withoutDisabled.map((app) => app.id))
      const toAppend = preservedLocaleHidden.filter((app) => !visibleIds.has(app.id))
      const merged = [...withoutDisabled, ...toAppend]

      const existingIds = new Set(merged.map((app) => app.id))
      const missingApps = DEFAULT_MIN_APPS.filter((app) => !existingIds.has(app.id) && !disabledIds.has(app.id))

      dispatch(setMinApps([...merged, ...missingApps]))
    },
    [dispatch, enabled, disabled, language]
  )

  // WRITE: Update disabled apps, preserving locale-hidden disabled apps
  const updateDisabledMinapps = useCallback(
    (visibleDisabledApps: MinAppType[]) => {
      const localeHiddenApps = getLocaleHiddenApps(language)
      const localeHiddenIds = new Set(localeHiddenApps.map((app) => app.id))
      const preservedLocaleHidden = disabled.filter((app) => localeHiddenIds.has(app.id))

      const visibleIds = new Set(visibleDisabledApps.map((app) => app.id))
      const toAppend = preservedLocaleHidden.filter((app) => !visibleIds.has(app.id))

      dispatch(setDisabledMinApps([...visibleDisabledApps, ...toAppend]))
    },
    [dispatch, disabled, language]
  )

  // WRITE: Update pinned apps, preserving locale-hidden pinned apps
  const updatePinnedMinapps = useCallback(
    (visiblePinnedApps: MinAppType[]) => {
      const localeHiddenApps = getLocaleHiddenApps(language)
      const localeHiddenIds = new Set(localeHiddenApps.map((app) => app.id))
      const preservedLocaleHidden = pinned.filter((app) => localeHiddenIds.has(app.id))

      const visibleIds = new Set(visiblePinnedApps.map((app) => app.id))
      const toAppend = preservedLocaleHidden.filter((app) => !visibleIds.has(app.id))

      dispatch(setPinnedMinApps([...visiblePinnedApps, ...toAppend]))
    },
    [dispatch, pinned, language]
  )

  return {
    minapps,
    disabled: disabledApps,
    pinned: pinnedApps,
    language,
    updateMinapps,
    updateDisabledMinapps,
    updatePinnedMinapps
  }
}
