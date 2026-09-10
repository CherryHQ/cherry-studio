import { dataApiService } from '@data/DataApiService'
import { useCache } from '@data/hooks/useCache'
import { useDataChange, useInvalidateCache, useMutation, useQuery, useReadCache } from '@data/hooks/useDataApi'
import { usePreference } from '@data/hooks/usePreference'
import { useReorder } from '@data/hooks/useReorder'
import { loggerService } from '@logger'
import { computeMinimalMoves } from '@renderer/data/utils/reorder'
import { useOptionalTabsContext } from '@renderer/hooks/tab'
import { useSidebarFavorites } from '@renderer/hooks/useSidebarFavorites'
import i18n from '@renderer/i18n/resolver'
import { ipcApi } from '@renderer/ipc'
import { miniAppMutationService } from '@renderer/services/MiniAppMutationService'
import { getAppEdition } from '@renderer/utils/appEdition'
import { clearWebviewState, setWebviewLoaded } from '@renderer/utils/webviewStateManager'
import { toDataApiError } from '@shared/data/api/errors'
import type { OrderRequest } from '@shared/data/api/schemas/_endpointHelpers'
import type { CreateMiniAppDto, UpdateMiniAppDto } from '@shared/data/api/schemas/miniApps'
import type { MiniApp, MiniAppRegion, MiniAppStatus } from '@shared/data/types/miniApp'
import type { AppEdition } from '@shared/types/appEdition'
import { resolveLocalizedText } from '@shared/types/miniAppManifest'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Data Flow Design:
 *
 * PRINCIPLE: Catalog filtering is a VIEW concern, not a DATA concern.
 *
 * - DataApi stores ALL apps (including hidden catalog entries) to preserve user preferences
 * - PRESETS_MINI_APPS is the preset data source containing region definitions
 * - This hook applies region and edition filtering only when reading for UI display
 * - Mutations target individual apps by appId, never touching hidden apps
 */

/**
 * Check if app should be visible for the given region.
 *
 * Region-based visibility rules:
 * 1. CN users see everything.
 * 2. Global users see presets that support Global. Presets without a region
 *    declaration retain the legacy CN-only default.
 * 3. User-added sites and installed local apps remain visible everywhere.
 */
const isVisibleForRegion = (app: MiniApp, region: MiniAppRegion): boolean => {
  if (app.kind === 'app') return true
  if (region === 'CN') return true

  if (!app.supportedRegions || app.supportedRegions.length === 0) {
    return app.presetMiniAppId === null
  }
  return app.supportedRegions.includes('Global')
}

const isVisibleForEdition = (app: MiniApp, appEdition: AppEdition): boolean => {
  if (appEdition === 'global' || app.kind === 'app' || app.presetMiniAppId === null) return true
  return !app.supportedRegions?.length || app.supportedRegions.includes('CN')
}

function isVisibleStatus(status: MiniAppStatus): boolean {
  return status === 'enabled' || status === 'pinned'
}

function compareOrderKey(a: MiniApp, b: MiniApp): number {
  return a.orderKey < b.orderKey ? -1 : a.orderKey > b.orderKey ? 1 : 0
}

type OrderRequestResolver = OrderRequest | ((apps: readonly MiniApp[]) => OrderRequest)
type MiniAppStatusUpdate = { appId: string; status: MiniApp['status']; order?: OrderRequest }
type MiniAppStatusUpdatesResolver =
  | ReadonlyArray<MiniAppStatusUpdate>
  | ((apps: readonly MiniApp[]) => ReadonlyArray<MiniAppStatusUpdate>)

// Filter apps by region
const filterByRegion = (apps: MiniApp[], region: MiniAppRegion): MiniApp[] => {
  return apps.filter((app) => isVisibleForRegion(app, region))
}

const filterByEdition = (apps: MiniApp[], appEdition: AppEdition): MiniApp[] => {
  return apps.filter((app) => isVisibleForEdition(app, appEdition))
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
      const country = await ipcApi.request('system.get_ip_country')
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
const MINI_APP_ROUTE_PREFIX = '/app/mini-app/'

/** Extract the appId from a `/app/mini-app/<id>` URL, or null otherwise. */
function miniAppIdFromTabUrl(url: string): string | null {
  if (!url.startsWith(MINI_APP_ROUTE_PREFIX)) return null
  const id = url.slice(MINI_APP_ROUTE_PREFIX.length).split('/')[0]
  return id ? id : null
}

export const useMiniApps = (options: { enabled?: boolean } = {}) => {
  const queryEnabled = options.enabled ?? true
  const appEdition = getAppEdition()
  const { data, isLoading, error, mutate: refetch } = useQuery('/mini-apps', { enabled: queryEnabled })
  const { i18n: i18nInstance } = useTranslation()
  const language = i18nInstance.language
  // Main resolved `name` for the language at query time and the query is cached; a
  // language switch would otherwise leave every installed app under its old name.
  const rawApps: MiniApp[] = useMemo(
    () =>
      (data ?? []).map((app) =>
        app.kind === 'app' ? { ...app, name: resolveLocalizedText(app.nameI18n, language) } : app
      ),
    [data, language]
  )

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
    appEdition === 'cn'
      ? 'CN'
      : miniAppRegionSetting === 'auto'
        ? (detectedRegion ?? 'CN')
        : miniAppRegionSetting === 'CN' || miniAppRegionSetting === 'Global'
          ? miniAppRegionSetting
          : 'CN'

  // Auto-detect region once per session
  useEffect(() => {
    if (appEdition === 'cn' || !queryEnabled || miniAppRegionSetting !== 'auto' || detectedRegion) return
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
  }, [appEdition, detectedRegion, miniAppRegionSetting, queryEnabled, setDetectedRegion])

  // === Region-filtered views ===
  // Include pinned apps so they remain visible in the grid when pinned to launchpad/sidebar
  // Sort by orderKey to maintain consistent visible positions regardless of status
  const miniApps = useMemo(() => {
    const visibleApps = [...enabled, ...pinned]
    const regionFiltered = filterByRegion(visibleApps, effectiveRegion)
    const editionFiltered = filterByEdition(regionFiltered, appEdition)
    return editionFiltered.sort((a, b) => (a.orderKey < b.orderKey ? -1 : a.orderKey > b.orderKey ? 1 : 0))
  }, [appEdition, enabled, effectiveRegion, pinned])
  const disabledApps = useMemo(
    () => filterByEdition(filterByRegion(disabled, effectiveRegion), appEdition),
    [appEdition, disabled, effectiveRegion]
  )
  // Global keeps pinned apps across region choices; CN still enforces its edition catalog.
  const pinnedApps = useMemo(() => filterByEdition(pinned, appEdition), [appEdition, pinned])
  const allAppsRef = useRef(allApps)
  allAppsRef.current = allApps

  // === UI State Cache (unchanged) ===
  const [openedKeepAliveMiniApps, setOpenedKeepAliveMiniApps] = useCache('mini_app.opened_keep_alive')
  // Mirror the latest keep-alive list into a ref so callbacks that run after an
  // await (syncOpenedCustomMiniApp) read fresh data, not the render-time snapshot.
  const openedKeepAliveRef = useRef(openedKeepAliveMiniApps)
  openedKeepAliveRef.current = openedKeepAliveMiniApps
  const [currentMiniAppId, setCurrentMiniAppId] = useCache('mini_app.current_id')
  const currentMiniAppIdRef = useRef(currentMiniAppId)
  currentMiniAppIdRef.current = currentMiniAppId
  const [splitOpen, setSplitOpen] = useCache('mini_app.split_open')
  const [splitMiniAppId, setSplitMiniAppId] = useCache('mini_app.split_id')
  const splitMiniAppIdRef = useRef(splitMiniAppId)
  splitMiniAppIdRef.current = splitMiniAppId
  const [miniAppShow, setMiniAppShow] = useCache('mini_app.show')
  const [openedOneOffMiniApp, setOpenedOneOffMiniApp] = useCache('mini_app.opened_oneoff')
  const openedOneOffMiniAppRef = useRef(openedOneOffMiniApp)
  openedOneOffMiniAppRef.current = openedOneOffMiniApp
  const { removeMiniApp: removeSidebarFavoriteMiniApp } = useSidebarFavorites()
  const tabsContext = useOptionalTabsContext()
  const tabsContextRef = useRef(tabsContext)
  tabsContextRef.current = tabsContext

  // === Mutations (DataApi) ===
  const invalidate = useInvalidateCache()
  const readCache = useReadCache()

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
  const { trigger: patchMiniAppOrderTrigger } = useMutation('PATCH', '/mini-apps/:id/order', {
    refresh: ['/mini-apps']
  })
  const { trigger: patchMiniAppOrderBatchTrigger } = useMutation('PATCH', '/mini-apps/order:batch', {
    refresh: ['/mini-apps']
  })
  const { trigger: patchMiniAppStatusBatchTrigger } = useMutation('PATCH', '/mini-apps/status:batch', {
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
    (appId: string, status: MiniApp['status'], order?: OrderRequestResolver) =>
      miniAppMutationService.enqueue(async () => {
        try {
          const resolvedOrder =
            typeof order === 'function' ? order(readCache<MiniApp[]>('/mini-apps') ?? allAppsRef.current) : order
          return await patchAppTrigger({ params: { appId }, body: { status, order: resolvedOrder } })
        } catch (error) {
          await invalidate('/mini-apps')
          logger.error('Failed to update app status', { appId, error: toDataApiError(error) })
          throw toDataApiError(error)
        }
      }),
    [invalidate, patchAppTrigger, readCache]
  )

  const hideMiniApp = useCallback(
    async (appId: string) => {
      const updated = await updateAppStatus(appId, 'disabled')
      setOpenedKeepAliveMiniApps((prev) => prev.filter((item) => item.appId !== appId))
      if (splitMiniAppIdRef.current === appId) {
        setSplitMiniAppId('')
        setSplitOpen(false)
      }
      return updated
    },
    [setOpenedKeepAliveMiniApps, setSplitMiniAppId, setSplitOpen, updateAppStatus]
  )

  /**
   * Batch status flip. Each entry names a row, its status, and optionally its
   * target position in the destination partition.
   * Rows not present in `updates` are not touched — there is no diff against
   * the current cache, so this is safe to call from a region-filtered context.
   *
   * Use for swap (move two columns) and reset (move all hidden back to
   * enabled). Single-row actions belong on `updateAppStatus`.
   *
   * The service commits the complete batch in one transaction, including any
   * requested destination order, so reset cannot leave a partial result.
   */
  const setAppStatusBulk = useCallback(
    async (updates: MiniAppStatusUpdatesResolver) => {
      if (Array.isArray(updates) && updates.length === 0) return
      await miniAppMutationService.enqueue(async () => {
        try {
          const resolvedUpdates =
            typeof updates === 'function' ? updates(readCache<MiniApp[]>('/mini-apps') ?? allAppsRef.current) : updates
          if (resolvedUpdates.length === 0) return
          await patchMiniAppStatusBatchTrigger({ body: { updates: [...resolvedUpdates] } })
        } catch (error) {
          await invalidate('/mini-apps')
          logger.error('Failed to update mini app statuses', { error: toDataApiError(error) })
          throw toDataApiError(error)
        }
      })
    },
    [invalidate, patchMiniAppStatusBatchTrigger, readCache]
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

  const syncOpenedCustomMiniApp = useCallback(
    (updated: MiniApp) => {
      // Read the latest keep-alive list at call time (not the render-time snapshot)
      // so an app opened concurrently during the edit's await is seen here and
      // picks up the new url instead of being missed.
      const openedKeepAliveApp = openedKeepAliveRef.current.find((app) => app.appId === updated.appId)
      const openedOneOffApp =
        openedOneOffMiniAppRef.current?.appId === updated.appId ? openedOneOffMiniAppRef.current : null
      const urlChanged =
        (openedKeepAliveApp !== undefined && openedKeepAliveApp.url !== updated.url) ||
        (openedOneOffApp !== null && openedOneOffApp.url !== updated.url)

      if (openedKeepAliveApp) {
        setOpenedKeepAliveMiniApps((prev) => prev.map((app) => (app.appId === updated.appId ? updated : app)))
      }

      if (openedOneOffApp) {
        setOpenedOneOffMiniApp(updated)
      }

      if (urlChanged) {
        setWebviewLoaded(updated.appId, false)
      }

      const title = updated.nameKey ? i18n.t(updated.nameKey) : updated.name
      // Uploaded logo → main-resolved `logoSrc`; preset key → `logo`.
      const icon = updated.logoSrc ?? updated.logo
      for (const tab of tabsContextRef.current?.tabs ?? []) {
        if (miniAppIdFromTabUrl(tab.url) === updated.appId) {
          tabsContextRef.current?.updateTab(tab.id, { title, icon })
        }
      }
    },
    [setOpenedKeepAliveMiniApps, setOpenedOneOffMiniApp]
  )

  const cleanupOpenedCustomMiniApp = useCallback(
    (appId: string) => {
      // Functional update resolves against the latest list, so the prior
      // `.some(...)` presence guard is redundant: filtering an absent id is a
      // no-op the cache short-circuits via isEqual.
      setOpenedKeepAliveMiniApps((prev) => prev.filter((app) => app.appId !== appId))

      if (openedOneOffMiniAppRef.current?.appId === appId) {
        setOpenedOneOffMiniApp(null)
      }

      if (currentMiniAppIdRef.current === appId) {
        setCurrentMiniAppId('')
        setMiniAppShow(false)
      }

      // The split pane's app is gone; leaving the pane open would replace it
      // with a picker the user never asked for.
      if (splitMiniAppIdRef.current === appId) {
        setSplitMiniAppId('')
        setSplitOpen(false)
      }

      clearWebviewState(appId)

      for (const tab of tabsContextRef.current?.tabs ?? []) {
        if (miniAppIdFromTabUrl(tab.url) === appId) {
          tabsContextRef.current?.closeTab(tab.id)
        }
      }

      removeSidebarFavoriteMiniApp(appId)
    },
    [
      setCurrentMiniAppId,
      setSplitMiniAppId,
      setSplitOpen,
      setMiniAppShow,
      setOpenedKeepAliveMiniApps,
      setOpenedOneOffMiniApp,
      removeSidebarFavoriteMiniApp
    ]
  )

  const updateCustomMiniApp = useCallback(
    async (appId: string, dto: UpdateMiniAppDto) => {
      try {
        const updated = await patchAppTrigger({ params: { appId }, body: dto })
        try {
          syncOpenedCustomMiniApp(updated)
        } catch (syncError) {
          logger.error('Failed to sync opened custom mini app after update', { appId, error: syncError })
        }
        return updated
      } catch (error) {
        logger.error('Failed to update custom mini app', { appId, error: toDataApiError(error) })
        throw toDataApiError(error)
      }
    },
    [patchAppTrigger, syncOpenedCustomMiniApp]
  )

  const refreshCustomMiniApp = useCallback(
    async (appId: string) => {
      try {
        const updated = await dataApiService.get(`/mini-apps/${encodeURIComponent(appId)}`)
        syncOpenedCustomMiniApp(updated)
      } catch (syncError) {
        logger.error('Failed to sync custom mini app after logo update', { appId, error: syncError })
      }

      try {
        await invalidate('/mini-apps')
      } catch (refreshError) {
        logger.error('Failed to refresh mini apps after logo update', { appId, error: refreshError })
      }
    },
    [invalidate, syncOpenedCustomMiniApp]
  )

  const removeCustomMiniApp = useCallback(
    async (appId: string) => {
      try {
        const result = await deleteAppTrigger({ params: { appId } })
        // The row is already gone; a cleanup failure must not report the
        // delete itself as failed.
        try {
          cleanupOpenedCustomMiniApp(appId)
        } catch (syncError) {
          logger.error('Failed to cleanup opened custom mini app after delete', { appId, error: syncError })
        }
        return result
      } catch (error) {
        logger.error('Failed to remove custom mini app', { appId, error: toDataApiError(error) })
        throw toDataApiError(error)
      }
    },
    [cleanupOpenedCustomMiniApp, deleteAppTrigger]
  )

  /**
   * Reorder miniApps. Pass the new ordered list (typically from a drag-and-drop
   * callback). Internally diffs against current order and dispatches the
   * minimal set of `PATCH /:id/order` or `PATCH /order:batch` calls.
   */
  const reorderMiniApps = useCallback(
    (orderedApps: MiniApp[]) =>
      miniAppMutationService.enqueue(async () => {
        try {
          await applyMiniAppOrder(orderedApps)
        } catch (error) {
          logger.error('Failed to reorder mini apps', { error: toDataApiError(error) })
          throw toDataApiError(error)
        }
      }),
    [applyMiniAppOrder]
  )

  /**
   * Reorder miniApps inside a status-backed list.
   *
   * Settings UI only passes the affected list, so compute moves against that
   * list's own order-key baseline. The service validates the same scopes:
   * `enabled` + `pinned` share the visible list; `disabled` stays hidden.
   */
  const reorderMiniAppsByStatus = useCallback(
    async (status: MiniAppStatus | 'visible', orderedPartition: MiniApp[]) => {
      const persist = async () => {
        try {
          const inScope = (app: MiniApp) => (status === 'visible' ? isVisibleStatus(app.status) : app.status === status)
          const orderedIds = new Set(orderedPartition.map((app) => app.appId))
          // Status mutate+refresh writes SWR before React re-renders; peek that membership.
          const apps = readCache<MiniApp[]>('/mini-apps') ?? allApps
          const currentPartition = apps.filter((app) => orderedIds.has(app.appId) && inScope(app)).sort(compareOrderKey)
          const currentIds = new Set(currentPartition.map((app) => app.appId))
          // A queued status write may move requested rows out of this partition; preserve the drag order of survivors.
          const currentOrderedPartition = orderedPartition.filter((app) => currentIds.has(app.appId))
          const moves = computeMinimalMoves(currentPartition, currentOrderedPartition, 'appId')
          if (moves.length === 0) return

          if (moves.length === 1) {
            const [move] = moves
            await patchMiniAppOrderTrigger({ params: { id: move.id }, body: move.anchor })
          } else {
            await patchMiniAppOrderBatchTrigger({ body: { moves } })
          }
        } catch (error) {
          await invalidate('/mini-apps')
          logger.error('Failed to reorder mini apps within status', { status, error: toDataApiError(error) })
          throw toDataApiError(error)
        }
      }

      return miniAppMutationService.enqueue(persist)
    },
    [allApps, invalidate, patchMiniAppOrderBatchTrigger, patchMiniAppOrderTrigger, readCache]
  )

  return {
    allApps,
    miniApps,
    disabled: disabledApps,
    pinned: pinnedApps,
    effectiveRegion,
    openedKeepAliveMiniApps,
    currentMiniAppId,
    splitOpen,
    splitMiniAppId,
    miniAppShow,
    openedOneOffMiniApp,
    setOpenedKeepAliveMiniApps,
    setCurrentMiniAppId,
    setSplitOpen,
    setSplitMiniAppId,
    setMiniAppShow,
    setOpenedOneOffMiniApp,
    isLoading,
    error,
    refetch,
    updateAppStatus,
    hideMiniApp,
    setAppStatusBulk,
    createCustomMiniApp,
    updateCustomMiniApp,
    refreshCustomMiniApp,
    removeCustomMiniApp,
    reorderMiniApps,
    reorderMiniAppsByStatus
  }
}

export type UseMiniAppsReturn = ReturnType<typeof useMiniApps>

/**
 * Converges `/mini-apps` after the writes DataApi cannot see: install, uninstall,
 * update apply and rollback commit through IpcApi, so no mutation invalidates the
 * query cache. Main publishes `notifyDataApiDataChange` after each commit; this is
 * the renderer half. Mounted ONCE per window by `useWindowRuntime`.
 */
export function useMiniAppListSync(): void {
  const invalidate = useInvalidateCache()
  useDataChange('/mini-apps', () => {
    void invalidate('/mini-apps')
  })
}
