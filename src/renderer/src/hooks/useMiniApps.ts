import { dataApiService } from '@data/DataApiService'
import { useCache } from '@data/hooks/useCache'
import { useInvalidateCache, useMutation, useQuery } from '@data/hooks/useDataApi'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import type { CreateMiniAppDto, ReorderMiniAppsDto, UpdateMiniAppDto } from '@shared/data/api/schemas/miniapps'
import { ORIGIN_DEFAULT_MIN_APPS } from '@shared/data/presets/miniapps'
import type { MiniApp } from '@shared/data/types/miniapp'
import type { MiniAppRegion } from '@shared/data/types/miniapp'
import { useCallback, useEffect, useMemo } from 'react'

/**
 * Data Flow Design:
 *
 * PRINCIPLE: Region filtering is a VIEW concern, not a DATA concern.
 *
 * - DataApi stores ALL apps (including region-restricted ones) to preserve user preferences
 * - ORIGIN_DEFAULT_MIN_APPS is the preset data source containing region definitions
 * - This hook applies region filtering only when READING for UI display
 * - Mutations target individual apps by appId, never touching region-hidden apps
 */

/**
 * Check if app should be visible for the given region.
 *
 * Region-based visibility rules:
 * 1. CN users see everything
 * 2. Global users: only show apps with supportedRegions including 'Global'
 *    (apps without supportedRegions field are treated as CN-only)
 */
const isVisibleForRegion = (app: MiniApp, region: MiniAppRegion): boolean => {
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
const filterByRegion = (apps: MiniApp[], region: MiniAppRegion): MiniApp[] => {
  return apps.filter((app) => isVisibleForRegion(app, region))
}

// Build preset index map once for O(1) lookups (js-index-maps)
const presetById = new Map(ORIGIN_DEFAULT_MIN_APPS.map((p) => [p.id, p]))

// Merge DB data with preset display fields (logo, background, bordered, nameKey)
const mergeWithPreset = (app: MiniApp): MiniApp => {
  const preset = presetById.get(app.appId)
  if (!preset) return app
  return {
    ...app,
    nameKey: app.nameKey ?? preset.nameKey,
    logo: app.logo ?? preset.logo,
    bordered: app.bordered ?? preset.bordered,
    background: app.background ?? preset.background,
    supportedRegions: app.supportedRegions ?? preset.supportedRegions,
    style: app.style ?? preset.style
  }
}

// Module-level promise to ensure only one IP detection request is made
let regionDetectionPromise: Promise<MiniAppRegion> | null = null

// Detect user region via IPC call to main process (cached at module level)
const detectUserRegion = async (): Promise<MiniAppRegion> => {
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

/**
 * V2 useMiniApps hook — DataApi + Preference + Cache
 */
// Module-level logger to avoid recreating on every render (rerender-defer-reads)
const logger = loggerService.withContext('useMiniApps')

export const useMiniApps = () => {
  // === Data (DataApi) ===
  const { data, isLoading, mutate: refetch } = useQuery('/miniapps')
  const rawApps: MiniApp[] = useMemo(() => data?.items ?? [], [data])

  // Merge with preset and partition by status in single pass (js-combine-iterations)
  const { allApps, enabled, disabled, pinned } = useMemo(() => {
    const all: MiniApp[] = []
    const ena: MiniApp[] = []
    const dis: MiniApp[] = []
    const pin: MiniApp[] = []
    for (const raw of rawApps) {
      const app = mergeWithPreset(raw)
      all.push(app)
      if (app.status === 'enabled') ena.push(app)
      else if (app.status === 'disabled') dis.push(app)
      else if (app.status === 'pinned') pin.push(app)
    }
    return { allApps: all, enabled: ena, disabled: dis, pinned: pin }
  }, [rawApps])

  // === Region (Preference + Cache) ===
  const [miniAppRegionSetting] = usePreference('feature.miniapp.region')
  const [detectedRegion, setDetectedRegion] = useCache('miniapp.detected_region')

  const effectiveRegion: MiniAppRegion =
    miniAppRegionSetting === 'auto'
      ? (detectedRegion ?? 'CN')
      : miniAppRegionSetting === 'CN' || miniAppRegionSetting === 'Global'
        ? miniAppRegionSetting
        : 'CN'

  // Auto-detect region once per session
  useEffect(() => {
    if (miniAppRegionSetting !== 'auto' || detectedRegion) return
    let cancelled = false
    detectUserRegion()
      .then((region) => {
        if (!cancelled) setDetectedRegion(region)
      })
      .catch(() => {
        if (!cancelled) setDetectedRegion('CN')
      })
    return () => {
      cancelled = true
    }
  }, [miniAppRegionSetting, detectedRegion, setDetectedRegion])

  // === Region-filtered views ===
  // Include pinned apps so they remain visible in the grid when pinned to launchpad/sidebar
  // Sort by sortOrder to maintain consistent positions regardless of status
  const miniapps = useMemo(() => {
    const visibleApps = [...enabled, ...pinned]
    const regionFiltered = filterByRegion(visibleApps, effectiveRegion)
    return regionFiltered.sort((a, b) => a.sortOrder - b.sortOrder)
  }, [enabled, effectiveRegion, pinned])
  const disabledApps = useMemo(() => filterByRegion(disabled, effectiveRegion), [disabled, effectiveRegion])
  // Pinned apps are always visible regardless of region
  const pinnedApps = pinned

  // === UI State Cache (unchanged) ===
  const [openedKeepAliveMiniApps, setOpenedKeepAliveMiniApps] = useCache('miniapp.opened_keep_alive')
  const [currentMiniAppId, setCurrentMiniAppId] = useCache('miniapp.current_id')
  const [miniAppShow, setMiniAppShow] = useCache('miniapp.show')
  const [openedOneOffMiniApp, setOpenedOneOffMiniApp] = useCache('miniapp.opened_oneoff')

  // === Mutations (DataApi) ===
  const invalidate = useInvalidateCache()

  // Dynamic-path PATCH/DELETE via dataApiService (useMutation requires ConcreteApiPaths, not templates)
  const patchApp = useCallback(
    async (appId: string, body: UpdateMiniAppDto) => {
      const result = await dataApiService.patch(`/miniapps/${appId}`, { body })
      await invalidate('/miniapps')
      return result
    },
    [invalidate]
  )

  const deleteApp = useCallback(
    async (appId: string) => {
      const result = await dataApiService.delete(`/miniapps/${appId}`)
      await invalidate('/miniapps')
      return result
    },
    [invalidate]
  )

  // Fixed-path mutations (useMutation with auto-refresh)
  const { trigger: postMiniApp } = useMutation('POST', '/miniapps', {
    refresh: ['/miniapps']
  })
  const { trigger: reorderMiniAppsApi } = useMutation('PATCH', '/miniapps', {
    refresh: ['/miniapps']
  })

  // === Write: Update enabled apps (backward-compat) ===
  const updateMiniApps = useCallback(
    (visibleApps: MiniApp[]) => {
      const currentVisibleIds = new Set(
        enabled.filter((a) => isVisibleForRegion(a, effectiveRegion)).map((a) => a.appId)
      )
      const newVisibleIds = new Set(visibleApps.map((a) => a.appId))

      const toEnable = visibleApps.filter((a) => a.status !== 'enabled' && !currentVisibleIds.has(a.appId))
      const toDisable = enabled.filter((a) => currentVisibleIds.has(a.appId) && !newVisibleIds.has(a.appId))

      return Promise.all([
        ...toEnable.map((a) => patchApp(a.appId, { status: 'enabled' })),
        ...toDisable.map((a) => patchApp(a.appId, { status: 'disabled' }))
      ]).catch((err) => {
        logger.warn('Failed to update miniapps', err as Error)
        return []
      })
    },
    [enabled, effectiveRegion, patchApp]
  )

  // Write: Update disabled apps (backward-compat) ===
  const updateDisabledMiniApps = useCallback(
    (visibleApps: MiniApp[]) => {
      const currentVisibleIds = new Set(
        disabled.filter((a) => isVisibleForRegion(a, effectiveRegion)).map((a) => a.appId)
      )
      const newVisibleIds = new Set(visibleApps.map((a) => a.appId))

      const toDisable = visibleApps.filter((a) => a.status !== 'disabled' && !currentVisibleIds.has(a.appId))
      const toEnable = disabled.filter((a) => currentVisibleIds.has(a.appId) && !newVisibleIds.has(a.appId))

      return Promise.all([
        ...toDisable.map((a) => patchApp(a.appId, { status: 'disabled' })),
        ...toEnable.map((a) => patchApp(a.appId, { status: 'enabled' }))
      ]).catch((err) => {
        logger.warn('Failed to update disabled miniapps', err as Error)
        return []
      })
    },
    [disabled, effectiveRegion, patchApp]
  )

  // Write: Update pinned apps (backward-compat) ===
  const updatePinnedMiniApps = useCallback(
    (apps: MiniApp[]) => {
      const newPinnedIds = new Set(apps.map((a) => a.appId))
      const currentPinnedIds = new Set(pinned.map((a) => a.appId))

      const toPin = apps.filter((a) => !currentPinnedIds.has(a.appId))
      const toUnpin = pinned.filter((a) => !newPinnedIds.has(a.appId))

      return Promise.all([
        ...toPin.map((a) => patchApp(a.appId, { status: 'pinned' })),
        ...toUnpin.map((a) => patchApp(a.appId, { status: 'enabled' }))
      ]).catch((err) => {
        logger.warn('Failed to update pinned miniapps', err as Error)
        return []
      })
    },
    [pinned, patchApp]
  )

  // === V2-style mutations ===
  const updateAppStatus = useCallback(
    (appId: string, status: MiniApp['status']) => {
      return patchApp(appId, { status })
    },
    [patchApp]
  )

  const createCustomMiniApp = useCallback(
    (dto: CreateMiniAppDto) => {
      return postMiniApp({ body: dto })
    },
    [postMiniApp]
  )

  const removeCustomMiniApp = useCallback(
    (appId: string) => {
      return deleteApp(appId)
    },
    [deleteApp]
  )

  const reorderMiniApps = useCallback(
    (items: ReorderMiniAppsDto['items']) => {
      return reorderMiniAppsApi({ body: { items } })
    },
    [reorderMiniAppsApi]
  )

  return {
    allApps,
    miniapps,
    disabled: disabledApps,
    pinned: pinnedApps,
    openedKeepAliveMiniApps,
    currentMiniAppId,
    miniAppShow,
    openedOneOffMiniApp,
    setOpenedKeepAliveMiniApps,
    setCurrentMiniAppId,
    setMiniAppShow,
    setOpenedOneOffMiniApp,
    isLoading,
    refetch,
    updateMiniApps,
    updateDisabledMiniApps,
    updatePinnedMiniApps,
    updateAppStatus,
    createCustomMiniApp,
    removeCustomMiniApp,
    reorderMiniApps
  }
}

export type UseMiniAppsReturn = ReturnType<typeof useMiniApps>
