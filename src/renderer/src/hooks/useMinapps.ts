import { DEFAULT_MIN_APPS } from '@renderer/config/minapps'
import { RootState, useAppDispatch, useAppSelector } from '@renderer/store'
import { setDisabledMinApps, setMinApps, setPinnedMinApps, setRecentlyUse } from '@renderer/store/minapps'
import { MinAppType, RecentlyUseMinAppType } from '@renderer/types'

export const useMinapps = () => {
  const { enabled, disabled, pinned, recentlyUse = [] } = useAppSelector((state: RootState) => state.minapps)
  const dispatch = useAppDispatch()

  return {
    minapps: enabled.map((app) => DEFAULT_MIN_APPS.find((item) => item.id === app.id) || app),
    disabled: disabled.map((app) => DEFAULT_MIN_APPS.find((item) => item.id === app.id) || app),
    pinned: pinned.map((app) => DEFAULT_MIN_APPS.find((item) => item.id === app.id) || app),
    recentlyUse: recentlyUse.map(
      (app) => DEFAULT_MIN_APPS.find((item) => item.id === app.id) || app
    ) as unknown as RecentlyUseMinAppType[],
    updateMinapps: (minapps: MinAppType[]) => {
      dispatch(setMinApps(minapps))
    },
    updateDisabledMinapps: (minapps: MinAppType[]) => {
      dispatch(setDisabledMinApps(minapps))
    },
    updatePinnedMinapps: (minapps: MinAppType[]) => {
      dispatch(setPinnedMinApps(minapps))
    },
    updateRecentlyUseMinapps: (minapps: RecentlyUseMinAppType[]) => {
      dispatch(setRecentlyUse(minapps))
    }
  }
}
