import { usePreference } from '@data/hooks/usePreference'
import { useMinapps } from '@renderer/hooks/useMinapps'
import NavigationService from '@renderer/services/NavigationService'
import { tabsService } from '@renderer/services/TabsService'
import { clearWebviewState } from '@renderer/utils/webviewStateManager'
import type { MiniApp } from '@shared/data/types/miniapp'
import { LRUCache } from 'lru-cache'
import { useCallback, useEffect, useRef } from 'react'

import { useNavbarPosition } from './useNavbar'

type MiniAppInput = Pick<MiniApp, 'appId' | 'name' | 'url' | 'logo'> &
  Partial<Omit<MiniApp, 'appId' | 'name' | 'url' | 'logo' | 'type' | 'status' | 'sortOrder'>>

function toMiniApp(input: MiniAppInput): MiniApp {
  return {
    ...input,
    type: 'default',
    status: 'enabled',
    sortOrder: 0
  } as MiniApp
}

let minAppsCache: LRUCache<string, MiniApp>

/**
 * Refs to hold callback functions that need to be updated on each render.
 * This allows the LRU cache callbacks to always use the latest setters.
 */
let cacheCallbacksRef: {
  setOpenedKeepAliveMinapps: (apps: MiniApp[]) => void
} | null = null

/**
 * Cache version counter for tracking cache resets.
 * Used to force re-initialization when the cache is reset externally.
 */
let cacheVersion = 0

/**
 * Reset the module-level cache. For testing purposes only.
 * @internal
 */
export const _resetMinAppsCache = () => {
  minAppsCache = undefined as unknown as LRUCache<string, MiniApp>
  cacheCallbacksRef = null
  cacheVersion++
}

/**
 * Usage:
 *
 *   To control the minapp popup, you can use the following hooks:
 *     import { useMinappPopup } from '@renderer/hooks/useMinappPopup'
 *
 *   in the component:
 *     const { openMinapp, openMinappKeepAlive, openMinappById,
 *             closeMinapp, hideMinappPopup, closeAllMinapps } = useMinappPopup()
 *
 *   To use some key states of the minapp popup:
 *     import { useMinapps } from '@renderer/hooks/useMinapps'
 *     const { openedKeepAliveMinapps, openedOneOffMinapp, minappShow } = useMinapps()
 */
export const useMinappPopup = () => {
  const {
    allApps,
    openedKeepAliveMinapps,
    openedOneOffMinapp,
    minappShow,
    setOpenedKeepAliveMinapps,
    setOpenedOneOffMinapp,
    setCurrentMinappId,
    setMinappShow
  } = useMinapps()
  const [maxKeepAliveMinapps] = usePreference('feature.minapp.max_keep_alive')
  const { isTopNavbar } = useNavbarPosition()

  // Update the ref on every render so callbacks always have latest setters
  cacheCallbacksRef = {
    setOpenedKeepAliveMinapps
  }

  const createLRUCache = useCallback(() => {
    return new LRUCache<string, MiniApp>({
      max: maxKeepAliveMinapps ?? 10,
      disposeAfter: (_value, key) => {
        // Clean up WebView state when app is disposed from cache
        clearWebviewState(key)

        // Close corresponding tab if it exists
        const tabs = tabsService.getTabs()
        const tabToClose = tabs.find((tab) => tab.path === `/app/minapp/${key}`)
        if (tabToClose) {
          tabsService.closeTab(tabToClose.id)
        }

        // Update cache state using ref (always has latest setter)
        if (cacheCallbacksRef && minAppsCache) {
          cacheCallbacksRef.setOpenedKeepAliveMinapps(Array.from(minAppsCache.values()))
        }
      },
      onInsert: () => {
        // Update cache state using ref (always has latest setter)
        if (cacheCallbacksRef && minAppsCache) {
          cacheCallbacksRef.setOpenedKeepAliveMinapps(Array.from(minAppsCache.values()))
        }
      },
      updateAgeOnGet: true,
      updateAgeOnHas: true
    })
  }, [maxKeepAliveMinapps])

  // Track previous maxKeepAliveMinapps to detect changes
  const prevMaxKeepAlive = useRef(maxKeepAliveMinapps)
  // Track cache version to detect external resets
  const prevCacheVersion = useRef(cacheVersion)

  // Initialize cache synchronously if not already initialized
  if (!minAppsCache) {
    minAppsCache = createLRUCache()
    prevMaxKeepAlive.current = maxKeepAliveMinapps
    prevCacheVersion.current = cacheVersion
  }

  // Handle cache resize when maxKeepAliveMinapps changes or external reset
  useEffect(() => {
    const prev = prevMaxKeepAlive.current
    const current = maxKeepAliveMinapps

    // Check if cache was reset externally (version changed)
    const wasReset = prevCacheVersion.current !== cacheVersion

    // Handle external reset
    if (wasReset) {
      minAppsCache = createLRUCache()
      prevMaxKeepAlive.current = current
      prevCacheVersion.current = cacheVersion
      return
    }

    // Handle cache resize when maxKeepAliveMinapps changes
    if (prev === current) return
    prevMaxKeepAlive.current = current

    // Always rebuild cache when max changes
    // LRU cache mechanism: entries set later are placed first, so reverse
    const oldEntries = Array.from(minAppsCache.entries()).reverse()
    minAppsCache = createLRUCache()
    // Add entries up to the new max (LRU cache will evict excess automatically)
    oldEntries.forEach(([key, value]) => {
      minAppsCache.set(key, value)
    })
  }, [maxKeepAliveMinapps, createLRUCache])

  /** Open a minapp (popup shows and minapp loaded) */
  const openMinapp = useCallback(
    (app: MiniApp, keepAlive: boolean = false) => {
      if (keepAlive && minAppsCache) {
        // 通过 get 和 set 去更新缓存，避免重复添加
        const cacheApp = minAppsCache.get(app.appId)
        if (!cacheApp) minAppsCache.set(app.appId, app)

        // 如果小程序已经打开，只切换显示
        if (openedKeepAliveMinapps.some((item) => item.appId === app.appId)) {
          setCurrentMinappId(app.appId)
          setMinappShow(true)
          return
        }
        setOpenedOneOffMinapp(null)
        setCurrentMinappId(app.appId)
        setMinappShow(true)
        return
      }

      //if the minapp is not keep alive, open it as one-off minapp
      setOpenedOneOffMinapp(app)
      setCurrentMinappId(app.appId)
      setMinappShow(true)
      return
    },
    [openedKeepAliveMinapps, setOpenedOneOffMinapp, setCurrentMinappId, setMinappShow]
  )

  /** a wrapper of openMinapp(app, true) */
  const openMinappKeepAlive = useCallback(
    (app: MiniApp) => {
      openMinapp(app, true)
    },
    [openMinapp]
  )

  /** Open a minapp by id (look up the minapp in allApps from DataApi) */
  const openMinappById = useCallback(
    (id: string, keepAlive: boolean = false) => {
      const appDef = allApps.find((app) => app.appId === id)
      if (appDef) {
        openMinapp(appDef, keepAlive)
      }
    },
    [allApps, openMinapp]
  )

  /** Close a minapp immediately (popup hides and minapp unloaded) */
  const closeMinapp = useCallback(
    (appid: string) => {
      if (openedKeepAliveMinapps.some((item) => item.appId === appid) && minAppsCache) {
        minAppsCache.delete(appid)
      } else if (openedOneOffMinapp?.appId === appid) {
        setOpenedOneOffMinapp(null)
      }

      setCurrentMinappId('')
      setMinappShow(false)
      return
    },
    [openedKeepAliveMinapps, openedOneOffMinapp, setOpenedOneOffMinapp, setCurrentMinappId, setMinappShow]
  )

  /** Close all minapps (popup hides and all minapps unloaded) */
  const closeAllMinapps = useCallback(() => {
    // minAppsCache.clear 会多次调用 dispose 方法
    // 重新创建一个 LRU Cache 替换
    minAppsCache = createLRUCache()
    setOpenedKeepAliveMinapps([])
    setOpenedOneOffMinapp(null)
    setCurrentMinappId('')
    setMinappShow(false)
  }, [createLRUCache, setOpenedKeepAliveMinapps, setOpenedOneOffMinapp, setCurrentMinappId, setMinappShow])

  /** Hide the minapp popup (only one-off minapp unloaded) */
  const hideMinappPopup = useCallback(() => {
    if (!minappShow) return

    if (openedOneOffMinapp) {
      setOpenedOneOffMinapp(null)
      setCurrentMinappId('')
    }
    setMinappShow(false)
  }, [minappShow, openedOneOffMinapp, setOpenedOneOffMinapp, setCurrentMinappId, setMinappShow])

  /** Smart open minapp that adapts to navbar position */
  const openSmartMinapp = useCallback(
    (config: MiniAppInput, keepAlive: boolean = false) => {
      const app = toMiniApp(config)
      if (isTopNavbar && minAppsCache) {
        // For top navbar mode, need to add to cache first for temporary apps
        const cacheApp = minAppsCache.get(app.appId)
        if (!cacheApp) {
          // Add temporary app to cache so MinAppPage can find it
          minAppsCache.set(app.appId, app)
        }

        // Set current minapp and show state
        setCurrentMinappId(app.appId)
        setMinappShow(true)

        // Then navigate to the app tab using NavigationService
        if (NavigationService.navigate) {
          void NavigationService.navigate({ to: `/app/minapp/${app.appId}` })
        }
      } else {
        // For side navbar, use the traditional popup system
        openMinapp(app, keepAlive)
      }
    },
    [isTopNavbar, openMinapp, setCurrentMinappId, setMinappShow]
  )

  return {
    openMinapp,
    openMinappKeepAlive,
    openMinappById,
    closeMinapp,
    hideMinappPopup,
    closeAllMinapps,
    openSmartMinapp,
    // Expose cache instance for TabsService integration
    minAppsCache
  }
}
