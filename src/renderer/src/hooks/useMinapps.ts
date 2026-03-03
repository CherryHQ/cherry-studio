import { allMinApps } from '@renderer/config/minapps'
import type { RootState } from '@renderer/store'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import { setDisabledMinApps, setMinApps, setPinnedMinApps } from '@renderer/store/minapps'
import { setDetectedRegion } from '@renderer/store/runtime'
import type { MinAppRegion, MinAppType } from '@renderer/types'
import { useCallback, useEffect, useMemo, useRef } from 'react'

/**
 * Data Flow Design:
 *
 * PRINCIPLE: Region filtering is a VIEW concern, not a DATA concern.
 *
 * - Redux stores ALL apps (including region-restricted ones) to preserve user preferences
 * - allMinApps is the template data source containing region definitions
 * - This hook applies region filtering only when READING for UI display
 * - When WRITING, hidden apps are merged back to prevent data loss
 */

/**
 * Check if app should be visible for the given region.
 *
 * Region-based visibility rules:
 * 1. CN users see everything
 * 2. Global users: only show apps with supportedRegions including 'Global'
 *    (apps without supportedRegions field are treated as CN-only)
 */
const isVisibleForRegion = (app: MinAppType, region: MinAppRegion): boolean => {
  // CN users see everything
  if (region === 'CN') return true

  // Global users: check if app supports international
  // If no supportedRegions field, treat as CN-only (hidden from Global users)
  if (!app.supportedRegions || app.supportedRegions.length === 0) {
    return false
  }
  return app.supportedRegions.includes('Global')
}

// Filter apps by region
const filterByRegion = (apps: MinAppType[], region: MinAppRegion): MinAppType[] => {
  return apps.filter((app) => isVisibleForRegion(app, region))
}

// Get region-hidden apps from allMinApps for the current region
const getRegionHiddenApps = (region: MinAppRegion): MinAppType[] => {
  return allMinApps.filter((app) => !isVisibleForRegion(app, region))
}

// Module-level promise to ensure only one IP detection request is made
let regionDetectionPromise: Promise<MinAppRegion> | null = null

// Detect user region via IPC call to main process (cached at module level)
const detectUserRegion = async (): Promise<MinAppRegion> => {
  // Return existing promise if detection is already in progress
  if (regionDetectionPromise) {
    return regionDetectionPromise
  }

  regionDetectionPromise = (async () => {
    try {
      const country = await window.api.getIpCountry()
      return country.toUpperCase() === 'CN' ? 'CN' : 'Global'
    } catch {
      // If detection fails, assume CN to show all apps (conservative approach)
      return 'CN'
    }
  })()

  return regionDetectionPromise
}

export const useMinapps = () => {
  const { enabled, disabled, pinned } = useAppSelector((state: RootState) => state.minapps)
  const minAppRegionSetting = useAppSelector((state: RootState) => state.settings.minAppRegion)
  const detectedRegion = useAppSelector((state: RootState) => state.runtime.detectedRegion)
  const dispatch = useAppDispatch()

  // Track if this hook instance has initiated detection to avoid duplicate requests
  const hasInitiatedDetection = useRef(false)

  // Compute effective region: use cached detection result or manual setting
  const effectiveRegion: MinAppRegion = minAppRegionSetting === 'auto' ? (detectedRegion ?? 'CN') : minAppRegionSetting

  // Only detect region once globally when in 'auto' mode and not yet detected
  useEffect(() => {
    const initRegion = async () => {
      // Skip if not in auto mode, already detected, or this instance already initiated
      if (minAppRegionSetting !== 'auto' || detectedRegion !== null || hasInitiatedDetection.current) {
        return
      }

      hasInitiatedDetection.current = true
      const detected = await detectUserRegion()
      dispatch(setDetectedRegion(detected))
    }
    initRegion()
  }, [minAppRegionSetting, detectedRegion, dispatch])

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

  // READ: Get apps filtered by region for UI display
  const minapps = useMemo(() => {
    const allApps = getAllApps(enabled, disabled)
    const disabledIds = new Set(disabled.map((app) => app.id))
    const withoutDisabled = allApps.filter((app) => !disabledIds.has(app.id))
    return filterByRegion(withoutDisabled, effectiveRegion)
  }, [enabled, disabled, effectiveRegion, getAllApps])

  const disabledApps = useMemo(
    () => filterByRegion(mapApps(disabled), effectiveRegion),
    [disabled, effectiveRegion, mapApps]
  )
  // Pinned apps are always visible regardless of region/language
  // User explicitly pinned apps should not be hidden
  const pinnedApps = useMemo(() => mapApps(pinned), [pinned, mapApps])

  // Get hidden apps for preserving user preferences when writing
  const getHiddenApps = useCallback((region: MinAppRegion) => {
    const regionHidden = getRegionHiddenApps(region)
    const hiddenIds = new Set(regionHidden.map((app) => app.id))
    return hiddenIds
  }, [])

  const updateMinapps = useCallback(
    (visibleApps: MinAppType[]) => {
      const disabledIds = new Set(disabled.map((app) => app.id))
      const withoutDisabled = visibleApps.filter((app) => !disabledIds.has(app.id))

      const hiddenIds = getHiddenApps(effectiveRegion)
      const preservedHidden = enabled.filter((app) => hiddenIds.has(app.id) && !disabledIds.has(app.id))

      const visibleIds = new Set(withoutDisabled.map((app) => app.id))
      const toAppend = preservedHidden.filter((app) => !visibleIds.has(app.id))
      const merged = [...withoutDisabled, ...toAppend]

      const existingIds = new Set(merged.map((app) => app.id))
      const missingApps = allMinApps.filter((app) => !existingIds.has(app.id) && !disabledIds.has(app.id))

      dispatch(setMinApps([...merged, ...missingApps]))
    },
    [dispatch, enabled, disabled, effectiveRegion, getHiddenApps]
  )

  // WRITE: Update disabled apps, preserving hidden disabled apps
  const updateDisabledMinapps = useCallback(
    (visibleDisabledApps: MinAppType[]) => {
      const hiddenIds = getHiddenApps(effectiveRegion)
      const preservedHidden = disabled.filter((app) => hiddenIds.has(app.id))

      const visibleIds = new Set(visibleDisabledApps.map((app) => app.id))
      const toAppend = preservedHidden.filter((app) => !visibleIds.has(app.id))

      dispatch(setDisabledMinApps([...visibleDisabledApps, ...toAppend]))
    },
    [dispatch, disabled, effectiveRegion, getHiddenApps]
  )

  // WRITE: Update pinned apps, preserving hidden pinned apps
  const updatePinnedMinapps = useCallback(
    (visiblePinnedApps: MinAppType[]) => {
      const hiddenIds = getHiddenApps(effectiveRegion)
      const preservedHidden = pinned.filter((app) => hiddenIds.has(app.id))

      const visibleIds = new Set(visiblePinnedApps.map((app) => app.id))
      const toAppend = preservedHidden.filter((app) => !visibleIds.has(app.id))

      dispatch(setPinnedMinApps([...visiblePinnedApps, ...toAppend]))
    },
    [dispatch, pinned, effectiveRegion, getHiddenApps]
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
