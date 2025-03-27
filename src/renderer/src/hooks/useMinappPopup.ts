import { useRuntime } from '@renderer/hooks/useRuntime'
import { useAppDispatch } from '@renderer/store'
import {
  setCurrentMinappId,
  setMinappShow,
  setOpenedKeepAliveMinapps,
  setOpenedOneOffMinapp
} from '@renderer/store/runtime'
import { MinAppType } from '@renderer/types'

/** The max number of keep alive minapps */
const MINAPP_MAX_KEEPALIVE = 3

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
  const { openedKeepAliveMinapps, openedOneOffMinapp, minappShow } = useRuntime()
  const dispatch = useAppDispatch()

  /** Open a minapp (popup shows and minapp loaded) */
  const openMinapp = (app: MinAppType, keepAlive: boolean = false) => {
    if (keepAlive) {
      //if the minapp is already opened, do nothing
      if (openedKeepAliveMinapps.some((item) => item.id === app.id)) {
        dispatch(setCurrentMinappId(app.id))
        dispatch(setMinappShow(true))
        return
      }

      //if the minapp is not opened, open it
      //check if the keep alive minapps meet the max limit
      if (openedKeepAliveMinapps.length < MINAPP_MAX_KEEPALIVE) {
        //always put new minapp at the first
        dispatch(setOpenedKeepAliveMinapps([app, ...openedKeepAliveMinapps]))
      } else {
        //pop the last one
        dispatch(setOpenedKeepAliveMinapps([app, ...openedKeepAliveMinapps.slice(0, MINAPP_MAX_KEEPALIVE - 1)]))
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
