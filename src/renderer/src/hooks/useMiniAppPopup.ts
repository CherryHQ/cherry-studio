import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { useMiniApps } from '@renderer/hooks/useMiniApps'
import NavigationService from '@renderer/services/NavigationService'
import { clearWebviewState } from '@renderer/utils/webviewStateManager'
import { DataApiErrorFactory } from '@shared/data/api'
import type { MiniApp, MiniAppId } from '@shared/data/types/miniApp'
import { useCallback, useEffect, useRef } from 'react'

const logger = loggerService.withContext('useMiniAppPopup')

const DEFAULT_MAX_KEEP_ALIVE = 10

/** Brand a raw string as MiniAppId. Safe — caller controls the string. */
function brandId(raw: string): MiniAppId {
  return raw as MiniAppId
}

type MiniAppInput = Omit<MiniApp, 'appId' | 'presetMiniappId' | 'status' | 'orderKey'> & {
  appId: string
}

function toMiniApp(input: MiniAppInput): MiniApp {
  return {
    ...input,
    appId: brandId(input.appId),
    presetMiniappId: input.appId,
    status: 'enabled',
    orderKey: ''
  }
}

/**
 * Cleanup performed when a miniapp is removed from the keep-alive list.
 * Clears persisted webview state. Tab closing in the v2 AppShell layout is
 * driven by the tabs cache directly; closing a v1 Redux tab here is no
 * longer meaningful (v2 layout does not render v1 tabs).
 */
function evictMiniApp(appId: string) {
  try {
    clearWebviewState(appId)
  } catch (error) {
    logger.error('Error during miniapp eviction', error as Error)
  }
}

/**
 * Usage:
 *
 *   To control the miniapp popup, you can use the following hooks:
 *     import { useMiniAppPopup } from '@renderer/hooks/useMiniAppPopup'
 *
 *   in the component:
 *     const { openMiniApp, openMiniAppKeepAlive, openMiniAppById,
 *             closeMiniApp, hideMiniAppPopup, closeAllMiniApps } = useMiniAppPopup()
 *
 *   To use some key states of the miniapp popup:
 *     import { useMiniApps } from '@renderer/hooks/useMiniApps'
 *     const { openedKeepAliveMiniApps, openedOneOffMiniApp, miniAppShow } = useMiniApps()
 */
export const useMiniAppPopup = () => {
  const {
    allApps,
    openedKeepAliveMiniApps,
    openedOneOffMiniApp,
    miniAppShow,
    setOpenedKeepAliveMiniApps,
    setOpenedOneOffMiniApp,
    setCurrentMiniAppId,
    setMiniAppShow
  } = useMiniApps()
  const [maxKeepAliveMiniApps] = usePreference('feature.mini_app.max_keep_alive')

  const cap = maxKeepAliveMiniApps ?? DEFAULT_MAX_KEEP_ALIVE

  // Mirror the React-synced keep-alive list into a ref so callbacks can read
  // the latest value without going through the cache service directly. Avoids
  // stale closures on a value that changes more frequently than callback deps.
  const keepAliveRef = useRef<MiniApp[]>(openedKeepAliveMiniApps)
  keepAliveRef.current = openedKeepAliveMiniApps

  // Trim the kept-alive list when the user lowers the cap. Evicts the oldest
  // entries (head of the list) so the most-recently-touched ones survive.
  useEffect(() => {
    const list = keepAliveRef.current
    if (list.length <= cap) return
    const overflow = list.length - cap
    const evicted = list.slice(0, overflow)
    setOpenedKeepAliveMiniApps(list.slice(overflow))
    for (const app of evicted) evictMiniApp(app.appId)
  }, [cap, setOpenedKeepAliveMiniApps])

  /** Open a miniapp (popup shows and miniapp loaded) */
  const openMiniApp = useCallback(
    (app: MiniApp, keepAlive: boolean = false) => {
      if (keepAlive) {
        const list = keepAliveRef.current
        const exists = list.some((item) => item.appId === app.appId)
        if (exists) {
          // "Touch": move to tail so it's the most recently used.
          const reordered = [...list.filter((item) => item.appId !== app.appId), app]
          setOpenedKeepAliveMiniApps(reordered)
          setCurrentMiniAppId(app.appId)
          setMiniAppShow(true)
          return
        }
        // Evict from the head while we're over capacity, then append.
        const next = [...list, app]
        while (next.length > cap) {
          const evicted = next.shift()
          if (evicted) evictMiniApp(evicted.appId)
        }
        setOpenedKeepAliveMiniApps(next)
        setOpenedOneOffMiniApp(null)
        setCurrentMiniAppId(app.appId)
        setMiniAppShow(true)
        return
      }

      //if the miniapp is not keep alive, open it as one-off miniapp
      setOpenedOneOffMiniApp(app)
      setCurrentMiniAppId(app.appId)
      setMiniAppShow(true)
    },
    [cap, setOpenedKeepAliveMiniApps, setOpenedOneOffMiniApp, setCurrentMiniAppId, setMiniAppShow]
  )

  /** a wrapper of openMiniApp(app, true) */
  const openMiniAppKeepAlive = useCallback(
    (app: MiniApp) => {
      openMiniApp(app, true)
    },
    [openMiniApp]
  )

  /** Open a miniapp by id (look up the miniapp in allApps from DataApi) */
  const openMiniAppById = useCallback(
    (id: string, keepAlive: boolean = false) => {
      const appDef = allApps.find((app) => app.appId === id)
      if (!appDef) {
        logger.warn(`MiniApp not found: ${id}`)
        throw DataApiErrorFactory.notFound('MiniApp', id)
      }
      openMiniApp(appDef, keepAlive)
    },
    [allApps, openMiniApp]
  )

  /** Close a miniapp immediately (popup hides and miniapp unloaded) */
  const closeMiniApp = useCallback(
    (appid: string) => {
      const list = keepAliveRef.current
      if (list.some((item) => item.appId === appid)) {
        setOpenedKeepAliveMiniApps(list.filter((item) => item.appId !== appid))
        evictMiniApp(appid)
      } else if (openedOneOffMiniApp?.appId === appid) {
        setOpenedOneOffMiniApp(null)
      }

      setCurrentMiniAppId('')
      setMiniAppShow(false)
    },
    [openedOneOffMiniApp, setOpenedKeepAliveMiniApps, setOpenedOneOffMiniApp, setCurrentMiniAppId, setMiniAppShow]
  )

  /** Close all miniapps (popup hides and all miniapps unloaded) */
  const closeAllMiniApps = useCallback(() => {
    const list = keepAliveRef.current
    setOpenedKeepAliveMiniApps([])
    setOpenedOneOffMiniApp(null)
    setCurrentMiniAppId('')
    setMiniAppShow(false)
    // Mirrors LRU.clear() firing disposeAfter per entry: clean up webviews +
    // close any tab still open for each previously kept-alive app.
    for (const app of list) evictMiniApp(app.appId)
  }, [setOpenedKeepAliveMiniApps, setOpenedOneOffMiniApp, setCurrentMiniAppId, setMiniAppShow])

  /** Hide the miniapp popup (only one-off miniapp unloaded) */
  const hideMiniAppPopup = useCallback(() => {
    if (!miniAppShow) return

    if (openedOneOffMiniApp) {
      setOpenedOneOffMiniApp(null)
      setCurrentMiniAppId('')
    }
    setMiniAppShow(false)
  }, [miniAppShow, openedOneOffMiniApp, setOpenedOneOffMiniApp, setCurrentMiniAppId, setMiniAppShow])

  /**
   * Open a miniapp from a transient config (e.g., a shared link). Adds to the
   * keep-alive list and navigates to the detail route — the global pool then
   * renders the webview. Same path for sidebar and top-navbar layouts.
   */
  const openSmartMiniApp = useCallback(
    (config: MiniAppInput) => {
      const app = toMiniApp(config)
      const list = keepAliveRef.current
      const wasCached = list.some((item: MiniApp) => item.appId === app.appId)
      if (!wasCached) {
        const next = [...list, app]
        while (next.length > cap) {
          const evicted = next.shift()
          if (evicted) evictMiniApp(evicted.appId)
        }
        setOpenedKeepAliveMiniApps(next)
      }

      setCurrentMiniAppId(app.appId)
      setMiniAppShow(true)

      // Skip route navigation when the app is already cached: the user is
      // already on/near that tab, and re-navigating would rerun route effects.
      if (!wasCached && NavigationService.navigate) {
        void NavigationService.navigate({ to: `/app/mini-app/${app.appId}` })
      }
    },
    [cap, setOpenedKeepAliveMiniApps, setCurrentMiniAppId, setMiniAppShow]
  )

  return {
    openMiniApp,
    openMiniAppKeepAlive,
    openMiniAppById,
    closeMiniApp,
    hideMiniAppPopup,
    closeAllMiniApps,
    openSmartMiniApp
  }
}
