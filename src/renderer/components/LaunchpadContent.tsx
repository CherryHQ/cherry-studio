import { arrayMove } from '@dnd-kit/sortable'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Sortable } from '@cherrystudio/ui'
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
import { cn } from '@renderer/utils/style'
import type { MiniApp as MiniAppType } from '@shared/data/types/miniApp'

const LAUNCHPAD_GRID_CLASS = 'grid grid-cols-6 justify-items-center gap-2 px-2'
const LAUNCHPAD_ITEM_CLASS = 'mx-auto w-[92px]'
const SORTABLE_CONTENTS_STYLE = { display: 'contents' } as const

export function LaunchpadContent({ compact = false, onOpen }: { compact?: boolean; onOpen: (url: string) => void }) {
  const gridClassName = compact
    ? 'grid grid-cols-[repeat(auto-fill,minmax(80px,1fr))] justify-items-center gap-2'
    : LAUNCHPAD_GRID_CLASS
  const itemClassName = compact ? 'w-full min-w-0' : LAUNCHPAD_ITEM_CLASS
  const sidebarAvailable = !useMinimalMode()?.enabled
  const { t } = useTranslation()
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

  const openMiniApp = useCallback(
    (appId: string) => {
      if (shouldSuppressLaunchClick(appId)) return

      onOpen(`/app/mini-app/${appId}`)
    },
    [onOpen, shouldSuppressLaunchClick]
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
    () =>
      apps
        .filter((app) => !compact || (app.id !== 'assistants' && app.id !== 'agents'))
        .map((app) => ({ ...app, menuItems: getAppContextMenuItems(app.id) })),
    [apps, compact, getAppContextMenuItems]
  )

  // Keep the dropped order visible while the asynchronous order-key update settles.
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
      <Button
        variant="ghost"
        type="button"
        onClick={() => {
          if (!shouldSuppressLaunchClick(item.id)) onOpen(item.url)
        }}
        className={`${itemClassName} group flex h-auto cursor-pointer flex-col items-center gap-1 rounded-2xl px-1 py-2 text-center outline-none transition-transform duration-200 hover:scale-105 hover:bg-transparent focus-visible:scale-105 focus-visible:bg-transparent active:scale-95`}>
        <span className={cn('relative flex items-center justify-center', compact ? 'size-[46px]' : 'size-14')}>
          <LaunchpadAppIcon src={item.iconSrc} size={compact ? 40 : 50} />
        </span>
        <span className="w-full overflow-hidden text-ellipsis whitespace-nowrap text-[12px] text-foreground">
          {item.label}
        </span>
      </Button>
    </CommandContextMenu>
  )

  const renderMiniAppItem = (app: MiniAppType) => (
    <div
      key={app.appId}
      className={`${itemClassName} flex justify-center rounded-[8px] px-0 py-2 transition-transform duration-200 hover:scale-105 active:scale-95`}>
      <App
        app={app}
        size={compact ? 40 : 56}
        variant={compact ? 'launchpad-compact' : 'launchpad'}
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
    <div className={cn('flex min-h-0 flex-col', !compact && 'h-full bg-background')}>
      <Scrollbar className={compact ? 'max-h-[min(480px,60vh)]' : 'min-h-0 flex-1'}>
        <div className={cn('mx-auto flex w-full flex-col gap-5', !compact && 'max-w-180 py-12.5')}>
          <section className="flex flex-col gap-2">
            <h2
              className={cn(
                'm-0 py-0 font-semibold text-[14px] text-foreground opacity-80',
                compact ? 'px-1' : 'px-9'
              )}>
              {t('launchpad.apps')}
            </h2>
            <div className={gridClassName}>
              {compact ? (
                appMenuItems.map(renderAppMenuItem)
              ) : (
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
              )}
              {fixedShortcuts.map((item) => (
                <Button
                  variant="ghost"
                  key={item.id}
                  type="button"
                  onClick={() => onOpen(item.url)}
                  className={`${itemClassName} group flex h-auto cursor-pointer flex-col items-center gap-1 rounded-2xl px-1 py-2 text-center outline-none transition-transform duration-200 hover:scale-105 hover:bg-transparent focus-visible:scale-105 focus-visible:bg-transparent active:scale-95`}>
                  <LaunchpadAppIcon src={item.iconSrc} size={compact ? 40 : 50} />
                  <span className="w-full overflow-hidden text-ellipsis whitespace-nowrap text-[12px] text-foreground">
                    {item.label}
                  </span>
                </Button>
              ))}
            </div>
          </section>

          {launchpadMiniAppsVisible && (
            <section className="flex flex-col gap-2">
              <h2
                className={cn(
                  'm-0 py-0 font-semibold text-[14px] text-foreground opacity-80',
                  compact ? 'px-1' : 'px-9'
                )}>
                {t('launchpad.miniApps')}
              </h2>
              <div className={gridClassName}>
                {compact ? (
                  orderedMiniApps.map(renderMiniAppItem)
                ) : (
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
                )}
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
