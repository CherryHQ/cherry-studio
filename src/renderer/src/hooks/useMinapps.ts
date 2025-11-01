import { useCache } from '@data/hooks/useCache'
import { DEFAULT_MIN_APPS } from '@renderer/config/minapps'
import type { RootState } from '@renderer/store'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import { setDisabledMinApps, setMinApps, setPinnedMinApps } from '@renderer/store/minapps'
import type { MinAppType } from '@renderer/types'

export const useMinapps = () => {
  const { enabled, disabled, pinned } = useAppSelector((state: RootState) => state.minapps)
  const dispatch = useAppDispatch()

  const [openedKeepAliveMinapps, setOpenedKeepAliveMinapps] = useCache('minapp.opened_keep_alive')
  const [currentMinappId, setCurrentMinappId] = useCache('minapp.current_id')
  const [minappShow, setMinappShow] = useCache('minapp.show')
  const [openedOneOffMinapp, setOpenedOneOffMinapp] = useCache('minapp.opened_oneoff')

  return {
    minapps: enabled.map((app) => DEFAULT_MIN_APPS.find((item) => item.id === app.id) || app),
    disabled: disabled.map((app) => DEFAULT_MIN_APPS.find((item) => item.id === app.id) || app),
    pinned: pinned.map((app) => DEFAULT_MIN_APPS.find((item) => item.id === app.id) || app),
    openedKeepAliveMinapps,
    currentMinappId,
    minappShow,
    openedOneOffMinapp,
    setOpenedKeepAliveMinapps,
    setCurrentMinappId,
    setMinappShow,
    setOpenedOneOffMinapp,
    updateMinapps: (minapps: MinAppType[]) => {
      dispatch(setMinApps(minapps))
    },
    updateDisabledMinapps: (minapps: MinAppType[]) => {
      dispatch(setDisabledMinApps(minapps))
    },
    updatePinnedMinapps: (minapps: MinAppType[]) => {
      dispatch(setPinnedMinApps(minapps))
    }
  }
}
