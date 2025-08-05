import { DEFAULT_MIN_APPS } from '@renderer/config/minapps'
import { useRuntime } from '@renderer/hooks/useRuntime'
import { useSettings } from '@renderer/hooks/useSettings' // 使用设置中的值
import { useAppDispatch } from '@renderer/store'
import {
  setCurrentMinappId,
  setMinappShow,
  setOpenedKeepAliveMinapps,
  setOpenedOneOffMinapp
} from '@renderer/store/runtime'
import { MinAppType } from '@renderer/types'
import { LRUCache } from 'lru-cache'
import { useCallback } from 'react'

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
  const dispatch = useAppDispatch()
  const { openedKeepAliveMinapps, openedOneOffMinapp, minappShow } = useRuntime()
  const { maxKeepAliveMinapps } = useSettings() // 使用设置中的值

  const createLRUCache = useCallback(() => {
    return new LRUCache<string, MinAppType>({
      max: maxKeepAliveMinapps,
      disposeAfter: () => {
        dispatch(setOpenedKeepAliveMinapps(Array.from(minAppsCache.values())))
      },
      onInsert: () => {
        dispatch(setOpenedKeepAliveMinapps(Array.from(minAppsCache.values())))
      },
      updateAgeOnGet: true,
      updateAgeOnHas: true
    })
  }, [dispatch, maxKeepAliveMinapps])

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
          dispatch(setCurrentMinappId(app.id))
          dispatch(setMinappShow(true))
          return
        }
        dispatch(setOpenedOneOffMinapp(null))
        dispatch(setCurrentMinappId(app.id))
        dispatch(setMinappShow(true))
        return
      }

      //if the minapp is not keep alive, open it as one-off minapp
      dispatch(setOpenedOneOffMinapp(app))
      dispatch(setCurrentMinappId(app.id))
      dispatch(setMinappShow(true))
      return
    },
    [dispatch, openedKeepAliveMinapps]
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
        dispatch(setOpenedOneOffMinapp(null))
      }

      dispatch(setCurrentMinappId(''))
      dispatch(setMinappShow(false))
      return
    },
    [dispatch, openedKeepAliveMinapps, openedOneOffMinapp]
  )

  /** Close all minapps (popup hides and all minapps unloaded) */
  const closeAllMinapps = useCallback(() => {
    // minAppsCache.clear 会多次调用 dispose 方法
    // 重新创建一个 LRU Cache 替换
    minAppsCache = createLRUCache()
    dispatch(setOpenedKeepAliveMinapps([]))
    dispatch(setOpenedOneOffMinapp(null))
    dispatch(setCurrentMinappId(''))
    dispatch(setMinappShow(false))
  }, [dispatch, createLRUCache])

  /** Hide the minapp popup (only one-off minapp unloaded) */
  const hideMinappPopup = useCallback(() => {
    if (!minappShow) return

    if (openedOneOffMinapp) {
      dispatch(setOpenedOneOffMinapp(null))
      dispatch(setCurrentMinappId(''))
    }
    dispatch(setMinappShow(false))
  }, [dispatch, minappShow, openedOneOffMinapp])

  return {
    openMinapp,
    openMinappKeepAlive,
    openMinappById,
    closeMinapp,
    hideMinappPopup,
    closeAllMinapps
  }
}
