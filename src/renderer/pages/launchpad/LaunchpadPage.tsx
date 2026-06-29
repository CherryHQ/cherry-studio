import { Sortable } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { SIDEBAR_ICON_COMPONENTS } from '@renderer/components/app/sidebarIcons'
import { CommandContextMenu, type CommandContextMenuExtraItem } from '@renderer/components/command'
import App from '@renderer/components/MiniApp/MiniApp'
import Scrollbar from '@renderer/components/Scrollbar'
import { useMiniApps } from '@renderer/hooks/useMiniApps'
import { getSidebarIconLabelKey } from '@renderer/i18n/label'
import {
  createSidebarAppFavorite,
  getOrderedVisibleSidebarFavorites,
  getSidebarFavoriteIds,
  getSidebarMenuPath,
  getSidebarMiniAppFavoriteIds,
  REQUIRED_SIDEBAR_FAVORITES,
  SIDEBAR_FAVORITE_ORDER
} from '@renderer/utils/sidebar'
import type { SidebarFavorite } from '@shared/data/preference/preferenceTypes'
import type { MiniApp as MiniAppType } from '@shared/data/types/miniApp'
import { useNavigate } from '@tanstack/react-router'
import { useCallback, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'

const BASE_URL = 'https://www.cherry-ai.com/'

const REQUIRED_SIDEBAR_FAVORITE_SET = new Set<SidebarFavorite>(REQUIRED_SIDEBAR_FAVORITES)
const LAUNCHPAD_GRID_CLASS =
  'grid grid-cols-[repeat(auto-fill,92px)] justify-start justify-items-center gap-x-14 gap-y-8 px-2'
const LAUNCHPAD_ITEM_CLASS = 'w-[92px]'
const SORTABLE_CONTENTS_STYLE = { display: 'contents' } as const

const APP_ICON_BACKGROUNDS: Record<SidebarFavorite, string> = {
  assistants: 'linear-gradient(135deg, #111827, #4B5563)',
  agents: 'linear-gradient(135deg, #2563EB, #38BDF8)',
  store: 'linear-gradient(135deg, #0EA5E9, #6366F1)',
  paintings: 'linear-gradient(135deg, #EC4899, #F472B6)',
  translate: 'linear-gradient(135deg, #06B6D4, #0EA5E9)',
  mini_app: 'linear-gradient(135deg, #8B5CF6, #A855F7)',
  knowledge: 'linear-gradient(135deg, #10B981, #34D399)',
  files: 'linear-gradient(135deg, #F59E0B, #FBBF24)',
  code_tools: 'linear-gradient(135deg, #1F2937, #374151)',
  notes: 'linear-gradient(135deg, #F97316, #FB923C)',
  openclaw: 'linear-gradient(135deg, #EF4444, #B91C1C)'
}

function insertSidebarFavoriteByCanonicalOrder(favorites: SidebarFavorite[], favorite: SidebarFavorite) {
  const favoriteOrder = SIDEBAR_FAVORITE_ORDER.indexOf(favorite)
  const insertIndex = favorites.findIndex((existing) => SIDEBAR_FAVORITE_ORDER.indexOf(existing) > favoriteOrder)
  favorites.splice(insertIndex === -1 ? favorites.length : insertIndex, 0, favorite)
}

function getSidebarFavoritesWithPinnedState({
  favorites,
  favorite,
  pinned
}: {
  favorites: readonly string[] | undefined
  favorite: SidebarFavorite
  pinned: boolean
}): string[] {
  const items = getSidebarFavoriteIds(favorites)
  const nextFavorites = items
    .filter((item): item is SidebarFavorite => SIDEBAR_FAVORITE_ORDER.includes(item as SidebarFavorite))
    .filter((existing) => existing !== favorite)
  const miniAppFavorites = getSidebarMiniAppFavoriteIds(items)

  for (const requiredFavorite of REQUIRED_SIDEBAR_FAVORITES) {
    if (!nextFavorites.includes(requiredFavorite)) {
      insertSidebarFavoriteByCanonicalOrder(nextFavorites, requiredFavorite)
    }
  }

  if (pinned && !nextFavorites.includes(favorite)) {
    nextFavorites.push(favorite)
  }

  return [...nextFavorites.map(createSidebarAppFavorite), ...miniAppFavorites]
}

function reorderByIndex<T>(items: readonly T[], oldIndex: number, newIndex: number): T[] {
  if (oldIndex === newIndex) return [...items]

  const nextItems = [...items]
  const [movedItem] = nextItems.splice(oldIndex, 1)
  if (movedItem === undefined) return [...items]

  nextItems.splice(newIndex, 0, movedItem)
  return nextItems
}

export default function LaunchpadPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [defaultPaintingProvider] = usePreference('feature.paintings.default_provider')
  const { pinned, openedKeepAliveMiniApps, reorderMiniAppsByStatus } = useMiniApps()
  const [sidebarFavorites, setSidebarFavorites] = usePreference('ui.sidebar.favorites')
  const suppressClickUntilRef = useRef(0)
  const draggedItemIdRef = useRef<string | null>(null)

  const orderedVisibleSidebarFavorites = useMemo(
    () => getOrderedVisibleSidebarFavorites(sidebarFavorites),
    [sidebarFavorites]
  )
  const visibleSidebarFavoriteSet = useMemo(
    () => new Set(orderedVisibleSidebarFavorites),
    [orderedVisibleSidebarFavorites]
  )

  const handleSortableDragStart = useCallback((event: { active: { id: string | number } }) => {
    draggedItemIdRef.current = String(event.active.id)
    suppressClickUntilRef.current = Date.now() + 500
  }, [])

  // The pointer sensor fires a synthetic click on the dragged element after drop;
  // refresh the window on settle so the click is still suppressed after long drags.
  const handleSortableDragSettled = useCallback(() => {
    suppressClickUntilRef.current = Date.now() + 500
  }, [])

  // Only swallow the post-drag click on the item that was actually dragged.
  const shouldSuppressLaunchClick = useCallback(
    (id: string) => id === draggedItemIdRef.current && Date.now() < suppressClickUntilRef.current,
    []
  )

  const navigateToUrl = useCallback(
    (url: string) => {
      const parsedUrl = new URL(url, BASE_URL)
      if (parsedUrl.search) {
        return navigate({
          to: parsedUrl.pathname,
          search: Object.fromEntries(parsedUrl.searchParams.entries())
        })
      }

      return navigate({ to: parsedUrl.pathname })
    },
    [navigate]
  )

  const openLaunchpadItem = (favorite: SidebarFavorite) => {
    if (shouldSuppressLaunchClick(favorite)) return

    // Launchpad opens each app at its base entry (chat -> new conversation,
    // agents -> new session). Resuming the last-used instance is the sidebar's
    // job, not the launcher's.
    const path = getSidebarMenuPath(favorite, defaultPaintingProvider)
    if (!path) return
    void navigateToUrl(path)
  }

  const openMiniApp = (app: MiniAppType) => {
    if (shouldSuppressLaunchClick(app.appId)) return

    void navigateToUrl(`/app/mini-app/${app.appId}`)
  }

  const saveSidebarFavoritePinnedState = useCallback(
    (favorite: SidebarFavorite, pinned: boolean) => {
      void setSidebarFavorites(
        getSidebarFavoritesWithPinnedState({
          favorites: sidebarFavorites,
          favorite,
          pinned
        })
      ).catch(() => {
        window.toast?.error(t('common.error'))
      })
    },
    [setSidebarFavorites, sidebarFavorites, t]
  )

  const pinToSidebar = useCallback(
    (favorite: SidebarFavorite) => {
      if (visibleSidebarFavoriteSet.has(favorite)) return
      saveSidebarFavoritePinnedState(favorite, true)
    },
    [saveSidebarFavoritePinnedState, visibleSidebarFavoriteSet]
  )

  const unpinFromSidebar = useCallback(
    (favorite: SidebarFavorite) => {
      if (!visibleSidebarFavoriteSet.has(favorite) || REQUIRED_SIDEBAR_FAVORITE_SET.has(favorite)) return
      saveSidebarFavoritePinnedState(favorite, false)
    },
    [saveSidebarFavoritePinnedState, visibleSidebarFavoriteSet]
  )

  const getAppContextMenuItems = useCallback(
    (favorite: SidebarFavorite): CommandContextMenuExtraItem[] => {
      const isPinned = visibleSidebarFavoriteSet.has(favorite)

      return [
        {
          type: 'item',
          id: `launchpad.${isPinned ? 'unpin-from-sidebar' : 'pin-to-sidebar'}.${favorite}`,
          label: t(isPinned ? 'launchpad.unpin_from_sidebar' : 'launchpad.pin_to_sidebar'),
          enabled: !isPinned || !REQUIRED_SIDEBAR_FAVORITE_SET.has(favorite),
          onSelect: () => (isPinned ? unpinFromSidebar(favorite) : pinToSidebar(favorite))
        }
      ]
    },
    [pinToSidebar, t, unpinFromSidebar, visibleSidebarFavoriteSet]
  )

  const appMenuItems = useMemo(() => {
    const orderedVisibleFavoriteSet = new Set(orderedVisibleSidebarFavorites)
    const orderedFavorites = [
      ...orderedVisibleSidebarFavorites,
      ...SIDEBAR_FAVORITE_ORDER.filter((favorite) => !orderedVisibleFavoriteSet.has(favorite))
    ]

    return orderedFavorites.flatMap((favorite) => {
      const Icon = SIDEBAR_ICON_COMPONENTS[favorite]
      if (!Icon || !getSidebarMenuPath(favorite, defaultPaintingProvider)) return []

      return [
        {
          id: favorite,
          icon: <Icon size={32} />,
          text: t(getSidebarIconLabelKey(favorite)),
          bgColor: APP_ICON_BACKGROUNDS[favorite],
          menuItems: getAppContextMenuItems(favorite)
        }
      ]
    })
  }, [defaultPaintingProvider, getAppContextMenuItems, orderedVisibleSidebarFavorites, t])

  const pinnedAppMenuItems = useMemo(
    () => appMenuItems.filter((item) => visibleSidebarFavoriteSet.has(item.id)),
    [appMenuItems, visibleSidebarFavoriteSet]
  )
  const unpinnedAppMenuItems = useMemo(
    () => appMenuItems.filter((item) => !visibleSidebarFavoriteSet.has(item.id)),
    [appMenuItems, visibleSidebarFavoriteSet]
  )

  const openedOnlyMiniApps = useMemo(
    () => openedKeepAliveMiniApps.filter((app) => !pinned.some((pinnedApp) => pinnedApp.appId === app.appId)),
    [openedKeepAliveMiniApps, pinned]
  )

  const launchpadMiniAppsVisible = pinned.length + openedOnlyMiniApps.length > 0

  const handleSidebarAppsSortEnd = useCallback(
    ({ oldIndex, newIndex }: { oldIndex: number; newIndex: number }) => {
      const nextItems = reorderByIndex(pinnedAppMenuItems, oldIndex, newIndex)
      const miniAppFavorites = getSidebarMiniAppFavoriteIds(sidebarFavorites)

      void setSidebarFavorites([
        ...nextItems.map((item) => createSidebarAppFavorite(item.id)),
        ...miniAppFavorites
      ]).catch(() => {
        window.toast?.error(t('common.error'))
      })
    },
    [pinnedAppMenuItems, setSidebarFavorites, sidebarFavorites, t]
  )

  const handleSidebarMiniAppsSortEnd = useCallback(
    ({ oldIndex, newIndex }: { oldIndex: number; newIndex: number }) => {
      const nextItems = reorderByIndex(pinned, oldIndex, newIndex)

      void reorderMiniAppsByStatus('pinned', nextItems).catch(() => window.toast?.error(t('miniApp.reorder_failed')))
    },
    [pinned, reorderMiniAppsByStatus, t]
  )

  const renderAppMenuItem = (item: (typeof appMenuItems)[number]) => (
    <CommandContextMenu key={item.id} location="webcontents.context" extraItems={item.menuItems}>
      <button
        type="button"
        onClick={() => openLaunchpadItem(item.id)}
        className={`${LAUNCHPAD_ITEM_CLASS} group flex cursor-pointer flex-col items-center gap-1 rounded-2xl px-1 py-2 text-center outline-none transition-transform duration-200 hover:scale-105 focus-visible:scale-105 active:scale-95`}>
        <span className="relative flex size-14 items-center justify-center">
          <span
            className="flex size-14 items-center justify-center rounded-2xl text-white shadow-sm [&_svg]:size-7 [&_svg]:text-white"
            style={{ background: item.bgColor }}>
            {item.icon}
          </span>
        </span>
        <span className="w-full overflow-hidden text-ellipsis whitespace-nowrap text-[12px] text-foreground">
          {item.text}
        </span>
      </button>
    </CommandContextMenu>
  )

  const renderMiniAppItem = (app: MiniAppType) => (
    <div
      className={`${LAUNCHPAD_ITEM_CLASS} flex justify-center rounded-[8px] px-0 py-2 transition-transform duration-200 hover:scale-105 active:scale-95`}>
      <App app={app} size={56} variant="launchpad" onOpen={openMiniApp} />
    </div>
  )

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <Scrollbar className="min-h-0 flex-1">
        <div className="mx-auto flex w-full max-w-[920px] flex-col gap-8 px-8 py-12.5">
          <section className="flex flex-col gap-2">
            <h2 className="m-0 px-2 py-0 font-semibold text-[14px] text-foreground opacity-80">
              {t('launchpad.apps')}
            </h2>
            <div className={LAUNCHPAD_GRID_CLASS}>
              <Sortable
                items={pinnedAppMenuItems}
                itemKey="id"
                layout="grid"
                listStyle={SORTABLE_CONTENTS_STYLE}
                onDragStart={handleSortableDragStart}
                onDragEnd={handleSortableDragSettled}
                onDragCancel={handleSortableDragSettled}
                onSortEnd={handleSidebarAppsSortEnd}
                renderItem={(item) => renderAppMenuItem(item)}
              />
              {unpinnedAppMenuItems.map(renderAppMenuItem)}
            </div>
          </section>

          {launchpadMiniAppsVisible && (
            <section className="flex flex-col gap-2">
              <h2 className="m-0 px-2 py-0 font-semibold text-[14px] text-foreground opacity-80">
                {t('launchpad.miniApps')}
              </h2>
              <div className={LAUNCHPAD_GRID_CLASS}>
                <Sortable
                  items={pinned}
                  itemKey="appId"
                  layout="grid"
                  listStyle={SORTABLE_CONTENTS_STYLE}
                  onDragStart={handleSortableDragStart}
                  onDragEnd={handleSortableDragSettled}
                  onDragCancel={handleSortableDragSettled}
                  onSortEnd={handleSidebarMiniAppsSortEnd}
                  renderItem={(app) => renderMiniAppItem(app)}
                />
                {openedOnlyMiniApps.map((app) => (
                  <div key={app.appId} className="contents">
                    {renderMiniAppItem(app)}
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      </Scrollbar>
    </div>
  )
}
