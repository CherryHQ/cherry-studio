import { DEFAULT_MIN_APPS } from '@renderer/config/minapps'
import { getLanguage } from '@renderer/i18n'
import type { RootState } from '@renderer/store'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import { setDisabledMinApps, setMinApps, setPinnedMinApps } from '@renderer/store/minapps'
import type { MinAppType } from '@renderer/types'

// Filter apps by locale - if app has locales defined, only show if current language matches
const filterByLocale = (apps: MinAppType[]): MinAppType[] => {
  const currentLanguage = getLanguage()
  return apps.filter((app) => {
    if (!app.locales) return true // No locale restriction, show to all
    return app.locales.includes(currentLanguage)
  })
}

export const useMinapps = () => {
  const { enabled, disabled, pinned } = useAppSelector((state: RootState) => state.minapps)
  const dispatch = useAppDispatch()

  const mapApps = (apps: MinAppType[]) => apps.map((app) => DEFAULT_MIN_APPS.find((item) => item.id === app.id) || app)

  return {
    minapps: filterByLocale(mapApps(enabled)),
    disabled: filterByLocale(mapApps(disabled)),
    pinned: filterByLocale(mapApps(pinned)),
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
