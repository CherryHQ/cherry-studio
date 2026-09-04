import { Sortable } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { arrayMove } from '@dnd-kit/sortable'
import agentsIcon from '@renderer/assets/images/apps/launchpad-agents.svg'
import assistantsIcon from '@renderer/assets/images/apps/launchpad-assistants.svg'
import codeToolsIcon from '@renderer/assets/images/apps/launchpad-code-tools.svg'
import dshIcon from '@renderer/assets/images/apps/launchpad-dsh.svg'
import filesIcon from '@renderer/assets/images/apps/launchpad-files.svg'
import knowledgeIcon from '@renderer/assets/images/apps/launchpad-knowledge.svg'
import miniAppIcon from '@renderer/assets/images/apps/launchpad-mini-app.svg'
import notesIcon from '@renderer/assets/images/apps/launchpad-notes.svg'
import paintingsIcon from '@renderer/assets/images/apps/launchpad-paintings.svg'
import translateIcon from '@renderer/assets/images/apps/launchpad-translate.svg'
import { CommandContextMenu, type CommandContextMenuExtraItem } from '@renderer/components/command'
import App from '@renderer/components/MiniApp/MiniApp'
import Scrollbar from '@renderer/components/Scrollbar'
import { useCurrentTab, useTabs } from '@renderer/hooks/tab'
import { useLaunchpadAppOrder } from '@renderer/hooks/useLaunchpadAppOrder'
import { useMiniApps } from '@renderer/hooks/useMiniApps'
import { useSidebarFavorites } from '@renderer/hooks/useSidebarFavorites'
import { getSidebarIconLabelKey } from '@renderer/i18n/label'
import { toast } from '@renderer/services/toast'
import type { SidebarAppId } from '@renderer/utils/sidebar'
import { getSidebarMenuPath } from '@renderer/utils/sidebar'
import type { MiniApp as MiniAppType } from '@shared/data/types/miniApp'
import { useNavigate } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

const BASE_URL = 'https://www.cherry-ai.com/'
const DEEPSEEK_HARNESS_URL = '/app/code?tool=deepseek-harness'

const LAUNCHPAD_GRID_CLASS = 'grid grid-cols-6 justify-items-center gap-2 px-2'
const LAUNCHPAD_ITEM_CLASS = 'mx-auto w-[92px]'
const APP_ICON_TILE_CLASS =
  'flex size-14 items-center justify-center rounded-2xl border border-border-subtle bg-transparent'
const APP_ICON_FRAME_CLASS =
  'relative flex size-[50px] shrink-0 items-center justify-center overflow-hidden rounded-xl select-none'
const APP_ICON_CLASS = 'size-[50px] object-contain'
const SORTABLE_CONTENTS_STYLE = { display: 'contents' } as const

const APP_ICON_SOURCES: Record<SidebarAppId, string> = {
  assistants: assistantsIcon,
  agents: agentsIcon,
  paintings: paintingsIcon,
  translate: translateIcon,
  mini_app: miniAppIcon,
  knowledge: knowledgeIcon,
  files: filesIcon,
  code_tools: codeToolsIcon,
  notes: notesIcon
}

export default function LaunchpadPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [defaultPaintingProvider] = usePreference('feature.paintings.default_provider')
  const {
    pinned,
    openedKeepAliveMiniApps,
    currentMiniAppId,
    miniAppShow,
    updateAppStatus,
    hideMiniApp,
    removeCustomMiniApp,
    reorderMiniAppsByStatus
  } = useMiniApps()
  const { appFavorites, miniAppFavoriteIds, setAppPinned, toggleMiniApp } = useSidebarFavorites()
  const { orderedAppIds, reorderApps } = useLaunchpadAppOrder()
  const currentTab = useCurrentTab()
  const { openTab, updateTab } = useTabs()
  const suppressClickUntilRef = useRef(0)
  const draggedItemIdRef = useRef<string | null>(null)

  const visibleSidebarFavoriteSet = useMemo(() => new Set(appFavorites), [appFavorites])
  const miniAppFavoriteIdSet = useMemo(() => new Set(miniAppFavoriteIds), [miniAppFavoriteIds])
  const openedMiniAppIdSet = useMemo(
    () => new Set(openedKeepAliveMiniApps.map((app) => app.appId)),
    [openedKeepAliveMiniApps]
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

  const openLaunchpadItem = (favorite: SidebarAppId) => {
    if (shouldSuppressLaunchClick(favorite)) return

    // Launchpad opens each app at its base entry (chat -> new conversation,
    // agents -> new session). Resuming the last-used instance is the sidebar's
    // job, not the launcher's.
    const path = getSidebarMenuPath(favorite, defaultPaintingProvider)
    if (!path) return
    void navigateToUrl(path)
  }

  const openMiniApp = useCallback(
    (appId: string, displayName: string, icon?: string) => {
      if (shouldSuppressLaunchClick(appId)) return

      const url = `/app/mini-app/${appId}`
      if (!currentTab) {
        void navigateToUrl(url)
        return
      }
      if (currentTab.isPinned) {
        openTab(url, { title: displayName, icon })
        return
      }
      updateTab(currentTab.id, { url, title: displayName, icon, metadata: undefined })
    },
    [currentTab, navigateToUrl, openTab, shouldSuppressLaunchClick, updateTab]
  )

  const openDeepSeekHarness = () => {
    void navigateToUrl(DEEPSEEK_HARNESS_URL)
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
      if (!visibleSidebarFavoriteSet.has(favorite)) return
      if (visibleSidebarFavoriteSet.size <= 1) return
      setAppPinned(favorite, false)
    },
    [setAppPinned, visibleSidebarFavoriteSet]
  )

  const getAppContextMenuItems = useCallback(
    (favorite: SidebarAppId): CommandContextMenuExtraItem[] => {
      const isPinned = visibleSidebarFavoriteSet.has(favorite)
      const isLastPinned = isPinned && visibleSidebarFavoriteSet.size <= 1

      return [
        {
          type: 'item',
          id: `launchpad.${isPinned ? 'unpin-from-sidebar' : 'pin-to-sidebar'}.${favorite}`,
          label: t(isPinned ? 'launchpad.unpin_from_sidebar' : 'launchpad.pin_to_sidebar'),
          enabled: !isLastPinned,
          onSelect: () => (isPinned ? unpinFromSidebar(favorite) : pinToSidebar(favorite))
        }
      ]
    },
    [pinToSidebar, t, unpinFromSidebar, visibleSidebarFavoriteSet]
  )

  // Sidebar-backed app tiles keep their existing launchpad order. The direct
  // Harness shortcut is fixed because it is not a sidebar destination.
  const appMenuItems = useMemo(
    () =>
      orderedAppIds.flatMap((favorite) => {
        if (!getSidebarMenuPath(favorite, defaultPaintingProvider)) return []

        return [
          {
            id: favorite,
            iconSrc: APP_ICON_SOURCES[favorite],
            text: t(getSidebarIconLabelKey(favorite)),
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
        toast.error(t('miniApp.reorder_failed'))
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
          <span className={APP_ICON_TILE_CLASS}>
            <span className={APP_ICON_FRAME_CLASS}>
              <img src={item.iconSrc} alt="" className={APP_ICON_CLASS} draggable={false} />
            </span>
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
      <App
        app={app}
        size={56}
        variant="launchpad"
        onOpen={openMiniApp}
        onUpdateStatus={updateAppStatus}
        onHide={hideMiniApp}
        onRemoveCustom={removeCustomMiniApp}
        onToggleSidebarFavorite={toggleMiniApp}
        isPinned
        isSidebarFavorite={miniAppFavoriteIdSet.has(app.appId)}
        isOpened={openedMiniAppIdSet.has(app.appId)}
        isActive={miniAppShow && currentMiniAppId === app.appId}
      />
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
              <button
                type="button"
                onClick={openDeepSeekHarness}
                className={`${LAUNCHPAD_ITEM_CLASS} group flex cursor-pointer flex-col items-center gap-1 rounded-2xl px-1 py-2 text-center outline-none transition-transform duration-200 hover:scale-105 focus-visible:scale-105 active:scale-95`}>
                <span className={APP_ICON_TILE_CLASS}>
                  <span className={APP_ICON_FRAME_CLASS}>
                    <img src={dshIcon} alt="" className={APP_ICON_CLASS} draggable={false} />
                  </span>
                </span>
                <span className="w-full overflow-hidden text-ellipsis whitespace-nowrap text-[12px] text-foreground">
                  {t('launchpad.deepseek_harness_shortcut')}
                </span>
              </button>
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
