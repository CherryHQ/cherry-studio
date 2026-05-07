import { dataApiService } from '@data/DataApiService'
import { useCache } from '@data/hooks/useCache'
import { useInvalidateCache, useMutation, useQuery } from '@data/hooks/useDataApi'
import { usePreference } from '@data/hooks/usePreference'
import { useReorder } from '@data/hooks/useReorder'
import { loggerService } from '@logger'
import i18n from '@renderer/i18n'
import { DataApiErrorFactory, isDataApiError, toDataApiError } from '@shared/data/api'
import type { CreateMiniAppDto, UpdateMiniAppDto } from '@shared/data/api/schemas/miniApps'
import type { MiniApp, MiniAppRegion, MiniAppStatus } from '@shared/data/types/miniApp'
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
 * 1. CN users see everything.
 * 2. Global users:
 *    - Preset apps with supportedRegions including 'Global' → visible.
 *    - Preset apps without supportedRegions → CN-only (preserves the existing
 *      curated catalog semantics: presets that omit the field are intentionally
 *      gated to CN by the catalog author).
 *    - Custom apps (`presetMiniAppId === null`) without supportedRegions →
 *      visible. Custom apps come from migrated v1 data (which had no region
 *      concept) or from the user's own form, neither of which has a curated
 *      region intent. Defaulting them to CN-only would silently hide a user's
 *      own app under Global.
 */
const isVisibleForRegion = (app: MiniApp, region: MiniAppRegion): boolean => {
  if (region === 'CN') return true

  if (!app.supportedRegions || app.supportedRegions.length === 0) {
    return app.presetMiniAppId === null
  }
  return app.supportedRegions.includes('Global')
}

// Filter apps by region
const filterByRegion = (apps: MiniApp[], region: MiniAppRegion): MiniApp[] => {
  return apps.filter((app) => isVisibleForRegion(app, region))
}

// Module-level promise to ensure only one IP detection request is made
let regionDetectionPromise: Promise<MiniAppRegion> | null = null

/**
 * @only_for_testing - Reset module-level region detection state between tests
 */
export const __resetRegionDetectionForTesting = () => {
  regionDetectionPromise = null
}

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
    } catch (err) {
      // Default to CN so mainland China users — the primary audience — never
      // silently lose access to region-restricted apps they expect.
      const error = err as Error
      loggerService.withContext('detectUserRegion').error('Region detection failed, falling back to CN', {
        error: error.message,
        stack: error.stack,
        fallback: 'CN'
      })
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

/**
 * Process Promise.allSettled results: throw on partial failures so callers
 * can distinguish "all succeeded" from "partially failed", and invalidate
 * the cache to resync UI with DB after partial failures.
 */
async function settleAndInvalidate(
  results: PromiseSettledResult<MiniApp>[],
  invalidate: (path: string) => Promise<void>,
  label: string
): Promise<MiniApp[]> {
  const fulfilled = results.filter((r): r is PromiseFulfilledResult<MiniApp> => r.status === 'fulfilled')
  const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')

  if (rejected.length > 0) {
    const failures = rejected.map((f) => {
      const err = toDataApiError(f.reason)
      return isDataApiError(err)
        ? { code: err.code, message: err.message }
        : { code: 'UNKNOWN', message: String(f.reason) }
    })
    logger.error(`${label}: ${rejected.length} of ${results.length} updates failed`, { failures })
    // Resync UI with DB — partial failures leave local state drifting
    await invalidate('/mini-apps')
    throw DataApiErrorFactory.invalidOperation(
      `${label}: ${rejected.length} of ${results.length} updates failed`,
      i18n.t('miniApp.update_partial_failure', { failed: rejected.length, total: results.length })
    )
  }

  return fulfilled.map((r) => r.value)
}

export const useMiniApps = () => {
  const { data, isLoading, error, mutate: refetch } = useQuery('/mini-apps')
  const rawApps: MiniApp[] = useMemo(() => data ?? [], [data])

  // Partition by status in single pass (js-combine-iterations)
  const { allApps, enabled, disabled, pinned } = useMemo(() => {
    const all: MiniApp[] = []
    const ena: MiniApp[] = []
    const dis: MiniApp[] = []
    const pin: MiniApp[] = []
    for (const app of rawApps) {
      all.push(app)
      if (app.status === 'enabled') ena.push(app)
      else if (app.status === 'disabled') dis.push(app)
      else if (app.status === 'pinned') pin.push(app)
    }
    return { allApps: all, enabled: ena, disabled: dis, pinned: pin }
  }, [rawApps])

  // === Region (Preference + Cache) ===
  const [miniAppRegionSetting] = usePreference('feature.mini_app.region')
  const [detectedRegion, setDetectedRegion] = useCache('mini_app.detected_region')

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
      .catch((err) => {
        const error = err as Error
        loggerService.withContext('useMiniApps').error('Region detection failed in effect, falling back to CN', {
          error: error.message,
          stack: error.stack,
          fallback: 'CN'
        })
        if (!cancelled) setDetectedRegion('CN')
      })
    return () => {
      cancelled = true
    }
  }, [miniAppRegionSetting, detectedRegion, setDetectedRegion])

  // === Region-filtered views ===
  // Include pinned apps so they remain visible in the grid when pinned to launchpad/sidebar
  // Sort by sortOrder to maintain consistent positions regardless of status
  const miniApps = useMemo(() => {
    const visibleApps = [...enabled, ...pinned]
    const regionFiltered = filterByRegion(visibleApps, effectiveRegion)
    return regionFiltered.sort((a, b) => (a.orderKey < b.orderKey ? -1 : a.orderKey > b.orderKey ? 1 : 0))
  }, [enabled, effectiveRegion, pinned])
  const disabledApps = useMemo(() => filterByRegion(disabled, effectiveRegion), [disabled, effectiveRegion])
  // Pinned apps are always visible regardless of region
  const pinnedApps = pinned

  // === UI State Cache (unchanged) ===
  const [openedKeepAliveMiniApps, setOpenedKeepAliveMiniApps] = useCache('mini_app.opened_keep_alive')
  const [currentMiniAppId, setCurrentMiniAppId] = useCache('mini_app.current_id')
  const [miniAppShow, setMiniAppShow] = useCache('mini_app.show')
  const [openedOneOffMiniApp, setOpenedOneOffMiniApp] = useCache('mini_app.opened_oneoff')

  // === Mutations (DataApi) ===
  const invalidate = useInvalidateCache()

  // Batch PATCH/DELETE via dataApiService (for Promise.allSettled batch ops where
  // a single template useMutation would share isMutating/error state incorrectly)
  const patchApp = useCallback(
    async (appId: string, body: UpdateMiniAppDto) => {
      try {
        const result = await dataApiService.patch(`/mini-apps/${encodeURIComponent(appId)}`, { body })
        await invalidate('/mini-apps')
        return result
      } catch (error) {
        logger.error('Failed to patch mini app', { appId, error: toDataApiError(error) })
        throw toDataApiError(error)
      }
    },
    [invalidate]
  )

  // Fixed-path mutations (useMutation with auto-refresh)
  const { trigger: postMiniApp } = useMutation('POST', '/mini-apps', {
    refresh: ['/mini-apps']
  })

  // Fractional-indexing reorder per data-ordering-guide.md.
  // applyReorderedList computes minimal moves and dispatches to the right endpoint.
  const { applyReorderedList: applyMiniAppOrder } = useReorder('/mini-apps', { idKey: 'appId' })

  // Template-path mutations for single-item operations (per DataApi convention)
  const { trigger: patchAppTrigger } = useMutation('PATCH', '/mini-apps/:appId', {
    refresh: ['/mini-apps']
  })
  const { trigger: deleteAppTrigger } = useMutation('DELETE', '/mini-apps/:appId', {
    refresh: ['/mini-apps']
  })

  /**
   * Single-item status flip. Use this for hide / show / pin / unpin actions.
   *
   * Command-style — caller names the row and the target state. No inference
   * about untouched rows, so region-filtered views can call this safely without
   * accidentally affecting rows the caller never saw.
   */
  const updateAppStatus = useCallback(
    async (appId: string, status: MiniApp['status']) => {
      try {
        return await patchAppTrigger({ params: { appId }, body: { status } })
      } catch (error) {
        logger.error('Failed to update app status', { appId, error: toDataApiError(error) })
        throw toDataApiError(error)
      }
    },
    [patchAppTrigger]
  )

  /**
   * Batch status flip. Each entry is an explicit {appId, status} change.
   * Rows not present in `updates` are not touched — there is no diff against
   * the current cache, so this is safe to call from a region-filtered context.
   *
   * Use for swap (move two columns) and reset (move all hidden back to
   * enabled). Single-row actions belong on `updateAppStatus`.
   *
   * Throws an aggregated {@link DataApiErrorFactory.invalidOperation} when one
   * or more PATCHes fail; the cache is invalidated either way so the UI
   * reconciles with the DB on the next render.
   */
  const setAppStatusBulk = useCallback(
    async (updates: ReadonlyArray<{ appId: string; status: MiniApp['status'] }>) => {
      if (updates.length === 0) return Promise.resolve([] as MiniApp[])
      return Promise.allSettled(updates.map((u) => patchApp(u.appId, { status: u.status }))).then((results) =>
        settleAndInvalidate(results, invalidate, 'setAppStatusBulk')
      )
    },
    [patchApp, invalidate]
  )

  const createCustomMiniApp = useCallback(
    async (dto: CreateMiniAppDto) => {
      try {
        return await postMiniApp({ body: dto })
      } catch (error) {
        logger.error('Failed to create custom mini app', { error: toDataApiError(error) })
        throw toDataApiError(error)
      }
    },
    [postMiniApp]
  )

  const removeCustomMiniApp = useCallback(
    async (appId: string) => {
      try {
        return await deleteAppTrigger({ params: { appId } })
      } catch (error) {
        logger.error('Failed to remove custom mini app', { appId, error: toDataApiError(error) })
        throw toDataApiError(error)
      }
    },
    [deleteAppTrigger]
  )

  /**
   * Reorder miniApps. Pass the new ordered list (typically from a drag-and-drop
   * callback). Internally diffs against current order and dispatches the
   * minimal set of `PATCH /:id/order` or `PATCH /order:batch` calls.
   */
  const reorderMiniApps = useCallback(
    async (orderedApps: MiniApp[]) => {
      try {
        await applyMiniAppOrder(orderedApps)
      } catch (error) {
        logger.error('Failed to reorder mini apps', { error: toDataApiError(error) })
        throw toDataApiError(error)
      }
    },
    [applyMiniAppOrder]
  )

  /**
   * Reorder miniApps inside a single status partition.
   *
   * `useReorder('/mini-apps')` diffs the new list against the full `/mini-apps`
   * cache and `computeMinimalMoves` requires a permutation of the cache rows.
   * Settings UI hands us only one column (e.g. enabled rows). We splice the
   * subset back into the cache shape so the diff is well-formed and the
   * resulting moves all stay within one partition — the server enforces single
   * scope (see MiniAppService.reorder + applyScopedMoves).
   */
  const reorderMiniAppsByStatus = useCallback(
    async (status: MiniAppStatus, orderedPartition: MiniApp[]) => {
      let cursor = 0
      const merged = allApps.map((a) => {
        if (a.status !== status) return a
        return orderedPartition[cursor++] ?? a
      })
      try {
        await applyMiniAppOrder(merged)
      } catch (error) {
        logger.error('Failed to reorder mini apps within status', { status, error: toDataApiError(error) })
        throw toDataApiError(error)
      }
    },
    [allApps, applyMiniAppOrder]
  )

  return {
    allApps,
    miniApps,
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
    error,
    refetch,
    updateAppStatus,
    setAppStatusBulk,
    createCustomMiniApp,
    removeCustomMiniApp,
    reorderMiniApps,
    reorderMiniAppsByStatus
  }
}

export type UseMiniAppsReturn = ReturnType<typeof useMiniApps>
