import { Sortable } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { arrayMove } from '@dnd-kit/sortable'
import { SIDEBAR_ICON_COMPONENTS } from '@renderer/components/app/sidebarIcons'
import { CommandContextMenu, type CommandContextMenuExtraItem } from '@renderer/components/command'
import App from '@renderer/components/MiniApp/MiniApp'
import Scrollbar from '@renderer/components/Scrollbar'
import { useLaunchpadAppOrder } from '@renderer/hooks/useLaunchpadAppOrder'
import { useMiniApps } from '@renderer/hooks/useMiniApps'
import { useSidebarFavorites } from '@renderer/hooks/useSidebarFavorites'
import { getSidebarIconLabelKey } from '@renderer/i18n/label'
import type { SidebarAppId } from '@renderer/utils/sidebar'
import { getSidebarMenuPath, REQUIRED_SIDEBAR_FAVORITES } from '@renderer/utils/sidebar'
import type { MiniApp as MiniAppType } from '@shared/data/types/miniApp'
import { useNavigate } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

const BASE_URL = 'https://www.cherry-ai.com/'

const REQUIRED_SIDEBAR_FAVORITE_SET = new Set<SidebarAppId>(REQUIRED_SIDEBAR_FAVORITES)
const LAUNCHPAD_GRID_CLASS = 'grid grid-cols-6 justify-items-center gap-2 px-2'
const LAUNCHPAD_ITEM_CLASS = 'mx-auto w-[92px]'
const SORTABLE_CONTENTS_STYLE = { display: 'contents' } as const

const APP_ICON_BACKGROUNDS: Record<SidebarAppId, string> = {
  assistants: 'linear-gradient(135deg, #111827, #4B5563)',
  agents: 'linear-gradient(135deg, #2563EB, #38BDF8)',
  paintings: 'linear-gradient(135deg, #EC4899, #F472B6)',
  translate: 'linear-gradient(135deg, #06B6D4, #0EA5E9)',
  mini_app: 'linear-gradient(135deg, #8B5CF6, #A855F7)',
  knowledge: 'linear-gradient(135deg, #10B981, #34D399)',
  files: 'linear-gradient(135deg, #F59E0B, #FBBF24)',
  code_tools: 'linear-gradient(135deg, #1F2937, #374151)',
  notes: 'linear-gradient(135deg, #F97316, #FB923C)',
  openclaw: 'linear-gradient(135deg, #EF4444, #B91C1C)'
}

export default function LaunchpadPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [defaultPaintingProvider] = usePreference('feature.paintings.default_provider')
  const { pinned, reorderMiniAppsByStatus } = useMiniApps()
  const { appFavorites, setAppPinned } = useSidebarFavorites()
  const { orderedAppIds, reorderApps } = useLaunchpadAppOrder()
  const suppressClickUntilRef = useRef(0)
  const draggedItemIdRef = useRef<string | null>(null)

  const visibleSidebarFavoriteSet = useMemo(() => new Set(appFavorites), [appFavorites])

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

  const openLaunchpadItem = (favorite: SidebarAppId) => {
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

  const pinToSidebar = useCallback(
    (favorite: SidebarAppId) => {
      if (visibleSidebarFavoriteSet.has(favorite)) return
      setAppPinned(favorite, true)
    },
    [setAppPinned, visibleSidebarFavoriteSet]
  )

  const unpinFromSidebar = useCallback(
    (favorite: SidebarAppId) => {
      if (!visibleSidebarFavoriteSet.has(favorite) || REQUIRED_SIDEBAR_FAVORITE_SET.has(favorite)) return
      setAppPinned(favorite, false)
    },
    [setAppPinned, visibleSidebarFavoriteSet]
  )

  const getAppContextMenuItems = useCallback(
    (favorite: SidebarAppId): CommandContextMenuExtraItem[] => {
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

  // Built-in app tiles are ordered by the launchpad's own preference
  // (`ui.launchpad.app_order`), independent of the sidebar favorites order.
  // Every renderable app is drag-sortable in one grid.
  const appMenuItems = useMemo(
    () =>
      orderedAppIds.flatMap((favorite) => {
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
      }),
    [defaultPaintingProvider, getAppContextMenuItems, orderedAppIds, t]
  )

  // Mini app tiles are ordered by their global `orderKey` (shared with the mini
  // app settings page), independent of the sidebar favorites. Every pinned mini
  // app is drag-sortable in one grid; reordering persists purely to `orderKey`.
  const sortedMiniApps = useMemo(
    () => [...pinned].sort((a, b) => (a.orderKey < b.orderKey ? -1 : a.orderKey > b.orderKey ? 1 : 0)),
    [pinned]
  )

  // Hold the drop result in local optimistic state so the Sortable keeps the tile
  // at its dropped slot while the async order-key write settles. Without this the
  // tile snaps back to its old position for one render — before the reordered
  // `/mini-apps` cache lands — and then jumps forward, a visible flashback. The
  // resync preserves the reference only when the refreshed list contains the same
  // objects in the same order; a rename/logo refresh with the same ids still adopts
  // the fresh objects.
  const [orderedMiniApps, setOrderedMiniApps] = useState(sortedMiniApps)
  useEffect(() => {
    setOrderedMiniApps((prev) => (sameMiniAppItems(prev, sortedMiniApps) ? prev : sortedMiniApps))
  }, [sortedMiniApps])

  const launchpadMiniAppsVisible = orderedMiniApps.length > 0

  const handleAppsSortEnd = useCallback(
    ({ oldIndex, newIndex }: { oldIndex: number; newIndex: number }) => {
      const nextItems = arrayMove(appMenuItems, oldIndex, newIndex)
      reorderApps(nextItems.map((item) => item.id))
    },
    [appMenuItems, reorderApps]
  )

  const handleMiniAppsSortEnd = useCallback(
    ({ oldIndex, newIndex }: { oldIndex: number; newIndex: number }) => {
      const nextItems = arrayMove(orderedMiniApps, oldIndex, newIndex)
      setOrderedMiniApps(nextItems)
      reorderMiniAppsByStatus('pinned', nextItems).catch(() => {
        window.toast?.error(t('miniApp.reorder_failed'))
      })
    },
    [orderedMiniApps, reorderMiniAppsByStatus, t]
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
      key={app.appId}
      className={`${LAUNCHPAD_ITEM_CLASS} flex justify-center rounded-[8px] px-0 py-2 transition-transform duration-200 hover:scale-105 active:scale-95`}>
      <App app={app} size={56} variant="launchpad" onOpen={openMiniApp} />
    </div>
  )

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <Scrollbar className="min-h-0 flex-1">
        <div className="mx-auto flex w-full max-w-180 flex-col gap-5 py-12.5">
          <section className="flex flex-col gap-2">
            <h2 className="m-0 px-9 py-0 font-semibold text-[14px] text-foreground opacity-80">
              {t('launchpad.apps')}
            </h2>
            <div className={LAUNCHPAD_GRID_CLASS}>
              <Sortable
                items={appMenuItems}
                itemKey="id"
                layout="grid"
                listStyle={SORTABLE_CONTENTS_STYLE}
                onDragStart={handleSortableDragStart}
                onDragEnd={handleSortableDragSettled}
                onDragCancel={handleSortableDragSettled}
                onSortEnd={handleAppsSortEnd}
                renderItem={(item) => renderAppMenuItem(item)}
              />
            </div>
          </section>

          {launchpadMiniAppsVisible && (
            <section className="flex flex-col gap-2">
              <h2 className="m-0 px-9 py-0 font-semibold text-[14px] text-foreground opacity-80">
                {t('launchpad.miniApps')}
              </h2>
              <div className={LAUNCHPAD_GRID_CLASS}>
                <Sortable
                  items={orderedMiniApps}
                  itemKey="appId"
                  layout="grid"
                  listStyle={SORTABLE_CONTENTS_STYLE}
                  onDragStart={handleSortableDragStart}
                  onDragEnd={handleSortableDragSettled}
                  onDragCancel={handleSortableDragSettled}
                  onSortEnd={handleMiniAppsSortEnd}
                  renderItem={(app) => renderMiniAppItem(app)}
                />
              </div>
            </section>
          )}
        </div>
      </Scrollbar>
    </div>
  )
}

/** Same pinned mini app objects in the same order. */
function sameMiniAppItems(a: MiniAppType[], b: MiniAppType[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}
