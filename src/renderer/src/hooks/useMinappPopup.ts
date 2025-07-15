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
import { useCallback } from 'react'

const updateLRUCache = <T extends { id: string }>(apps: T[], app: T, limitation: number): T[] => {
  const existingIndex = apps.findIndex((item) => item.id === app.id)

  if (existingIndex !== -1) {
    // 找到已存在的 app，将其移动到最前面
    const updatedApps = [...apps]
    updatedApps.splice(existingIndex, 1)
    updatedApps.unshift(app)
    return updatedApps
  }

  const updatedApps = [app, ...apps]

  if (updatedApps.length > limitation) {
    return updatedApps.slice(0, limitation)
  }

  return updatedApps
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
 *     import { useRuntime } from '@renderer/hooks/useRuntime'
 *     const { openedKeepAliveMinapps, openedOneOffMinapp, minappShow } = useRuntime()
 */
export const useMinappPopup = () => {
  const dispatch = useAppDispatch()
  const { openedKeepAliveMinapps, openedOneOffMinapp, minappShow } = useRuntime()
  const { maxKeepAliveMinapps } = useSettings() // 使用设置中的值

  /** Open a minapp (popup shows and minapp loaded) */
  const openMinapp = useCallback(
    (app: MinAppType, keepAlive: boolean = false) => {
      if (keepAlive) {
        const updatedApps = updateLRUCache(openedKeepAliveMinapps, app, maxKeepAliveMinapps)
        dispatch(setOpenedKeepAliveMinapps(updatedApps))
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
    [dispatch, maxKeepAliveMinapps, openedKeepAliveMinapps]
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
        dispatch(setOpenedKeepAliveMinapps(openedKeepAliveMinapps.filter((item) => item.id !== appid)))
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
    dispatch(setOpenedKeepAliveMinapps([]))
    dispatch(setOpenedOneOffMinapp(null))
    dispatch(setCurrentMinappId(''))
    dispatch(setMinappShow(false))
  }, [dispatch])

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
