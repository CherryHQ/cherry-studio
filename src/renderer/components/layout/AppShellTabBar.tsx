import { Tooltip } from '@cherrystudio/ui'
import { OpenInNewWindowIcon } from '@renderer/components/Icons'
import { isMac } from '@renderer/config/constant'
import { CommandContextMenu, type CommandContextMenuExtraItem } from '@renderer/features/command'
import useMacTransparentWindow from '@renderer/hooks/useMacTransparentWindow'
import type { OpenTabOptions, Tab } from '@renderer/hooks/useTabs'
import { cn } from '@renderer/utils'
import { ChevronsLeft, Pin, PinOff, Plus, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ShellTabBarActions, useShellTabBarLayout } from './ShellTabBarActions'
import { TabIcon } from './TabIcon'
import { useTabDrag } from './useTabDrag'

function isHomeTab(tab: Pick<Tab, 'id'>) {
  return tab.id === 'home'
}

// ─── Props ────────────────────────────────────────────────────────────────────

type AppShellTabBarProps = {
  tabs: Tab[]
  activeTabId: string
  setActiveTab: (id: string) => void
  closeTab: (id: string) => void
  addTab?: (tab: Tab) => void
  reorderTabs: (type: 'pinned' | 'normal', oldIndex: number, newIndex: number) => void
  pinTab: (id: string) => void
  unpinTab: (id: string) => void
  detachTab?: (id: string) => void
  openTab: (url: string, options?: OpenTabOptions) => string
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
          'nodrag flex h-7 w-7 items-center justify-center rounded-full transition-colors duration-150 [-webkit-app-region:no-drag]',
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

  const showRightClose = showClose && !isNarrow
  const showIconOverlayClose = showClose && isNarrow

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
        'nodrag group relative flex h-[30px] min-w-[40px] max-w-[160px] flex-1 items-center gap-1.5 rounded-[10px] transition-all duration-150 [-webkit-app-region:no-drag]',
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
            className="nodrag absolute inset-0 hidden cursor-pointer items-center justify-center rounded-sm group-hover:flex">
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
            'nodrag ml-auto flex h-[18px] w-[18px] shrink-0 cursor-pointer items-center justify-center rounded-sm transition-all duration-150 hover:bg-foreground/10',
            isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
          )}>
          <X size={10} />
        </div>
      )}
    </button>
  )
}

// ─── Tab right-click menu ─────────────────────────────────────────────────────

// ─── Tab capabilities (declarative rule table) ────────────────────────────────

interface TabCapabilities {
  /** Show a right-click context menu at all. */
  menu: boolean
  /** "Move to first" + drag-to-reorder, within the tab's own zone. */
  reorder: boolean
  /** Pin (normal) or unpin (pinned). */
  togglePin: boolean
  /** "Open in new window" (detach to its own window). */
  detach: boolean
  /** Close the tab (context-menu item + inline X). */
  close: boolean
}

/**
 * Single source of truth for what a tab can do, derived from its zone and the
 * tab counts. A window always keeps at least one normal tab, so the last normal
 * tab can't be closed / pinned / detached and therefore shows no menu. Pinned
 * tabs can always be unpinned but never closed directly; reordering is per-zone.
 */
export function getTabCapabilities(
  tab: Pick<Tab, 'id' | 'isPinned'>,
  ctx: { pinnedCount: number; normalCount: number; canDetach: boolean }
): TabCapabilities {
  if (isHomeTab(tab)) {
    return { menu: false, reorder: false, togglePin: false, detach: false, close: false }
  }

  const detach = ctx.canDetach
  if (tab.isPinned) {
    const hasSiblings = ctx.pinnedCount > 1
    return { menu: true, reorder: hasSiblings, togglePin: true, detach, close: false }
  }
  const hasSiblings = ctx.normalCount > 1
  return {
    menu: hasSiblings,
    reorder: hasSiblings,
    togglePin: hasSiblings,
    detach: hasSiblings && detach,
    close: hasSiblings
  }
}

const TabRightClickMenu = ({
  isPinned,
  capabilities,
  onMoveToFirst,
  onTogglePin,
  onDetach,
  onClose,
  children
}: {
  isPinned: boolean
  capabilities: TabCapabilities
  onMoveToFirst: () => void
  onTogglePin: () => void
  onDetach: () => void
  onClose: () => void
  children: React.ReactNode
}) => {
  const { t } = useTranslation()

  const items = useMemo<CommandContextMenuExtraItem[]>(() => {
    const entries: Array<{ enabled: boolean; item: CommandContextMenuExtraItem }> = [
      {
        enabled: capabilities.reorder,
        item: {
          type: 'item',
          id: 'tab.move-to-first',
          label: t('tab.move_to_first'),
          icon: <ChevronsLeft size={14} />,
          onSelect: onMoveToFirst
        }
      },
      {
        enabled: capabilities.togglePin,
        item: {
          type: 'item',
          id: 'tab.pin',
          label: isPinned ? t('tab.unpin') : t('tab.pin'),
          icon: isPinned ? <PinOff size={14} /> : <Pin size={14} />,
          onSelect: onTogglePin
        }
      },
      {
        enabled: capabilities.detach,
        item: {
          type: 'item',
          id: 'tab.open-in-new-window',
          label: t('tab.open_in_new_window'),
          icon: <OpenInNewWindowIcon size={14} />,
          onSelect: onDetach
        }
      },
      {
        enabled: capabilities.close,
        item: {
          type: 'item',
          id: 'tab.close',
          label: t('tab.close'),
          icon: <X size={14} />,
          onSelect: onClose
        }
      }
    ]
    return entries.filter((entry) => entry.enabled).map((entry) => entry.item)
  }, [t, isPinned, capabilities, onMoveToFirst, onTogglePin, onDetach, onClose])

  if (!capabilities.menu || items.length === 0) {
    return <>{children}</>
  }

  return (
    <CommandContextMenu location="webcontents.context" extraItems={items} contentClassName="min-w-[130px]">
      {children}
    </CommandContextMenu>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export const AppShellTabBar = ({
  tabs,
  activeTabId,
  setActiveTab,
  closeTab,
  reorderTabs,
  pinTab,
  unpinTab,
  detachTab,
  openTab
}: AppShellTabBarProps) => {
  const { t } = useTranslation()
  const isMacTransparentWindow = useMacTransparentWindow()
  const { rightPaddingClass } = useShellTabBarLayout()
  const tabTone = useMemo<TabToneProps>(
    () =>
      isMacTransparentWindow
        ? {
            activeClass:
              'border border-black/8 bg-white/78 text-sidebar-foreground backdrop-blur-sm dark:border-0 dark:bg-white/10 dark:text-sidebar-foreground dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]',
            hoverClass:
              'text-muted-foreground hover:bg-black/6 hover:text-sidebar-foreground hover:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.28)] dark:hover:bg-white/6 dark:hover:text-sidebar-foreground dark:hover:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.03)]'
          }
        : {
            activeClass: 'bg-black/8 text-sidebar-foreground dark:bg-sidebar-accent dark:text-sidebar-foreground',
            hoverClass:
              'text-muted-foreground hover:bg-white hover:text-sidebar-foreground dark:hover:bg-white/10 dark:hover:text-sidebar-foreground'
          },
    [isMacTransparentWindow]
  )

  const { pinnedTabs, normalTabs } = useMemo(() => {
    const pinned: Tab[] = []
    const normal: Tab[] = []
    for (const tab of tabs) {
      if (tab.isPinned) {
        pinned.push(tab)
      } else {
        normal.push(tab)
      }
    }
    return { pinnedTabs: pinned, normalTabs: normal }
  }, [tabs])
  const hasUnpinnedTabs = normalTabs.length > 0
  const homeTabIndex = normalTabs.findIndex(isHomeTab)
  const normalReorderStartIndex = homeTabIndex === -1 ? 0 : homeTabIndex + 1
  // Shared input for `getTabCapabilities` — every per-tab affordance is derived
  // from this, so the render stays declarative.
  const tabContext = useMemo(
    () => ({ pinnedCount: pinnedTabs.length, normalCount: normalTabs.length, canDetach: !!detachTab }),
    [pinnedTabs.length, normalTabs.length, detachTab]
  )

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
      // `normalTabs`/`pinnedTabs` now mirror the TabsContext arrays that
      // `reorderTabs` splices (the default `chat` tab is no longer pulled out),
      // so the bar index maps straight onto the context index.
      const list = tab.isPinned ? pinnedTabs : normalTabs
      const currentIndex = list.findIndex((t) => t.id === tabId)
      const targetIndex = tab.isPinned ? 0 : normalReorderStartIndex
      if (currentIndex > targetIndex) {
        reorderTabs(tab.isPinned ? 'pinned' : 'normal', currentIndex, targetIndex)
      }
    },
    [tabs, pinnedTabs, normalTabs, normalReorderStartIndex, reorderTabs]
  )

  // ─── Drag logic (extracted to useTabDrag) ──────────────────────────────────

  const { tabBarRef, tabRefs, noTransition, getTranslateX, handlePointerDown, handleTabClick, isDragging, isGhost } =
    useTabDrag({
      pinnedTabs,
      normalTabs,
      normalReorderStartIndex,
      canDetach: !!detachTab,
      reorderTabs,
      closeTab,
      setActiveTab
    })

  const handleSelectTab = useCallback(
    (tab: Tab) => {
      handleTabClick(tab.id)
    },
    [handleTabClick]
  )

  // ─── Action handlers ────────────────────────────────────────────────────────

  const handleOpenLaunchpad = () => {
    openTab('/app/launchpad', { title: t('title.launchpad') })
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
        {/* Tab buttons are no-drag; empty tabbar space remains available for moving the window. */}
        <div
          data-testid="app-shell-tab-strip"
          className="flex flex-1 items-center gap-1 overflow-x-auto px-1 [&::-webkit-scrollbar]:hidden">
          {/* Pinned tabs */}
          {pinnedTabs.length > 0 && (
            <div className="flex shrink-0 items-center gap-0 rounded-full bg-sidebar-accent/50 p-0 [-webkit-app-region:no-drag]">
              {pinnedTabs.map((tab) => {
                const caps = getTabCapabilities(tab, tabContext)
                return (
                  <TabRightClickMenu
                    key={tab.id}
                    isPinned
                    capabilities={caps}
                    onMoveToFirst={() => handleMoveToFirst(tab.id)}
                    onTogglePin={() => handlePinToggle(tab.id)}
                    onDetach={() => detachTab?.(tab.id)}
                    onClose={() => closeTab(tab.id)}>
                    <PinnedTabButton
                      tab={tab}
                      isActive={tab.id === activeTabId}
                      onSelect={() => handleSelectTab(tab)}
                      tone={tabTone}
                      drag={{
                        isDragging: isDragging(tab.id),
                        isGhost: isGhost(tab.id),
                        noTransition,
                        translateX: getTranslateX(tab.id, 'pinned'),
                        onPointerDown:
                          caps.reorder || caps.detach ? (e) => handlePointerDown(e, tab, 'pinned') : () => undefined
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
                )
              })}
            </div>
          )}

          {pinnedTabs.length > 0 && hasUnpinnedTabs && <Separator />}

          {/* Normal tabs — affordances come entirely from getTabCapabilities. */}
          {normalTabs.map((tab) => {
            const caps = getTabCapabilities(tab, tabContext)
            return (
              <TabRightClickMenu
                key={tab.id}
                isPinned={false}
                capabilities={caps}
                onMoveToFirst={() => handleMoveToFirst(tab.id)}
                onTogglePin={() => handlePinToggle(tab.id)}
                onDetach={() => detachTab?.(tab.id)}
                onClose={() => closeTab(tab.id)}>
                <NormalTabButton
                  tab={tab}
                  isActive={tab.id === activeTabId}
                  onSelect={() => handleSelectTab(tab)}
                  onClose={() => closeTab(tab.id)}
                  showClose={caps.close}
                  tone={tabTone}
                  drag={{
                    isDragging: isDragging(tab.id),
                    isGhost: isGhost(tab.id),
                    noTransition,
                    translateX: getTranslateX(tab.id, 'normal'),
                    onPointerDown:
                      caps.reorder || caps.detach ? (e) => handlePointerDown(e, tab, 'normal') : () => undefined
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
            )
          })}

          {/* Launchpad button — sticky so it hugs the last tab but never scrolls away */}
          <Tooltip placement="bottom" content={t('title.launchpad')} delay={800}>
            <button
              type="button"
              aria-label={t('title.launchpad')}
              onClick={handleOpenLaunchpad}
              className={cn(
                'sticky right-0 ml-0.5 flex h-7 w-7 shrink-0 appearance-none items-center justify-center rounded-[10px] border-0 bg-transparent p-0 text-muted-foreground shadow-none transition-colors [-webkit-app-region:no-drag] hover:text-sidebar-foreground',
                isMacTransparentWindow ? 'hover:bg-white/50 dark:hover:bg-white/8' : 'hover:bg-sidebar-accent'
              )}>
              <Plus size={14} />
            </button>
          </Tooltip>
        </div>

        <ShellTabBarActions />
      </header>
    </>
  )
}
