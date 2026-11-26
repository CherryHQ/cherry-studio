import { arrayMove } from '@dnd-kit/helpers'
import { X } from 'lucide-react'
import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState
} from 'react'
import { useTranslation } from 'react-i18next'

import { Button, SearchInput, Sortable } from '@cherrystudio/ui'
import { CommandContextMenu, type CommandContextMenuExtraItem } from '@renderer/components/command'
import SidebarShortcutIcon from '@renderer/components/icons/SidebarShortcutIcon'
import { LaunchpadAppIcon } from '@renderer/components/LaunchpadAppIcon'
import App from '@renderer/components/MiniApp/MiniApp'
import { useMiniApps } from '@renderer/hooks/useMiniApps'
import { useSidebarAvailable } from '@renderer/hooks/useSidebarAvailable'
import { useSidebarShortcuts } from '@renderer/hooks/useSidebarShortcuts'
import { getSidebarIconLabelKey } from '@renderer/i18n/label'
import { toast } from '@renderer/services/toast'
import { matchesSearchText } from '@renderer/utils/pinyin'
import type { SidebarAppId } from '@renderer/utils/sidebar'
import { createSidebarShortcutTarget, SIDEBAR_SHORTCUT_PROVIDER_IDS } from '@renderer/utils/sidebar'
import { cn } from '@renderer/utils/style'
import type { MiniApp as MiniAppType } from '@shared/data/types/miniApp'

import { useLaunchpadCatalog } from './hooks/useLaunchpadCatalog'

const LAUNCHPAD_ITEM_CLASS = 'mx-auto w-[92px]'
const LAUNCHPAD_ROW_HEIGHT = 120
const LAUNCHPAD_PAGINATION_HEIGHT = 44
const POINTER_GESTURE_THRESHOLD = 48
const WHEEL_GESTURE_THRESHOLD = 20
const WHEEL_GESTURE_IDLE_MS = 140
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
  const updateQuery = (value: string) => {
    setQuery(value)
    setPage(0)
  }
  const [layout, setLayout] = useState({ columns: 7, rows: 3, pagedRows: 3 })
  const gridAreaRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const gridArea = gridAreaRef.current
    if (!gridArea) return
    const observer = new ResizeObserver(
      ([
        {
          contentRect: { width, height }
        }
      ]) => {
        const columns = Math.max(1, Math.min(7, Math.floor(width / 120)))
        const rows = Math.max(1, Math.floor(height / LAUNCHPAD_ROW_HEIGHT))
        const pagedRows = Math.max(1, Math.floor((height - LAUNCHPAD_PAGINATION_HEIGHT) / LAUNCHPAD_ROW_HEIGHT))
        setLayout((previous) =>
          previous.columns === columns && previous.rows === rows && previous.pagedRows === pagedRows
            ? previous
            : { columns, rows, pagedRows }
        )
      }
    )
    observer.observe(gridArea)
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
  const isSortingRef = useRef(false)
  const wheelGestureRef = useRef({ delta: 0, lastEventAt: 0, lastPageDirection: 0 })
  const gridDragRef = useRef<{ pointerId: number; x: number; y: number } | null>(null)
  const suppressGridClickRef = useRef(false)

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
    isSortingRef.current = true
    draggedItemIdRef.current = String(event.activeId)
    suppressClickUntilRef.current = Date.now() + 500
  }, [])

  // The pointer sensor fires a synthetic click on the dragged element after drop;
  // refresh the window on settle so the click is still suppressed after long drags.
  const handleSortableDragSettled = useCallback(() => {
    isSortingRef.current = false
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

  const search = query.trim()
  const filteredApps = appMenuItems.filter((app) => matchesSearchText(app.label, search))
  const filteredMiniApps = orderedMiniApps.filter((app) =>
    matchesSearchText(app.nameKey ? t(app.nameKey) : app.name, search)
  )
  const itemCount = filteredApps.length + filteredMiniApps.length
  const needsPagination = itemCount > layout.columns * layout.rows
  const pageSize = layout.columns * (needsPagination ? layout.pagedRows : layout.rows)
  const pageCount = Math.max(1, Math.ceil(itemCount / pageSize))
  const currentPage = Math.min(page, pageCount - 1)
  const turnPage = (direction: number) =>
    setPage((previousPage) => {
      const current = Math.min(previousPage, pageCount - 1)
      return Math.max(0, Math.min(current + direction, pageCount - 1))
    })

  const onPageWheel = useEffectEvent((event: WheelEvent) => {
    if (!needsPagination || isSortingRef.current || event.ctrlKey || event.defaultPrevented) return
    const delta = event.shiftKey ? event.deltaX || event.deltaY : event.deltaX
    if (!delta || (!event.shiftKey && Math.abs(delta) <= Math.abs(event.deltaY))) return
    event.preventDefault()

    const now = Date.now()
    if (now - wheelGestureRef.current.lastEventAt > WHEEL_GESTURE_IDLE_MS) {
      wheelGestureRef.current = { delta: 0, lastEventAt: now, lastPageDirection: 0 }
    }
    const gesture = wheelGestureRef.current
    gesture.lastEventAt = now
    if (Math.sign(delta) === gesture.lastPageDirection) {
      gesture.delta = 0
      return
    }

    const unit =
      event.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? 16
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
          ? gridAreaRef.current?.clientWidth || WHEEL_GESTURE_THRESHOLD
          : 1
    gesture.delta += delta * unit
    if (Math.abs(gesture.delta) < WHEEL_GESTURE_THRESHOLD) return
    gesture.lastPageDirection = Math.sign(gesture.delta)
    gesture.delta = 0
    turnPage(gesture.lastPageDirection)
  })

  useEffect(() => {
    const gridArea = gridAreaRef.current
    if (!gridArea) return
    gridArea.addEventListener('wheel', onPageWheel, { passive: false })
    return () => gridArea.removeEventListener('wheel', onPageWheel)
  }, [])

  const handleGridPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || event.pointerType !== 'mouse' || event.button !== 0) return
    suppressGridClickRef.current = false
    if (!needsPagination) return
    gridDragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY }
    event.currentTarget.setPointerCapture(event.pointerId)
    event.preventDefault()
  }

  const handleGridPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = gridDragRef.current
    if (!start || start.pointerId !== event.pointerId) return
    gridDragRef.current = null
    const dx = event.clientX - start.x
    const dy = event.clientY - start.y
    if (Math.max(Math.abs(dx), Math.abs(dy)) < POINTER_GESTURE_THRESHOLD) return
    suppressGridClickRef.current = true
    if (Math.abs(dx) > Math.abs(dy)) turnPage(-Math.sign(dx))
  }

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
        if (event.target === event.currentTarget || event.target === gridAreaRef.current) onDismiss?.()
      }}>
      <div className="mb-8 w-full max-w-72 shrink-0">
        <SearchInput
          ref={searchRef}
          aria-label={t('common.search')}
          placeholder={t('common.search')}
          value={query}
          onChange={(event) => updateQuery(event.target.value)}
          onClear={() => {
            updateQuery('')
            searchRef.current?.focus()
          }}
          clearLabel={t('globalSearch.clear')}
          className="text-center focus-visible:text-left"
          containerClassName="rounded-full border-border/50 bg-background/35 backdrop-blur-sm"
        />
      </div>
      <div ref={gridAreaRef} className="flex min-h-0 w-full flex-1 flex-col items-center">
        <div
          role="region"
          aria-label={t('launchpad.apps')}
          className="grid min-h-0 w-full max-w-[900px] flex-1 content-start justify-items-center gap-x-2 overflow-y-auto"
          style={{
            gridTemplateColumns: `repeat(${layout.columns}, minmax(0, 1fr))`,
            gridAutoRows: `${LAUNCHPAD_ROW_HEIGHT}px`
          }}
          onPointerDown={handleGridPointerDown}
          onPointerUp={handleGridPointerUp}
          onLostPointerCapture={(event) => {
            if (gridDragRef.current?.pointerId === event.pointerId) gridDragRef.current = null
          }}
          onClick={(event) => {
            if (event.target !== event.currentTarget) return
            if (!suppressGridClickRef.current) onDismiss?.()
            suppressGridClickRef.current = false
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
        {needsPagination && (
          <nav
            aria-label={t('title.launchpad')}
            className="flex shrink-0 items-center justify-center self-center pt-4"
            style={{ height: LAUNCHPAD_PAGINATION_HEIGHT }}>
            {Array.from({ length: pageCount }, (_, index) => (
              <Button
                key={index}
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`${index + 1} / ${pageCount}`}
                aria-current={index === currentPage ? 'page' : undefined}
                onClick={() => setPage(index)}
                className="group w-6 rounded-full hover:bg-transparent focus-visible:bg-transparent">
                <span
                  className={cn(
                    'size-1.5 rounded-full group-focus-visible:scale-125 group-focus-visible:bg-primary',
                    index === currentPage
                      ? 'bg-foreground'
                      : 'bg-foreground/30 group-hover:scale-115 motion-safe:transition-transform'
                  )}
                />
              </Button>
            ))}
          </nav>
        )}
      </div>
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
