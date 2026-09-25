import { arrayMove } from '@dnd-kit/sortable'
import { useNavigate } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Sortable } from '@cherrystudio/ui'
import { CommandContextMenu, type CommandContextMenuExtraItem } from '@renderer/components/command'
import SidebarShortcutIcon from '@renderer/components/icons/SidebarShortcutIcon'
import { LaunchpadAppIcon } from '@renderer/components/LaunchpadAppIcon'
import App from '@renderer/components/MiniApp/MiniApp'
import Scrollbar from '@renderer/components/Scrollbar'
import { useLaunchpadCatalog } from '@renderer/hooks/useLaunchpadCatalog'
import { useMiniApps } from '@renderer/hooks/useMiniApps'
import { useMinimalMode } from '@renderer/hooks/useMinimalMode'
import { useSidebarShortcuts } from '@renderer/hooks/useSidebarShortcuts'
import { getSidebarIconLabelKey } from '@renderer/i18n/label'
import { toast } from '@renderer/services/toast'
import type { SidebarAppId } from '@renderer/utils/sidebar'
import { createSidebarShortcutTarget, SIDEBAR_SHORTCUT_PROVIDER_IDS } from '@renderer/utils/sidebar'
import type { MiniApp as MiniAppType } from '@shared/data/types/miniApp'

const BASE_URL = 'https://www.cherry-ai.com/'

const LAUNCHPAD_GRID_CLASS = 'grid grid-cols-6 justify-items-center gap-2 px-2'
const LAUNCHPAD_ITEM_CLASS = 'mx-auto w-[92px]'
const SORTABLE_CONTENTS_STYLE = { display: 'contents' } as const

export default function LaunchpadPage() {
  const sidebarAvailable = !useMinimalMode()?.enabled
  const { t } = useTranslation()
  const navigate = useNavigate()
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
  const { shortcuts, isPinned, setPinned } = useSidebarShortcuts()
  const { apps, shortcuts: fixedShortcuts, miniApps: sortedMiniApps, reorderApps } = useLaunchpadCatalog(pinned)
  const suppressClickUntilRef = useRef(0)
  const draggedItemIdRef = useRef<string | null>(null)

  const miniAppFavoriteIdSet = useMemo(
    () =>
      new Set(
        shortcuts.flatMap((shortcut) =>
          shortcut.target.locator.providerId === SIDEBAR_SHORTCUT_PROVIDER_IDS.MINI_APP
            ? [shortcut.target.locator.resourceId]
            : []
        )
      ),
    [shortcuts]
  )
  const openedMiniAppIdSet = useMemo(
    () => new Set(openedKeepAliveMiniApps.map((app) => app.appId)),
    [openedKeepAliveMiniApps]
  )
  const toggleMiniApp = useCallback(
    (appId: string) => {
      const app = pinned.find((item) => item.appId === appId)
      const fallbackLabel = app ? (app.nameKey ? t(app.nameKey) : app.name) : undefined
      setPinned(
        createSidebarShortcutTarget(SIDEBAR_SHORTCUT_PROVIDER_IDS.MINI_APP, appId),
        !miniAppFavoriteIdSet.has(appId),
        fallbackLabel
      )
    },
    [pinned, t, setPinned, miniAppFavoriteIdSet]
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

  const openMiniApp = useCallback(
    (appId: string) => {
      if (shouldSuppressLaunchClick(appId)) return

      void navigateToUrl(`/app/mini-app/${appId}`)
    },
    [navigateToUrl, shouldSuppressLaunchClick]
  )

  const pinToSidebar = useCallback(
    (favorite: SidebarAppId) => {
      const target = createSidebarShortcutTarget(SIDEBAR_SHORTCUT_PROVIDER_IDS.APP, favorite)
      setPinned(target, true, t(getSidebarIconLabelKey(favorite)))
    },
    [setPinned, t]
  )

  const unpinFromSidebar = useCallback(
    (favorite: SidebarAppId) => {
      const target = createSidebarShortcutTarget(SIDEBAR_SHORTCUT_PROVIDER_IDS.APP, favorite)
      setPinned(target, false)
    },
    [setPinned]
  )

  const getAppContextMenuItems = useCallback(
    (favorite: SidebarAppId): CommandContextMenuExtraItem[] => {
      if (!sidebarAvailable) return []
      const target = createSidebarShortcutTarget(SIDEBAR_SHORTCUT_PROVIDER_IDS.APP, favorite)
      const pinned = isPinned(target)

      return [
        {
          type: 'item',
          id: `launchpad.${pinned ? 'unpin-from-sidebar' : 'pin-to-sidebar'}.${favorite}`,
          label: t(pinned ? 'launchpad.unpin_from_sidebar' : 'launchpad.pin_to_sidebar'),
          icon: <SidebarShortcutIcon size={14} pinned={pinned} />,
          onSelect: () => (pinned ? unpinFromSidebar(favorite) : pinToSidebar(favorite))
        }
      ]
    },
    [isPinned, pinToSidebar, sidebarAvailable, t, unpinFromSidebar]
  )

  const appMenuItems = useMemo(
    () => apps.map((app) => ({ ...app, menuItems: getAppContextMenuItems(app.id) })),
    [apps, getAppContextMenuItems]
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
        onClick={() => {
          if (!shouldSuppressLaunchClick(item.id)) void navigateToUrl(item.url)
        }}
        className={`${LAUNCHPAD_ITEM_CLASS} group flex cursor-pointer flex-col items-center gap-1 rounded-2xl px-1 py-2 text-center outline-none transition-transform duration-200 hover:scale-105 focus-visible:scale-105 active:scale-95`}>
        <span className="relative flex size-14 items-center justify-center">
          <LaunchpadAppIcon src={item.iconSrc} />
        </span>
        <span className="w-full overflow-hidden text-ellipsis whitespace-nowrap text-[12px] text-foreground">
          {item.label}
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
              {fixedShortcuts.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => void navigateToUrl(item.url)}
                  className={`${LAUNCHPAD_ITEM_CLASS} group flex cursor-pointer flex-col items-center gap-1 rounded-2xl px-1 py-2 text-center outline-none transition-transform duration-200 hover:scale-105 focus-visible:scale-105 active:scale-95`}>
                  <LaunchpadAppIcon src={item.iconSrc} />
                  <span className="w-full overflow-hidden text-ellipsis whitespace-nowrap text-[12px] text-foreground">
                    {item.label}
                  </span>
                </button>
              ))}
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
