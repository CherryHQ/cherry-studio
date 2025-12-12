import { usePreference } from '@data/hooks/usePreference'
import { DEFAULT_MIN_APPS } from '@renderer/config/minapps'
import { useMinapps } from '@renderer/hooks/useMinapps'
import NavigationService from '@renderer/services/NavigationService'
import TabsService from '@renderer/services/TabsService'
import type { MinAppType } from '@renderer/types'
import { clearWebviewState } from '@renderer/utils/webviewStateManager'
import { LRUCache } from 'lru-cache'
import { useCallback } from 'react'

import { useNavbarPosition } from './useNavbar'

let minAppsCache: LRUCache<string, MinAppType>

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
 *     import { useRuntime } from '@renderer/hooks/useRuntime'
 *     const { openedKeepAliveMinapps, openedOneOffMinapp, minappShow } = useRuntime()
 */
export const useMinappPopup = () => {
  const {
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

  const createLRUCache = useCallback(() => {
    return new LRUCache<string, MinAppType>({
      max: maxKeepAliveMinapps ?? 10,
      disposeAfter: (_value, key) => {
        // Clean up WebView state when app is disposed from cache
        clearWebviewState(key)

        // Close corresponding tab if it exists
        const tabs = TabsService.getTabs()
        const tabToClose = tabs.find((tab) => tab.path === `/apps/${key}`)
        if (tabToClose) {
          TabsService.closeTab(tabToClose.id)
        }

        // Update Redux state
        setOpenedKeepAliveMinapps(Array.from(minAppsCache.values()))
      },
      onInsert: () => {
        setOpenedKeepAliveMinapps(Array.from(minAppsCache.values()))
      },
      updateAgeOnGet: true,
      updateAgeOnHas: true
    })
  }, [maxKeepAliveMinapps, setOpenedKeepAliveMinapps])

  // 缓存不存在
  if (!minAppsCache) {
    minAppsCache = createLRUCache()
  }

  // 缓存数量大小发生了改变
  if (minAppsCache.max !== maxKeepAliveMinapps) {
    // 1. 当前小程序数量小于等于设置的缓存数量，直接重新建立缓存
    if (minAppsCache.size <= maxKeepAliveMinapps) {
      // LRU cache 机制，后 set 的会被放到前面，所以需要反转一下
      const oldEntries = Array.from(minAppsCache.entries()).reverse()
      minAppsCache = createLRUCache()
      oldEntries.forEach(([key, value]) => {
        minAppsCache.set(key, value)
      })
    }
    // 2. 大于设置的缓存的话，就直到数量减少到设置的缓存数量
  }

  /** Open a minapp (popup shows and minapp loaded) */
  const openMinapp = useCallback(
    (app: MinAppType, keepAlive: boolean = false) => {
      if (keepAlive) {
        // 通过 get 和 set 去更新缓存，避免重复添加
        const cacheApp = minAppsCache.get(app.id)
        if (!cacheApp) minAppsCache.set(app.id, app)

        // 如果小程序已经打开，只切换显示
        if (openedKeepAliveMinapps.some((item) => item.id === app.id)) {
          setCurrentMinappId(app.id)
          setMinappShow(true)
          return
        }
        setOpenedOneOffMinapp(null)
        setCurrentMinappId(app.id)
        setMinappShow(true)
        return
      }

      //if the minapp is not keep alive, open it as one-off minapp
      setOpenedOneOffMinapp(app)
      setCurrentMinappId(app.id)
      setMinappShow(true)
      return
    },
    [openedKeepAliveMinapps, setOpenedOneOffMinapp, setCurrentMinappId, setMinappShow]
  )

  /** a wrapper of openMinapp(app, true) */
  const openMinappKeepAlive = useCallback(
    (app: MinAppType) => {
      openMinapp(app, true)
    },
    [openMinapp]
  )

  /** Open a minapp by id (look up the minapp in DEFAULT_MIN_APPS) */
  const openMinappById = useCallback(
    (id: string, keepAlive: boolean = false) => {
      const app = DEFAULT_MIN_APPS.find((app) => app?.id === id)
      if (app) {
        openMinapp(app, keepAlive)
      }
    },
    [openMinapp]
  )

  /** Close a minapp immediately (popup hides and minapp unloaded) */
  const closeMinapp = useCallback(
    (appid: string) => {
      if (openedKeepAliveMinapps.some((item) => item.id === appid)) {
        minAppsCache.delete(appid)
      } else if (openedOneOffMinapp?.id === appid) {
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
    (config: MinAppType, keepAlive: boolean = false) => {
      if (isTopNavbar) {
        // For top navbar mode, need to add to cache first for temporary apps
        const cacheApp = minAppsCache.get(config.id)
        if (!cacheApp) {
          // Add temporary app to cache so MinAppPage can find it
          minAppsCache.set(config.id, config)
        }

        // Set current minapp and show state
        setCurrentMinappId(config.id)
        setMinappShow(true)

        // Then navigate to the app tab using NavigationService
        if (NavigationService.navigate) {
          NavigationService.navigate({ to: `/apps/${config.id}` })
        }
      } else {
        // For side navbar, use the traditional popup system
        openMinapp(config, keepAlive)
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
