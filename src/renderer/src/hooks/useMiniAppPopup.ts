import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { useMiniApps } from '@renderer/hooks/useMiniApps'
import NavigationService from '@renderer/services/NavigationService'
import { tabsService } from '@renderer/services/TabsService'
import { clearWebviewState } from '@renderer/utils/webviewStateManager'
import { DataApiErrorFactory } from '@shared/data/api'
import type { MiniApp, MiniAppId } from '@shared/data/types/miniApp'
import { LRUCache } from 'lru-cache'
import { useCallback, useEffect, useRef } from 'react'

import { useNavbarPosition } from './useNavbar'

const logger = loggerService.withContext('useMiniAppPopup')

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
 * Singleton LRU cache shared across all hook consumers.
 * Unlike module-level `let`, this is managed via a stable reference so that
 * multi-instance consumers always observe the same cache object after resize.
 */
let sharedCache: LRUCache<string, MiniApp> | undefined

/**
 * Cache version counter for tracking cache resets.
 * Incremented when the cache is discarded and recreated.
 */
let cacheVersion = 0

/**
 * Reset the module-level cache. For testing purposes only.
 * @internal
 */
export const _resetMiniAppsCache = () => {
  sharedCache = undefined
  cacheVersion++
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
  const { isTopNavbar } = useNavbarPosition()

  // Ref to hold callback so LRU disposeAfter/onInsert always calls the latest setter.
  // This replaces the old module-level `cacheCallbacksRef` which was overwritten on every
  // render — only the most recently mounted consumer's setter was called, silently
  // desyncing other consumers. A useRef per hook instance is safe because the ref is
  // read inside the cache callbacks which are closures over this specific ref.
  const callbacksRef = useRef({
    setOpenedKeepAliveMiniApps
  })
  // Keep the ref current on every render
  callbacksRef.current = { setOpenedKeepAliveMiniApps }

  const createLRUCache = useCallback(() => {
    return new LRUCache<string, MiniApp>({
      max: maxKeepAliveMiniApps ?? 10,
      disposeAfter: (_value, key) => {
        try {
          // Clean up WebView state when app is disposed from cache
          clearWebviewState(key)

          // Close corresponding tab if it exists
          const tabs = tabsService.getTabs()
          const tabToClose = tabs.find((tab) => tab.path === `/app/mini-app/${key}`)
          if (tabToClose) {
            tabsService.closeTab(tabToClose.id)
          }

          // Update cache state using ref (always has latest setter)
          if (callbacksRef.current && sharedCache) {
            callbacksRef.current.setOpenedKeepAliveMiniApps(Array.from(sharedCache.values()))
          }
        } catch (error) {
          logger.error('Error in LRU disposeAfter callback', error as Error)
        }
      },
      onInsert: () => {
        try {
          // Update cache state using ref (always has latest setter)
          if (callbacksRef.current && sharedCache) {
            callbacksRef.current.setOpenedKeepAliveMiniApps(Array.from(sharedCache.values()))
          }
        } catch (error) {
          logger.error('Error in LRU onInsert callback', error as Error)
        }
      },
      updateAgeOnGet: true,
      updateAgeOnHas: true
    })
  }, [maxKeepAliveMiniApps])

  // Track previous maxKeepAliveMiniApps to detect changes
  const prevMaxKeepAlive = useRef(maxKeepAliveMiniApps)
  // Track cache version to detect external resets
  const prevCacheVersion = useRef(cacheVersion)

  // Initialize cache synchronously if not already initialized
  if (!sharedCache) {
    sharedCache = createLRUCache()
    prevMaxKeepAlive.current = maxKeepAliveMiniApps
    prevCacheVersion.current = cacheVersion
  }

  // Handle cache resize when maxKeepAliveMiniApps changes or external reset
  useEffect(() => {
    const prev = prevMaxKeepAlive.current
    const current = maxKeepAliveMiniApps

    // Check if cache was reset externally (version changed)
    const wasReset = prevCacheVersion.current !== cacheVersion

    // Handle external reset
    if (wasReset) {
      sharedCache = createLRUCache()
      prevMaxKeepAlive.current = current
      prevCacheVersion.current = cacheVersion
      return
    }

    // Handle cache resize when maxKeepAliveMiniApps changes
    if (prev === current) return
    prevMaxKeepAlive.current = current

    // Always rebuild cache when max changes
    // LRU cache mechanism: entries set later are placed first, so reverse
    const oldEntries = Array.from(sharedCache!.entries()).reverse()
    sharedCache = createLRUCache()
    // Add entries up to the new max (LRU cache will evict excess automatically)
    oldEntries.forEach(([key, value]) => {
      sharedCache!.set(key, value)
    })
  }, [maxKeepAliveMiniApps, createLRUCache])

  /** Open a miniapp (popup shows and miniapp loaded) */
  const openMiniApp = useCallback(
    (app: MiniApp, keepAlive: boolean = false) => {
      if (keepAlive && sharedCache) {
        // Check the LRU cache (canonical source) before mutating it.
        // openedKeepAliveMiniApps lags one render behind onInsert, so it
        // would return stale results immediately after sharedCache.set.
        const alreadyOpen = sharedCache.has(app.appId)
        if (!alreadyOpen) sharedCache.set(app.appId, app)

        // If the miniapp is already open, just switch the display
        if (alreadyOpen) {
          setCurrentMiniAppId(app.appId)
          setMiniAppShow(true)
          return
        }
        setOpenedOneOffMiniApp(null)
        setCurrentMiniAppId(app.appId)
        setMiniAppShow(true)
        return
      }

      //if the miniapp is not keep alive, open it as one-off miniapp
      setOpenedOneOffMiniApp(app)
      setCurrentMiniAppId(app.appId)
      setMiniAppShow(true)
      return
    },
    [setOpenedOneOffMiniApp, setCurrentMiniAppId, setMiniAppShow]
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
      if (openedKeepAliveMiniApps.some((item) => item.appId === appid) && sharedCache) {
        sharedCache.delete(appid)
      } else if (openedOneOffMiniApp?.appId === appid) {
        setOpenedOneOffMiniApp(null)
      }

      setCurrentMiniAppId('')
      setMiniAppShow(false)
      return
    },
    [openedKeepAliveMiniApps, openedOneOffMiniApp, setOpenedOneOffMiniApp, setCurrentMiniAppId, setMiniAppShow]
  )

  /** Close all miniapps (popup hides and all miniapps unloaded) */
  const closeAllMiniApps = useCallback(() => {
    // sharedCache.clear would invoke dispose multiple times,
    // so recreate the LRU cache to replace it
    sharedCache = createLRUCache()
    setOpenedKeepAliveMiniApps([])
    setOpenedOneOffMiniApp(null)
    setCurrentMiniAppId('')
    setMiniAppShow(false)
  }, [createLRUCache, setOpenedKeepAliveMiniApps, setOpenedOneOffMiniApp, setCurrentMiniAppId, setMiniAppShow])

  /** Hide the miniapp popup (only one-off miniapp unloaded) */
  const hideMiniAppPopup = useCallback(() => {
    if (!miniAppShow) return

    if (openedOneOffMiniApp) {
      setOpenedOneOffMiniApp(null)
      setCurrentMiniAppId('')
    }
    setMiniAppShow(false)
  }, [miniAppShow, openedOneOffMiniApp, setOpenedOneOffMiniApp, setCurrentMiniAppId, setMiniAppShow])

  /** Smart open miniapp that adapts to navbar position */
  const openSmartMiniApp = useCallback(
    (config: MiniAppInput, keepAlive: boolean = false) => {
      const app = toMiniApp(config)
      if (isTopNavbar && sharedCache) {
        // For top navbar mode, need to add to cache first for temporary apps
        const cacheApp = sharedCache.get(app.appId)
        if (!cacheApp) {
          // Add temporary app to cache so MiniAppPage can find it
          sharedCache.set(app.appId, app)
        }

        // Set current miniapp and show state
        setCurrentMiniAppId(app.appId)
        setMiniAppShow(true)

        // Then navigate to the app tab using NavigationService
        if (NavigationService.navigate) {
          void NavigationService.navigate({ to: `/app/mini-app/${app.appId}` })
        }
      } else {
        // For side navbar, use the traditional popup system
        openMiniApp(app, keepAlive)
      }
    },
    [isTopNavbar, openMiniApp, setCurrentMiniAppId, setMiniAppShow]
  )

  return {
    openMiniApp,
    openMiniAppKeepAlive,
    openMiniAppById,
    closeMiniApp,
    hideMiniAppPopup,
    closeAllMiniApps,
    openSmartMiniApp,
    // Expose cache instance for TabsService integration
    miniAppsCache: sharedCache
  }
}
