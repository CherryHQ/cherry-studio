import { usePreference } from '@data/hooks/usePreference'
import type { SidebarAppId } from '@renderer/utils/sidebar'
import {
  getOrderedVisibleSidebarFavoriteItems,
  getOrderedVisibleSidebarFavorites,
  getSidebarMiniAppFavoriteIds,
  removeSidebarMiniApp,
  reorderSidebarApps,
  reorderSidebarFavorites,
  reorderSidebarMiniApps,
  setSidebarAppPinned,
  toggleSidebarMiniApp
} from '@renderer/utils/sidebar'
import type { SidebarFavoriteItem } from '@shared/data/preference/preferenceTypes'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Single entry point for the `ui.sidebar.favorites` preference.
 *
 * `favorites` is the full ordered mixed list (apps and mini apps interleaved) the
 * sidebar renders and drag-reorders as one zone; `reorderFavorites` persists a new
 * mixed order. The partitioned `appFavorites` / `miniAppFavoriteIds` and their
 * per-type mutations remain for surfaces (launchpad, mini app menu) that manage a
 * single type. Every mutation goes through the mix-preserving helpers in
 * `utils/sidebar`, so components never touch the raw `type` tags.
 */
export function useSidebarFavorites() {
  const { t } = useTranslation()
  const [favorites, setFavorites] = usePreference('ui.sidebar.favorites')

  const favoriteItems = useMemo(() => getOrderedVisibleSidebarFavoriteItems(favorites), [favorites])
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
  const reorderFavorites = useCallback(
    (orderedItems: readonly SidebarFavoriteItem[]) => persist(reorderSidebarFavorites(favorites, orderedItems)),
    [favorites, persist]
  )

  return {
    favorites: favoriteItems,
    appFavorites,
    miniAppFavoriteIds,
    setAppPinned,
    reorderApps,
    reorderFavorites,
    toggleMiniApp,
    removeMiniApp,
    reorderMiniApps
  }
}
