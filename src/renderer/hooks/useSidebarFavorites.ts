import { usePreference } from '@data/hooks/usePreference'
import type { SidebarAppId } from '@renderer/utils/sidebar'
import {
  getOrderedVisibleSidebarFavoriteItems,
  getOrderedVisibleSidebarFavorites,
  getSidebarMiniAppFavoriteIds,
  removeSidebarMiniApp,
  reorderSidebarFavorites,
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
 * mixed order. The partitioned `appFavorites` / `miniAppFavoriteIds` remain for
 * surfaces (launchpad, mini app menu) that need to know a single type's membership
 * (e.g. pin state), and `setAppPinned` / `toggleMiniApp` / `removeMiniApp` mutate
 * membership. The launchpad owns its own tile ordering elsewhere (built-in apps via
 * `ui.launchpad.app_order`, mini apps via `orderKey`), so favorites carries the
 * sidebar order only. Every mutation goes through the mix-preserving helpers in
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
  const toggleMiniApp = useCallback((id: string) => persist(toggleSidebarMiniApp(favorites, id)), [favorites, persist])
  const removeMiniApp = useCallback((id: string) => persist(removeSidebarMiniApp(favorites, id)), [favorites, persist])
  const reorderFavorites = useCallback(
    (orderedItems: readonly SidebarFavoriteItem[]) => persist(reorderSidebarFavorites(favorites, orderedItems)),
    [favorites, persist]
  )

  return {
    favorites: favoriteItems,
    appFavorites,
    miniAppFavoriteIds,
    setAppPinned,
    reorderFavorites,
    toggleMiniApp,
    removeMiniApp
  }
}
