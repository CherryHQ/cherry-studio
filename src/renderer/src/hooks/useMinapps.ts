import { allMinApps } from '@renderer/config/minapps'
import type { RootState } from '@renderer/store'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import { setDisabledMinApps, setMinApps, setPinnedMinApps } from '@renderer/store/minapps'
import type { LanguageVarious, MinAppType } from '@renderer/types'
import { useCallback, useEffect, useMemo, useState } from 'react'

/**
 * Data Flow Design:
 *
 * PRINCIPLE: Locale/Region filtering is a VIEW concern, not a DATA concern.
 *
 * - Redux stores ALL apps (including locale/region-restricted ones) to preserve user preferences
 * - allMinApps is the template data source containing locale/region definitions
 * - This hook applies locale/region filtering only when READING for UI display
 * - When WRITING, hidden apps are merged back to prevent data loss
 */

export type DetectedRegion = 'CN' | 'Global'

// Check if app should be visible for the given locale
const isVisibleForLocale = (app: MinAppType, language: LanguageVarious): boolean => {
  if (!app.locales) return true
  return app.locales.includes(language)
}

/**
 * Check if app should be visible for the given region.
 *
 * Region-based visibility rules:
 * 1. CN users see everything
 * 2. Global users: only show apps with supportedRegions including 'Global'
 *    (apps without supportedRegions field are treated as CN-only)
 */
const isVisibleForRegion = (app: MinAppType, region: DetectedRegion): boolean => {
  // CN users see everything
  if (region === 'CN') return true

  // Global users: check if app supports international
  // If no supportedRegions field, treat as CN-only (hidden from Global users)
  if (!app.supportedRegions || app.supportedRegions.length === 0) {
    return false
  }
  return app.supportedRegions.includes('Global')
}

// Filter apps by locale - only show apps that match current language
const filterByLocale = (apps: MinAppType[], language: LanguageVarious): MinAppType[] => {
  return apps.filter((app) => isVisibleForLocale(app, language))
}

// Filter apps by region
const filterByRegion = (apps: MinAppType[], region: DetectedRegion): MinAppType[] => {
  return apps.filter((app) => isVisibleForRegion(app, region))
}

// Get locale-hidden apps from allMinApps for the current language
// This uses allMinApps as source of truth for locale definitions
const getLocaleHiddenApps = (language: LanguageVarious): MinAppType[] => {
  return allMinApps.filter((app) => !isVisibleForLocale(app, language))
}

// Get region-hidden apps from allMinApps for the current region
const getRegionHiddenApps = (region: DetectedRegion): MinAppType[] => {
  return allMinApps.filter((app) => !isVisibleForRegion(app, region))
}

// Detect user region via IPC call to main process
const detectUserRegion = async (): Promise<DetectedRegion> => {
  try {
    const country = await window.api.getIpCountry()
    return country.toUpperCase() === 'CN' ? 'CN' : 'Global'
  } catch {
    // If detection fails, show all apps (conservative approach)
    return 'Global'
  }
}

export const useMinapps = () => {
  const { enabled, disabled, pinned } = useAppSelector((state: RootState) => state.minapps)
  const language = useAppSelector((state: RootState) => state.settings.language)
  const minAppRegionSetting = useAppSelector((state: RootState) => state.settings.minAppRegion)
  const dispatch = useAppDispatch()

  // Detect and cache the effective region
  const [effectiveRegion, setEffectiveRegion] = useState<DetectedRegion>('Global')

  useEffect(() => {
    const initRegion = async () => {
      if (minAppRegionSetting === 'auto') {
        const detected = await detectUserRegion()
        setEffectiveRegion(detected)
      } else {
        setEffectiveRegion(minAppRegionSetting)
      }
    }
    initRegion()
  }, [minAppRegionSetting])

  const mapApps = useCallback(
    (apps: MinAppType[]) => apps.map((app) => allMinApps.find((item) => item.id === app.id) || app),
    []
  )

  const getAllApps = useCallback(
    (apps: MinAppType[], disabledApps: MinAppType[]) => {
      const mappedApps = mapApps(apps)
      const existingIds = new Set(mappedApps.map((app) => app.id))
      const disabledIds = new Set(disabledApps.map((app) => app.id))
      const missingApps = allMinApps.filter((app) => !existingIds.has(app.id) && !disabledIds.has(app.id))
      return [...mappedApps, ...missingApps]
    },
    [mapApps]
  )

  // READ: Get apps filtered by locale and region for UI display
  const minapps = useMemo(() => {
    const allApps = getAllApps(enabled, disabled)
    const disabledIds = new Set(disabled.map((app) => app.id))
    const withoutDisabled = allApps.filter((app) => !disabledIds.has(app.id))
    // Apply region filter first, then locale filter
    const byRegion = filterByRegion(withoutDisabled, effectiveRegion)
    return filterByLocale(byRegion, language)
  }, [enabled, disabled, language, effectiveRegion, getAllApps])

  const disabledApps = useMemo(
    () => filterByLocale(filterByRegion(mapApps(disabled), effectiveRegion), language),
    [disabled, language, effectiveRegion, mapApps]
  )
  // Pinned apps are always visible regardless of region/language
  // User explicitly pinned apps should not be hidden
  const pinnedApps = useMemo(() => mapApps(pinned), [pinned, mapApps])

  // Get hidden apps for preserving user preferences when writing
  const getHiddenApps = useCallback((language: LanguageVarious, region: DetectedRegion) => {
    const localeHidden = getLocaleHiddenApps(language)
    const regionHidden = getRegionHiddenApps(region)
    const hiddenIds = new Set([...localeHidden, ...regionHidden].map((app) => app.id))
    return hiddenIds
  }, [])

  const updateMinapps = useCallback(
    (visibleApps: MinAppType[]) => {
      const disabledIds = new Set(disabled.map((app) => app.id))
      const withoutDisabled = visibleApps.filter((app) => !disabledIds.has(app.id))

      const hiddenIds = getHiddenApps(language, effectiveRegion)
      const preservedHidden = enabled.filter((app) => hiddenIds.has(app.id) && !disabledIds.has(app.id))

      const visibleIds = new Set(withoutDisabled.map((app) => app.id))
      const toAppend = preservedHidden.filter((app) => !visibleIds.has(app.id))
      const merged = [...withoutDisabled, ...toAppend]

      const existingIds = new Set(merged.map((app) => app.id))
      const missingApps = allMinApps.filter((app) => !existingIds.has(app.id) && !disabledIds.has(app.id))

      dispatch(setMinApps([...merged, ...missingApps]))
    },
    [dispatch, enabled, disabled, language, effectiveRegion, getHiddenApps]
  )

  // WRITE: Update disabled apps, preserving hidden disabled apps
  const updateDisabledMinapps = useCallback(
    (visibleDisabledApps: MinAppType[]) => {
      const hiddenIds = getHiddenApps(language, effectiveRegion)
      const preservedHidden = disabled.filter((app) => hiddenIds.has(app.id))

      const visibleIds = new Set(visibleDisabledApps.map((app) => app.id))
      const toAppend = preservedHidden.filter((app) => !visibleIds.has(app.id))

      dispatch(setDisabledMinApps([...visibleDisabledApps, ...toAppend]))
    },
    [dispatch, disabled, language, effectiveRegion, getHiddenApps]
  )

  // WRITE: Update pinned apps, preserving hidden pinned apps
  const updatePinnedMinapps = useCallback(
    (visiblePinnedApps: MinAppType[]) => {
      const hiddenIds = getHiddenApps(language, effectiveRegion)
      const preservedHidden = pinned.filter((app) => hiddenIds.has(app.id))

      const visibleIds = new Set(visiblePinnedApps.map((app) => app.id))
      const toAppend = preservedHidden.filter((app) => !visibleIds.has(app.id))

      dispatch(setPinnedMinApps([...visiblePinnedApps, ...toAppend]))
    },
    [dispatch, pinned, language, effectiveRegion, getHiddenApps]
  )

  return {
    minapps,
    disabled: disabledApps,
    pinned: pinnedApps,
    updateMinapps,
    updateDisabledMinapps,
    updatePinnedMinapps
  }
}
