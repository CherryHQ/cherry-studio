import { usePreference } from '@data/hooks/usePreference'
import type { SidebarAppId } from '@renderer/utils/sidebar'
import {
  getOrderedVisibleSidebarFavorites,
  getSidebarMiniAppFavoriteIds,
  removeSidebarMiniApp,
  reorderSidebarApps,
  reorderSidebarMiniApps,
  setSidebarAppPinned,
  toggleSidebarMiniApp
} from '@renderer/utils/sidebar'
import type { SidebarFavoriteItem } from '@shared/data/preference/preferenceTypes'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Single entry point for the `ui.sidebar.favorites` preference. Exposes the two
 * zones (built-in apps + mini apps) already partitioned, and mutation callbacks
 * that keep the untouched zone intact via the pure helpers in `utils/sidebar`.
 * Components never touch the raw discriminated-union array or its `type` tags.
 */
export function useSidebarFavorites() {
  const { t } = useTranslation()
  const [favorites, setFavorites] = usePreference('ui.sidebar.favorites')

  const appFavorites = useMemo(() => getOrderedVisibleSidebarFavorites(favorites), [favorites])
  const miniAppFavoriteIds = useMemo(() => getSidebarMiniAppFavoriteIds(favorites), [favorites])

  const persist = useCallback(
    (next: SidebarFavoriteItem[]) => {
      void setFavorites(next).catch(() => {
        window.toast?.error(t('common.error'))
      })
    },
    [setFavorites, t]
  )

  const setAppPinned = useCallback(
    (id: SidebarAppId, pinned: boolean) => persist(setSidebarAppPinned(favorites, id, pinned)),
    [favorites, persist]
  )
  const reorderApps = useCallback(
    (orderedAppIds: readonly string[]) => persist(reorderSidebarApps(favorites, orderedAppIds)),
    [favorites, persist]
  )
  const toggleMiniApp = useCallback((id: string) => persist(toggleSidebarMiniApp(favorites, id)), [favorites, persist])
  const removeMiniApp = useCallback((id: string) => persist(removeSidebarMiniApp(favorites, id)), [favorites, persist])
  const reorderMiniApps = useCallback(
    (orderedIds: readonly string[]) => persist(reorderSidebarMiniApps(favorites, orderedIds)),
    [favorites, persist]
  )

  return { appFavorites, miniAppFavoriteIds, setAppPinned, reorderApps, toggleMiniApp, removeMiniApp, reorderMiniApps }
}
