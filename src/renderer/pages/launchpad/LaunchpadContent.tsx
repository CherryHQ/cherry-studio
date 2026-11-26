import { arrayMove } from '@dnd-kit/helpers'
import { ChevronLeft, ChevronRight, Search, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Input, Sortable } from '@cherrystudio/ui'
import { CommandContextMenu, type CommandContextMenuExtraItem } from '@renderer/components/command'
import SidebarShortcutIcon from '@renderer/components/icons/SidebarShortcutIcon'
import { LaunchpadAppIcon } from '@renderer/components/LaunchpadAppIcon'
import App from '@renderer/components/MiniApp/MiniApp'
import { useMiniApps } from '@renderer/hooks/useMiniApps'
import { useSidebarAvailable } from '@renderer/hooks/useSidebarAvailable'
import { useSidebarShortcuts } from '@renderer/hooks/useSidebarShortcuts'
import { getSidebarIconLabelKey } from '@renderer/i18n/label'
import { toast } from '@renderer/services/toast'
import type { SidebarAppId } from '@renderer/utils/sidebar'
import { createSidebarShortcutTarget, SIDEBAR_SHORTCUT_PROVIDER_IDS } from '@renderer/utils/sidebar'
import { cn } from '@renderer/utils/style'
import type { MiniApp as MiniAppType } from '@shared/data/types/miniApp'

import { useLaunchpadCatalog } from './hooks/useLaunchpadCatalog'

const LAUNCHPAD_ITEM_CLASS = 'mx-auto w-[92px]'
const SORTABLE_CONTENTS_STYLE = { display: 'contents' } as const

export function LaunchpadContent({
  compact = false,
  onOpen,
  onDismiss
}: {
  compact?: boolean
  onOpen: (url: string) => void
  onDismiss?: () => void
}) {
  const itemClassName = LAUNCHPAD_ITEM_CLASS
  const searchRef = useRef<HTMLInputElement>(null)
  const isOverlay = !!onDismiss
  useEffect(() => {
    if (isOverlay) searchRef.current?.focus()
  }, [isOverlay])
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(0)
  const [layout, setLayout] = useState({ columns: 7, rows: 3 })
  const gridRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const grid = gridRef.current
    if (!grid) return
    const observer = new ResizeObserver(([entry]) => {
      const columns = Math.max(1, Math.min(7, Math.floor(entry.contentRect.width / 120)))
      const rows = Math.max(1, Math.min(4, Math.floor(entry.contentRect.height / 120)))
      setLayout((previous) => (previous.columns === columns && previous.rows === rows ? previous : { columns, rows }))
    })
    observer.observe(grid)
    return () => observer.disconnect()
  }, [])
  const sidebarAvailable = useSidebarAvailable()
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
  const { apps, miniApps: sortedMiniApps, reorderApps } = useLaunchpadCatalog(pinned)
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
  const handleSortableDragStart = useCallback((event: { activeId: string | number }) => {
    draggedItemIdRef.current = String(event.activeId)
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

  const search = query.trim().toLocaleLowerCase()
  const filteredApps = appMenuItems.filter((app) => app.label.toLocaleLowerCase().includes(search))
  const filteredMiniApps = orderedMiniApps.filter((app) =>
    (app.nameKey ? t(app.nameKey) : app.name).toLocaleLowerCase().includes(search)
  )
  const pageSize = layout.columns * layout.rows
  const pageCount = Math.max(1, Math.ceil((filteredApps.length + filteredMiniApps.length) / pageSize))
  const currentPage = Math.min(page, pageCount - 1)
  const start = currentPage * pageSize
  const visibleApps = filteredApps.slice(start, start + pageSize)
  const visibleMiniApps = filteredMiniApps.slice(
    Math.max(0, start - filteredApps.length),
    Math.max(0, start + pageSize - filteredApps.length)
  )

  const handleAppsSortEnd = useCallback(
    ({ oldIndex, newIndex }: { oldIndex: number; newIndex: number }) => {
      const nextItems = arrayMove(
        appMenuItems,
        appMenuItems.findIndex((item) => item.id === visibleApps[oldIndex]?.id),
        appMenuItems.findIndex((item) => item.id === visibleApps[newIndex]?.id)
      )
      reorderApps(nextItems.map((item) => item.id))
    },
    [appMenuItems, reorderApps, visibleApps]
  )

  const handleMiniAppsSortEnd = useCallback(
    ({ oldIndex, newIndex }: { oldIndex: number; newIndex: number }) => {
      const nextItems = arrayMove(
        orderedMiniApps,
        orderedMiniApps.findIndex((item) => item.appId === visibleMiniApps[oldIndex]?.appId),
        orderedMiniApps.findIndex((item) => item.appId === visibleMiniApps[newIndex]?.appId)
      )
      setOrderedMiniApps(nextItems)
      reorderMiniAppsByStatus('pinned', nextItems).catch(() => {
        toast.error(t('miniApp.reorder_failed'))
      })
    },
    [orderedMiniApps, reorderMiniAppsByStatus, t, visibleMiniApps]
  )

  const renderAppMenuItem = (item: (typeof appMenuItems)[number]) => (
    <CommandContextMenu key={item.id} location="webcontents.context" extraItems={item.menuItems}>
      <Button
        variant="ghost"
        type="button"
        data-dnd-row-control
        onClick={() => {
          if (!shouldSuppressLaunchClick(item.id)) onOpen(item.url)
        }}
        className={`${itemClassName} group flex h-auto cursor-pointer flex-col items-center gap-2 rounded-2xl px-1 py-2 text-center outline-none transition-transform duration-200 motion-reduce:transition-none hover:scale-105 hover:bg-transparent focus-visible:scale-105 focus-visible:bg-transparent active:scale-95`}>
        <span className="relative flex size-14 items-center justify-center">
          <LaunchpadAppIcon src={item.iconSrc} size={56} className="relative overflow-hidden" />
        </span>
        <span className="w-full overflow-hidden text-ellipsis whitespace-nowrap text-sm text-foreground">
          {item.label}
        </span>
      </Button>
    </CommandContextMenu>
  )

  const renderMiniAppItem = (app: MiniAppType) => (
    <div
      key={app.appId}
      className={`${itemClassName} flex justify-center rounded-[8px] px-0 py-2 transition-transform duration-200 motion-reduce:transition-none hover:scale-105 active:scale-95`}>
      <App
        app={app}
        size={56}
        variant="launchpad-overlay"
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
    <div
      className="flex h-full min-h-0 flex-col items-center px-6 pt-12 pb-6 text-foreground sm:px-12"
      onClick={(event) => {
        if (event.target === event.currentTarget) onDismiss?.()
      }}>
      <div className="relative mb-8 w-full max-w-72 shrink-0">
        <Search
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-3 z-10 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          ref={searchRef}
          type="search"
          aria-label={t('common.search')}
          placeholder={t('common.search')}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setPage(0)
          }}
          className="h-9 rounded-xl border-border/50 bg-background/35 pl-9 text-center shadow-none backdrop-blur-sm focus-visible:text-left"
        />
      </div>
      <div
        ref={gridRef}
        className="mx-auto grid min-h-0 w-full max-w-[900px] flex-1 content-start justify-items-center gap-x-2 overflow-y-auto"
        style={{ gridTemplateColumns: `repeat(${layout.columns}, minmax(0, 1fr))`, gridAutoRows: '120px' }}
        onClick={(event) => {
          if (event.target === event.currentTarget) onDismiss?.()
        }}>
        {!filteredApps.length && !filteredMiniApps.length ? (
          <p role="status" className="col-span-full self-center text-muted-foreground">
            {t('common.no_results')}
          </p>
        ) : null}
        {search ? (
          visibleApps.map(renderAppMenuItem)
        ) : (
          <Sortable
            items={visibleApps}
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
        {search ? (
          visibleMiniApps.map(renderMiniAppItem)
        ) : (
          <Sortable
            items={visibleMiniApps}
            itemKey="appId"
            layout="grid"
            listStyle={SORTABLE_CONTENTS_STYLE}
            onDragStart={handleSortableDragStart}
            onDragEnd={handleSortableDragSettled}
            onDragCancel={handleSortableDragSettled}
            onSortEnd={handleMiniAppsSortEnd}
            renderItem={(item) => renderMiniAppItem(item)}
          />
        )}
      </div>
      <nav aria-label={t('title.launchpad')} className="mt-4 flex shrink-0 items-center justify-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t('common.previous')}
          disabled={currentPage === 0}
          onClick={() => setPage(currentPage - 1)}
          className="size-8 rounded-full">
          <ChevronLeft className="size-4" />
        </Button>
        {Array.from({ length: pageCount }, (_, index) => (
          <Button
            key={index}
            type="button"
            variant="ghost"
            aria-label={`${index + 1} / ${pageCount}`}
            aria-current={index === currentPage ? 'page' : undefined}
            onClick={() => setPage(index)}
            className="size-7 rounded-full p-0">
            <span
              className={cn(
                'size-1.5 rounded-full transition-colors',
                index === currentPage ? 'bg-foreground' : 'bg-foreground/30'
              )}
            />
          </Button>
        ))}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t('common.next')}
          disabled={currentPage === pageCount - 1}
          onClick={() => setPage(currentPage + 1)}
          className="size-8 rounded-full">
          <ChevronRight className="size-4" />
        </Button>
      </nav>
      {onDismiss && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t('common.close')}
          onClick={onDismiss}
          className="absolute top-4 right-4 size-9 rounded-full">
          <X className="size-5" />
        </Button>
      )}
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
