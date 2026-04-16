import { Tooltip } from '@cherrystudio/ui'
import { isMac } from '@renderer/config/constant'
import useMacTransparentWindow from '@renderer/hooks/useMacTransparentWindow'
import { cn, uuid } from '@renderer/utils'
import { getDefaultRouteTitle } from '@renderer/utils/routeTitle'
import { Home, Plus, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { Tab } from '../../hooks/useTabs'
import { ShellTabBarActions, useShellTabBarLayout } from './ShellTabBarActions'
import { TabContextMenu } from './TabContextMenu'
import { getTabIcon } from './tabIcons'
import { useTabDrag } from './useTabDrag'

const HOME_TAB_ID = 'home'

// ─── Props ────────────────────────────────────────────────────────────────────

type AppShellTabBarProps = {
  tabs: Tab[]
  activeTabId: string
  setActiveTab: (id: string) => void
  closeTab: (id: string) => void
  addTab: (tab: Tab) => void
  reorderTabs: (type: 'pinned' | 'normal', oldIndex: number, newIndex: number) => void
  pinTab: (id: string) => void
  unpinTab: (id: string) => void
  isDetached?: boolean
}

interface ContextMenuState {
  tabId: string
  x: number
  y: number
}

// ─── Drag item props (grouped to reduce sub-component prop count) ─────────────

interface DragItemProps {
  isDragging: boolean
  isGhost: boolean
  noTransition: boolean
  translateX: number
  onPointerDown: (e: React.PointerEvent) => void
}

interface TabToneProps {
  activeClass: string
  hoverClass: string
}

// ─── Sub-components ───────────────────────────────────────────────────────────

const Separator = () => <div className="mx-0.5 h-4 w-px shrink-0 bg-border/50" />

const HomeTabButton = ({
  isActive,
  onClick,
  onContextMenu,
  tooltip,
  tone
}: {
  isActive: boolean
  onClick: () => void
  onContextMenu: (e: React.MouseEvent) => void
  tooltip: string
  tone: TabToneProps
}) => (
  <Tooltip placement="bottom" content={tooltip} delay={600}>
    <button
      type="button"
      onClick={onClick}
      onContextMenu={onContextMenu}
      className={cn(
        'flex h-8 w-8 shrink-0 cursor-default items-center justify-center rounded-full transition-colors duration-150 [-webkit-app-region:no-drag]',
        isActive ? tone.activeClass : tone.hoverClass
      )}>
      <Home size={14} strokeWidth={1.6} />
    </button>
  </Tooltip>
)

const PinnedTabButton = ({
  tab,
  isActive,
  onSelect,
  onContextMenu,
  drag,
  tabRef,
  tone
}: {
  tab: Tab
  isActive: boolean
  onSelect: () => void
  onContextMenu: (e: React.MouseEvent) => void
  drag: DragItemProps
  tabRef: (el: HTMLButtonElement | null) => void
  tone: TabToneProps
}) => {
  const Icon = getTabIcon(tab)
  return (
    <Tooltip placement="bottom" content={tab.title} delay={600}>
      <button
        ref={tabRef}
        data-tab-id={tab.id}
        type="button"
        onPointerDown={drag.onPointerDown}
        onClick={onSelect}
        onContextMenu={onContextMenu}
        title={tab.title}
        style={{
          transform: `translateX(${drag.translateX}px)`,
          transition: drag.isDragging || drag.noTransition ? 'none' : 'transform 200ms ease',
          zIndex: drag.isDragging ? 50 : 'auto',
          opacity: drag.isGhost ? 0.3 : 1
        }}
        className={cn(
          'flex h-7 w-7 items-center justify-center rounded-full transition-colors duration-150',
          drag.isDragging ? 'cursor-grabbing' : 'cursor-default',
          isActive ? tone.activeClass : tone.hoverClass
        )}>
        <Icon size={14} strokeWidth={1.6} />
      </button>
    </Tooltip>
  )
}

// Threshold below which the right-side X is hidden and icon-overlay X is used instead
const NARROW_TAB_THRESHOLD = 64

const NormalTabButton = ({
  tab,
  isActive,
  onSelect,
  onClose,
  onContextMenu,
  showClose = true,
  drag,
  tabRef,
  tone
}: {
  tab: Tab
  isActive: boolean
  onSelect: () => void
  onClose: () => void
  onContextMenu: (e: React.MouseEvent) => void
  showClose?: boolean
  drag: DragItemProps
  tabRef: (el: HTMLButtonElement | null) => void
  tone: TabToneProps
}) => {
  const Icon = getTabIcon(tab)
  const isCloseable = tab.id !== HOME_TAB_ID
  const btnRef = useRef<HTMLButtonElement | null>(null)
  const [isNarrow, setIsNarrow] = useState(false)

  useEffect(() => {
    const el = btnRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      setIsNarrow(entry.contentRect.width < NARROW_TAB_THRESHOLD)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const setRefs = useCallback(
    (el: HTMLButtonElement | null) => {
      btnRef.current = el
      tabRef(el)
    },
    [tabRef]
  )

  const showRightClose = isCloseable && showClose && !isNarrow
  const showIconOverlayClose = isCloseable && showClose && isNarrow

  return (
    <button
      ref={setRefs}
      data-tab-id={tab.id}
      type="button"
      onPointerDown={drag.onPointerDown}
      onClick={onSelect}
      onContextMenu={onContextMenu}
      style={{
        transform: `translateX(${drag.translateX}px)`,
        transition: drag.isDragging || drag.noTransition ? 'none' : 'transform 200ms ease',
        zIndex: drag.isDragging ? 50 : 'auto',
        opacity: drag.isGhost ? 0.3 : 1
      }}
      className={cn(
        'group relative flex h-[30px] min-w-[40px] max-w-[160px] flex-1 items-center gap-1.5 rounded-[10px] transition-all duration-150 [-webkit-app-region:no-drag]',
        showRightClose ? 'pr-1 pl-2' : 'px-2',
        drag.isDragging ? 'cursor-grabbing' : 'cursor-default',
        isActive ? tone.activeClass : tone.hoverClass
      )}>
      {/* Icon — on narrow tabs, X overlay replaces icon on hover (Chrome-style) */}
      <div className="relative flex h-[13px] w-[13px] shrink-0 items-center justify-center">
        <Icon size={13} strokeWidth={1.6} className={cn(showIconOverlayClose && 'group-hover:hidden')} />
        {showIconOverlayClose && (
          <div
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation()
              onClose()
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.stopPropagation()
                onClose()
              }
            }}
            className="absolute inset-0 hidden cursor-pointer items-center justify-center rounded-sm group-hover:flex">
            <X size={11} />
          </div>
        )}
      </div>
      <span
        className="min-w-0 flex-1 truncate text-left font-medium text-[11px] leading-none"
        style={{ maskImage: 'linear-gradient(to right, black 80%, transparent 100%)' }}>
        {tab.title}
      </span>
      {/* Right-side close button — only on wide tabs */}
      {showRightClose && (
        <div
          role="button"
          tabIndex={0}
          onClick={(e) => {
            e.stopPropagation()
            onClose()
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.stopPropagation()
              onClose()
            }
          }}
          className={cn(
            'ml-auto flex h-[18px] w-[18px] shrink-0 cursor-pointer items-center justify-center rounded-sm transition-all duration-150 hover:bg-foreground/10',
            isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
          )}>
          <X size={10} />
        </div>
      )}
    </button>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export const AppShellTabBar = ({
  tabs,
  activeTabId,
  setActiveTab,
  closeTab,
  addTab,
  reorderTabs,
  pinTab,
  unpinTab,
  isDetached = false
}: AppShellTabBarProps) => {
  const { t } = useTranslation()
  const isMacTransparentWindow = useMacTransparentWindow()
  const { rightPaddingClass } = useShellTabBarLayout(isDetached)
  const tabTone = useMemo<TabToneProps>(
    () =>
      isMacTransparentWindow
        ? {
            activeClass:
              'border border-black/8 bg-white/78 text-sidebar-foreground backdrop-blur-sm dark:border-white/14 dark:bg-white/16 dark:text-sidebar-foreground',
            hoverClass:
              'text-muted-foreground hover:bg-black/6 hover:text-sidebar-foreground hover:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.28)] dark:hover:bg-white/6 dark:hover:text-sidebar-foreground dark:hover:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)]'
          }
        : {
            activeClass: 'bg-black/8 text-sidebar-foreground dark:bg-sidebar-accent dark:text-sidebar-foreground',
            hoverClass:
              'text-muted-foreground hover:bg-white hover:text-sidebar-foreground dark:hover:bg-white/10 dark:hover:text-sidebar-foreground'
          },
    [isMacTransparentWindow]
  )

  const { homeTab, pinnedTabs, normalTabs } = useMemo(() => {
    const pinned: Tab[] = []
    const normal: Tab[] = []
    const home = tabs.find((tab) => tab.id === HOME_TAB_ID)
    for (const tab of tabs) {
      if (tab.id === HOME_TAB_ID) continue
      if (tab.isPinned) {
        pinned.push(tab)
      } else {
        normal.push(tab)
      }
    }
    return { homeTab: home, pinnedTabs: pinned, normalTabs: normal }
  }, [tabs])

  // ─── Context menu ───────────────────────────────────────────────────────────

  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)

  const handleContextMenu = useCallback((e: React.MouseEvent, tabId: string) => {
    if (tabId === HOME_TAB_ID) return
    e.preventDefault()
    setContextMenu({ tabId, x: e.clientX, y: e.clientY })
  }, [])

  const contextMenuTab = contextMenu ? tabs.find((t) => t.id === contextMenu.tabId) : undefined

  const handlePinToggle = useCallback(
    (tabId: string) => {
      const tab = tabs.find((t) => t.id === tabId)
      if (!tab) return
      if (tab.isPinned) {
        unpinTab(tabId)
      } else {
        pinTab(tabId)
      }
    },
    [tabs, pinTab, unpinTab]
  )

  const handleMoveToFirst = useCallback(
    (tabId: string) => {
      const tab = tabs.find((t) => t.id === tabId)
      if (!tab) return
      const list = tab.isPinned ? pinnedTabs : normalTabs
      const currentIndex = list.findIndex((t) => t.id === tabId)
      if (currentIndex > 0) {
        reorderTabs(tab.isPinned ? 'pinned' : 'normal', currentIndex, 0)
      }
    },
    [tabs, pinnedTabs, normalTabs, reorderTabs]
  )

  // ─── Drag logic (extracted to useTabDrag) ──────────────────────────────────

  const { tabBarRef, tabRefs, noTransition, getTranslateX, handlePointerDown, handleTabClick, isDragging, isGhost } =
    useTabDrag({ pinnedTabs, normalTabs, isDetached, reorderTabs, closeTab, setActiveTab })

  // ─── Action handlers ────────────────────────────────────────────────────────

  const handleHomeClick = () => {
    if (homeTab) {
      setActiveTab(homeTab.id)
      return
    }
    addTab({
      id: HOME_TAB_ID,
      type: 'route',
      url: '/home',
      title: getDefaultRouteTitle('/home')
    })
  }

  const handleAddTab = () => {
    addTab({
      id: uuid(),
      type: 'route',
      url: '/',
      title: getDefaultRouteTitle('/')
    })
  }

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <>
      <header
        ref={tabBarRef}
        className={cn(
          'relative flex h-11 w-full select-none items-center gap-1 [-webkit-app-region:drag]',
          isMacTransparentWindow ? 'bg-transparent' : 'bg-sidebar',
          rightPaddingClass,
          isMac ? 'pl-[env(titlebar-area-x)]' : 'pl-3'
        )}>
        {/* Home tab */}
        {!isDetached && (
          <HomeTabButton
            isActive={activeTabId === HOME_TAB_ID}
            onClick={handleHomeClick}
            onContextMenu={(e) => handleContextMenu(e, HOME_TAB_ID)}
            tooltip={t('title.home')}
            tone={tabTone}
          />
        )}
        {!isDetached && (pinnedTabs.length > 0 || normalTabs.length > 0) && <Separator />}

        {/* Tabs scrollable area — empty space stays draggable; only interactive elements override */}
        <div className="flex flex-1 items-center gap-1 overflow-x-auto px-1 [&::-webkit-scrollbar]:hidden">
          {/* Pinned tabs */}
          {pinnedTabs.length > 0 && (
            <div className="flex shrink-0 items-center gap-0 rounded-full bg-sidebar-accent/50 p-0 [-webkit-app-region:no-drag]">
              {pinnedTabs.map((tab) => (
                <PinnedTabButton
                  key={tab.id}
                  tab={tab}
                  isActive={tab.id === activeTabId}
                  onSelect={() => handleTabClick(tab.id)}
                  onContextMenu={(e) => handleContextMenu(e, tab.id)}
                  tone={tabTone}
                  drag={{
                    isDragging: isDragging(tab.id),
                    isGhost: isGhost(tab.id),
                    noTransition,
                    translateX: getTranslateX(tab.id, 'pinned'),
                    onPointerDown: (e) => handlePointerDown(e, tab, 'pinned')
                  }}
                  tabRef={(el) => {
                    if (el) {
                      tabRefs.current.set(tab.id, el)
                    } else {
                      tabRefs.current.delete(tab.id)
                    }
                  }}
                />
              ))}
            </div>
          )}

          {/* Separator before normal tabs */}
          {!isDetached && pinnedTabs.length > 0 && normalTabs.length > 0 && <Separator />}

          {/* Normal tabs */}
          {normalTabs.map((tab) => (
            <NormalTabButton
              key={tab.id}
              tab={tab}
              isActive={tab.id === activeTabId}
              onSelect={() => handleTabClick(tab.id)}
              onClose={() => closeTab(tab.id)}
              onContextMenu={(e) => handleContextMenu(e, tab.id)}
              showClose={!isDetached}
              tone={tabTone}
              drag={{
                isDragging: isDragging(tab.id),
                isGhost: isGhost(tab.id),
                noTransition,
                translateX: getTranslateX(tab.id, 'normal'),
                onPointerDown: (e) => handlePointerDown(e, tab, 'normal')
              }}
              tabRef={(el) => {
                if (el) {
                  tabRefs.current.set(tab.id, el)
                } else {
                  tabRefs.current.delete(tab.id)
                }
              }}
            />
          ))}

          {/* New tab button — sticky so it hugs the last tab but never scrolls away */}
          {!isDetached && (
            <button
              type="button"
              onClick={handleAddTab}
              className={cn(
                'sticky right-0 ml-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors [-webkit-app-region:no-drag] hover:bg-sidebar-accent hover:text-sidebar-foreground',
                isMacTransparentWindow ? 'bg-white/60 backdrop-blur-sm dark:bg-black/40' : 'bg-sidebar'
              )}
              title={t('tab.new')}>
              <Plus size={14} />
            </button>
          )}
        </div>

        <ShellTabBarActions isDetached={isDetached} />
      </header>

      {/* Right-click context menu */}
      {contextMenu && contextMenuTab && contextMenuTab.id !== HOME_TAB_ID && (
        <TabContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          isPinned={!!contextMenuTab.isPinned}
          onMoveToFirst={() => handleMoveToFirst(contextMenu.tabId)}
          onPin={() => handlePinToggle(contextMenu.tabId)}
          onClose={() => closeTab(contextMenu.tabId)}
          onDismiss={() => setContextMenu(null)}
        />
      )}
    </>
  )
}
