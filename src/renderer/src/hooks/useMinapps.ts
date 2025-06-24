import { DEFAULT_MIN_APPS } from '@renderer/config/minapps'
import { RootState, useAppDispatch, useAppSelector } from '@renderer/store'
import { setDisabledMinApps, setMinApps, setPinnedMinApps } from '@renderer/store/minapps'
import { MinAppType } from '@renderer/types'

export const useMinapps = () => {
  const { enabled, disabled, pinned } = useAppSelector((state: RootState) => state.minapps)
  const dispatch = useAppDispatch()

  // Filter out apps that no longer exist in DEFAULT_MIN_APPS
  const filterExistingApps = (apps: MinAppType[]) => {
    return apps
      .map((app) => DEFAULT_MIN_APPS.find((item) => item.id === app.id))
      .filter((app): app is MinAppType => app !== undefined)
  }

  return {
    minapps: filterExistingApps(enabled),
    disabled: filterExistingApps(disabled),
    pinned: filterExistingApps(pinned),
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
