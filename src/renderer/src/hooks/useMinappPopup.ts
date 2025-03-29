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
  const openMinapp = (app: MinAppType, keepAlive: boolean = false) => {
    if (keepAlive) {
      // 如果小程序已经打开，只切换显示
      if (openedKeepAliveMinapps.some((item) => item.id === app.id)) {
        dispatch(setCurrentMinappId(app.id))
        dispatch(setMinappShow(true))
        return
      }

      // 如果缓存数量未达上限，添加到缓存列表
      if (openedKeepAliveMinapps.length < maxKeepAliveMinapps) {
        dispatch(setOpenedKeepAliveMinapps([app, ...openedKeepAliveMinapps]))
      } else {
        // 缓存数量达到上限，移除最后一个，添加新的
        dispatch(setOpenedKeepAliveMinapps([app, ...openedKeepAliveMinapps.slice(0, maxKeepAliveMinapps - 1)]))
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
  }

  /** a wrapper of openMinapp(app, true) */
  const openMinappKeepAlive = (app: MinAppType) => {
    openMinapp(app, true)
  }

  /** Open a minapp by id (look up the minapp in DEFAULT_MIN_APPS) */
  const openMinappById = (id: string, keepAlive: boolean = false) => {
    import('@renderer/config/minapps').then(({ DEFAULT_MIN_APPS }) => {
      const app = DEFAULT_MIN_APPS.find((app) => app?.id === id)
      if (app) {
        openMinapp(app, keepAlive)
      }
    })
  }

  /** Close a minapp immediately (popup hides and minapp unloaded) */
  const closeMinapp = (appid: string) => {
    if (openedKeepAliveMinapps.some((item) => item.id === appid)) {
      dispatch(setOpenedKeepAliveMinapps(openedKeepAliveMinapps.filter((item) => item.id !== appid)))
    } else if (openedOneOffMinapp?.id === appid) {
      dispatch(setOpenedOneOffMinapp(null))
    }

    dispatch(setCurrentMinappId(''))
    dispatch(setMinappShow(false))
    return
  }

  /** Close all minapps (popup hides and all minapps unloaded) */
  const closeAllMinapps = () => {
    dispatch(setOpenedKeepAliveMinapps([]))
    dispatch(setOpenedOneOffMinapp(null))
    dispatch(setCurrentMinappId(''))
    dispatch(setMinappShow(false))
  }

  /** Hide the minapp popup (only one-off minapp unloaded) */
  const hideMinappPopup = () => {
    if (!minappShow) return

    if (openedOneOffMinapp) {
      dispatch(setOpenedOneOffMinapp(null))
      dispatch(setCurrentMinappId(''))
    }
    dispatch(setMinappShow(false))
  }

  return {
    openMinapp,
    openMinappKeepAlive,
    openMinappById,
    closeMinapp,
    hideMinappPopup,
    closeAllMinapps
  }
}
