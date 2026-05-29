import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuItemContent,
  ContextMenuTrigger,
  Tooltip
} from '@cherrystudio/ui'
import { isMac } from '@renderer/config/constant'
import { getMiniAppsLogo } from '@renderer/config/miniApps'
import useMacTransparentWindow from '@renderer/hooks/useMacTransparentWindow'
import { cn, uuid } from '@renderer/utils'
import { getDefaultRouteTitle } from '@renderer/utils/routeTitle'
import { ChevronsLeft, Home, Pin, PinOff, Plus, X } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { Tab } from '../../hooks/useTabs'
import { ShellTabBarActions, useShellTabBarLayout } from './ShellTabBarActions'
import { getTabIcon } from './tabIcons'
import { useTabDrag } from './useTabDrag'

const TabIcon: FC<{ tab: Tab; size: number; className?: string }> = ({ tab, size, className }) => {
  if (tab.icon) {
    const logo = getMiniAppsLogo(tab.icon)
    if (logo) {
      const Compound = logo
      return <Compound.Avatar size={size} shape="rounded" className={cn('select-none', className)} />
    }
    return (
      <img
        src={tab.icon}
        alt=""
        draggable={false}
        className={cn('select-none rounded-[3px] object-cover', className)}
        style={{ width: size, height: size }}
      />
    )
  }
  const Icon = getTabIcon(tab)
  return <Icon size={size} strokeWidth={1.6} className={className} />
}

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
  tooltip,
  tone
}: {
  isActive: boolean
  onClick: () => void
  tooltip: string
  tone: TabToneProps
}) => (
  <Tooltip placement="bottom" content={tooltip} delay={600}>
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex h-8 w-8 shrink-0 cursor-default items-center justify-center rounded-full transition-colors duration-150 [-webkit-app-region:no-drag]',
        isActive ? tone.activeClass : tone.hoverClass
      )}>
      <Home size={14} strokeWidth={1.6} />
    </button>
  </Tooltip>
)

type PinnedTabButtonProps = {
  tab: Tab
  isActive: boolean
  onSelect: () => void
  drag: DragItemProps
  tabRef: (el: HTMLButtonElement | null) => void
  tone: TabToneProps
  ref?: React.Ref<HTMLButtonElement>
} & Omit<React.ComponentPropsWithoutRef<'button'>, 'onClick' | 'onPointerDown'>

const PinnedTabButton = ({ tab, isActive, onSelect, drag, tabRef, tone, ref, ...rest }: PinnedTabButtonProps) => {
  return (
    <Tooltip placement="bottom" content={tab.title} delay={600}>
      {/* Spread `rest` (which carries injected ContextMenuTrigger props) first so the */}
      {/* drag handler / transform style / drag classes always win on a key collision. */}
      <button
        {...rest}
        ref={(el) => {
          tabRef(el)
          if (typeof ref === 'function') ref(el)
          else if (ref) ref.current = el
        }}
        data-tab-id={tab.id}
        type="button"
        onPointerDown={drag.onPointerDown}
        onClick={onSelect}
        title={tab.title}
        style={{
          ...rest.style,
          transform: `translateX(${drag.translateX}px)`,
          transition: drag.isDragging || drag.noTransition ? 'none' : 'transform 200ms ease',
          zIndex: drag.isDragging ? 50 : 'auto',
          opacity: drag.isGhost ? 0.3 : 1
        }}
        className={cn(
          'flex h-7 w-7 items-center justify-center rounded-full transition-colors duration-150',
          drag.isDragging ? 'cursor-grabbing' : 'cursor-default',
          isActive ? tone.activeClass : tone.hoverClass,
          rest.className
        )}>
        <TabIcon tab={tab} size={14} />
      </button>
    </Tooltip>
  )
}

// Threshold below which the right-side X is hidden and icon-overlay X is used instead
const NARROW_TAB_THRESHOLD = 64

type NormalTabButtonProps = {
  tab: Tab
  isActive: boolean
  onSelect: () => void
  onClose: () => void
  showClose?: boolean
  drag: DragItemProps
  tabRef: (el: HTMLButtonElement | null) => void
  tone: TabToneProps
  ref?: React.Ref<HTMLButtonElement>
} & Omit<React.ComponentPropsWithoutRef<'button'>, 'onClick' | 'onPointerDown' | 'style' | 'className'>

const NormalTabButton = ({
  tab,
  isActive,
  onSelect,
  onClose,
  showClose = true,
  drag,
  tabRef,
  tone,
  ref,
  ...rest
}: NormalTabButtonProps) => {
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
      if (typeof ref === 'function') ref(el)
      else if (ref) ref.current = el
    },
    [tabRef, ref]
  )

  const showRightClose = isCloseable && showClose && !isNarrow
  const showIconOverlayClose = isCloseable && showClose && isNarrow

  return (
    // Spread injected ContextMenuTrigger props first; the explicit drag handler
    // below then overrides any colliding `onContextMenu` chain ordering. The
    // props type already excludes `onClick`/`onPointerDown`/`style`/`className`,
    // so the spread can't clobber those — the order is just belt-and-braces.
    <button
      {...rest}
      ref={setRefs}
      data-tab-id={tab.id}
      type="button"
      onPointerDown={drag.onPointerDown}
      onClick={onSelect}
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
        <TabIcon tab={tab} size={13} className={cn(showIconOverlayClose && 'group-hover:hidden')} />
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

// ─── Tab right-click menu ─────────────────────────────────────────────────────

const TabRightClickMenu = ({
  isPinned,
  onMoveToFirst,
  onPin,
  onClose,
  children
}: {
  isPinned: boolean
  onMoveToFirst: () => void
  onPin: () => void
  onClose: () => void
  children: React.ReactNode
}) => {
  const { t } = useTranslation()
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="min-w-[130px]">
        <ContextMenuItem onSelect={onMoveToFirst}>
          <ContextMenuItemContent icon={<ChevronsLeft size={14} />}>{t('tab.move_to_first')}</ContextMenuItemContent>
        </ContextMenuItem>
        <ContextMenuItem onSelect={onPin}>
          <ContextMenuItemContent icon={isPinned ? <PinOff size={14} /> : <Pin size={14} />}>
            {isPinned ? t('tab.unpin') : t('tab.pin')}
          </ContextMenuItemContent>
        </ContextMenuItem>
        <ContextMenuItem onSelect={onClose}>
          <ContextMenuItemContent icon={<X size={14} />}>{t('tab.close')}</ContextMenuItemContent>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
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
              'border border-black/8 bg-white/78 text-sidebar-foreground backdrop-blur-sm dark:border-0 dark:bg-white/6 dark:text-sidebar-foreground dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)]',
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

  // ─── Context menu actions ───────────────────────────────────────────────────

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
                <TabRightClickMenu
                  key={tab.id}
                  isPinned={!!tab.isPinned}
                  onMoveToFirst={() => handleMoveToFirst(tab.id)}
                  onPin={() => handlePinToggle(tab.id)}
                  onClose={() => closeTab(tab.id)}>
                  <PinnedTabButton
                    tab={tab}
                    isActive={tab.id === activeTabId}
                    onSelect={() => handleTabClick(tab.id)}
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
                </TabRightClickMenu>
              ))}
            </div>
          )}

          {/* Separator before normal tabs */}
          {!isDetached && pinnedTabs.length > 0 && normalTabs.length > 0 && <Separator />}

          {/* Normal tabs */}
          {normalTabs.map((tab) => (
            <TabRightClickMenu
              key={tab.id}
              isPinned={!!tab.isPinned}
              onMoveToFirst={() => handleMoveToFirst(tab.id)}
              onPin={() => handlePinToggle(tab.id)}
              onClose={() => closeTab(tab.id)}>
              <NormalTabButton
                tab={tab}
                isActive={tab.id === activeTabId}
                onSelect={() => handleTabClick(tab.id)}
                onClose={() => closeTab(tab.id)}
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
            </TabRightClickMenu>
          ))}

          {/* New tab button — sticky so it hugs the last tab but never scrolls away */}
          {!isDetached && (
            <button
              type="button"
              onClick={handleAddTab}
              className={cn(
                'sticky right-0 ml-0.5 flex h-7 w-7 shrink-0 appearance-none items-center justify-center rounded-[10px] border-0 bg-transparent p-0 text-muted-foreground shadow-none transition-colors [-webkit-app-region:no-drag] hover:text-sidebar-foreground',
                isMacTransparentWindow ? 'hover:bg-white/50 dark:hover:bg-white/8' : 'hover:bg-sidebar-accent'
              )}
              title={t('tab.new')}>
              <Plus size={14} />
            </button>
          )}
        </div>

        <ShellTabBarActions isDetached={isDetached} />
      </header>
    </>
  )
}
