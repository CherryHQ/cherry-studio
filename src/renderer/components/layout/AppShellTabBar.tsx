import { Tooltip } from '@cherrystudio/ui'
import { CommandContextMenu, type CommandContextMenuExtraItem } from '@renderer/components/command'
import type { OpenTabOptions, Tab } from '@renderer/hooks/tab'
import useMacTransparentWindow from '@renderer/hooks/useMacTransparentWindow'
import { emitResourceListReveal, type ResourceListRevealSource } from '@renderer/services/resourceListRevealEvents'
import { isMac } from '@renderer/utils/platform'
import { cn } from '@renderer/utils/style'
import { Plus, X } from 'lucide-react'
import {
  cloneElement,
  isValidElement,
  type ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import { useTranslation } from 'react-i18next'

import { ShellTabBarActions, useShellTabBarLayout } from './ShellTabBarActions'
import { TabIcon } from './TabIcon'
import { useTabDrag } from './useTabDrag'

// ─── Props ────────────────────────────────────────────────────────────────────

type AppShellTabBarProps = {
  tabs: Tab[]
  activeTabId: string
  isFullscreen?: boolean
  setActiveTab: (id: string) => void
  closeTab: (id: string) => void
  closeTabs: (ids: readonly string[], activateId?: string) => void
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
  /** Static equivalent of the hover tint — pins a closing tab's look so it cannot flash. */
  closingClass: string
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
          drag.isDragging && 'bg-popover shadow-md dark:bg-popover',
          rest.className
        )}>
        <TabIcon tab={tab} size={14} />
      </button>
    </Tooltip>
  )
}

const MACOS_TAB_STRIP_TRAFFIC_LIGHT_RESERVE = 'max(0px, calc(env(titlebar-area-x, 0px) - var(--sidebar-width, 0px)))'

function getResourceListRevealSourceFromUrl(url: string): ResourceListRevealSource | null {
  if (url === '/app/chat' || url.startsWith('/app/chat?') || url.startsWith('/app/chat/')) return 'assistants'
  if (url === '/app/agents' || url.startsWith('/app/agents?') || url.startsWith('/app/agents/')) return 'agents'
  return null
}

type NormalTabButtonProps = {
  tab: Tab
  isActive: boolean
  onSelect: () => void
  /** Mouse-initiated closes pass the tab's current width so the bar can freeze layout (Chrome-style). */
  onClose: (freezeWidth?: number) => void
  showClose?: boolean
  /** When set, the tab keeps this fixed width instead of flexing (close-in-place mode). */
  frozenWidth?: number | null
  /** Collapsing exit animation: the tab shrinks to zero width before it is removed. */
  isClosing?: boolean
  /** Whether the tab was the active one when its close started — pins its tone while collapsing. */
  closingWasActive?: boolean
  /** Animated unfreeze: the frozen width is gliding toward its natural flexed value. */
  isThawing?: boolean
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
  frozenWidth,
  isClosing = false,
  closingWasActive = false,
  isThawing = false,
  drag,
  tabRef,
  tone,
  ref,
  ...rest
}: NormalTabButtonProps) => {
  const { t } = useTranslation()
  const setRefs = useCallback(
    (el: HTMLButtonElement | null) => {
      tabRef(el)
      if (typeof ref === 'function') ref(el)
      else if (ref) ref.current = el
    },
    [tabRef, ref]
  )

  const canClose = showClose

  const closeFromPointer = (e: React.MouseEvent<HTMLElement>) => {
    const pointerType = (e.nativeEvent as MouseEvent & { pointerType?: string }).pointerType
    // Touch and pen devices without hover dispatch mouseleave before click, so
    // freezing on their synthetic click would leave the strip frozen forever.
    if (pointerType && pointerType !== 'mouse') {
      onClose()
      return
    }
    const tabButton = (e.currentTarget as HTMLElement).closest('[data-tab-id]') as HTMLElement | null
    // Fractional width: freezing to a rounded offsetWidth would shift every tab
    // boundary at the freeze snap (flexbox resolves fractional widths).
    onClose(tabButton?.getBoundingClientRect().width || undefined)
  }

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
      // Explicit name: the close button's aria-label must not leak into the
      // tab's accessible name via name-from-content.
      aria-label={tab.title}
      onPointerDown={drag.onPointerDown}
      onClick={onSelect}
      onAuxClick={(e) => {
        if (e.button === 1 && canClose) {
          e.preventDefault()
          e.stopPropagation()
          closeFromPointer(e)
        }
      }}
      onDoubleClick={(e) => {
        if (!canClose) return
        e.preventDefault()
        e.stopPropagation()
        closeFromPointer(e)
      }}
      style={{
        // Frozen tabs pin their flex-basis in px; the unfrozen value keeps the same
        // units so unfreezing animates smoothly (px→auto/percent widths cannot).
        // A closing tab collapses to zero width so its right siblings slide over.
        flex: isClosing ? '0 0 0px' : frozenWidth != null ? `0 0 ${frozenWidth}px` : '1 1 0px',
        // Cancels the strip's gap-1 so the finished collapse leaves no 4px jump.
        marginRight: isClosing ? -4 : undefined,
        pointerEvents: isClosing ? 'none' : undefined,
        transform: `translateX(${drag.translateX}px)`,
        // Inline transition overrides the class `transition-all`, so every property
        // involved in the close/unfreeze animations must be listed here. `flex` is
        // transitioned ONLY during the collapse and the thaw glide — both interpolate
        // px→px flex-basis with grow pinned at 0. Everywhere else flex changes must
        // snap: animating flex-grow is never width-constant (entering the freeze, or
        // swapping the thawed px back to `flex: 1 1 0`, would wobble every sibling).
        transition:
          drag.isDragging || drag.noTransition
            ? 'none'
            : isClosing || isThawing
              ? 'transform 200ms ease, flex 200ms ease, margin 200ms ease, padding 200ms ease, opacity 200ms ease'
              : 'transform 200ms ease, margin 200ms ease, padding 200ms ease, opacity 200ms ease',
        zIndex: drag.isDragging ? 50 : 'auto',
        // No fade while closing — Chrome keeps the content visible and lets the
        // shrinking width clip it; fading first reads as a white flash.
        opacity: drag.isGhost ? 0.3 : 1
      }}
      className={cn(
        'nodrag group relative flex h-[30px] min-w-[56px] max-w-[160px] items-center gap-1.5 rounded-[10px] px-2 transition-all duration-150 [-webkit-app-region:no-drag]',
        drag.isDragging ? 'cursor-grabbing' : 'cursor-default',
        // While closing, pin the tone the tab had when the close started — losing
        // the active/hover state mid-collapse reads as a white flash.
        isClosing
          ? closingWasActive
            ? tone.activeClass
            : tone.closingClass
          : isActive
            ? tone.activeClass
            : tone.hoverClass,
        drag.isDragging && 'bg-popover shadow-md dark:bg-popover',
        isClosing && 'min-w-0 overflow-hidden px-0'
      )}>
      <TabIcon tab={tab} size={14} className="shrink-0" />
      <span
        className="min-w-0 flex-1 overflow-hidden whitespace-nowrap text-left font-normal text-xs leading-none"
        style={{
          maskImage: 'linear-gradient(to right, black 80%, transparent 100%)',
          WebkitMaskImage: 'linear-gradient(to right, black 80%, transparent 100%)'
        }}>
        {tab.title}
      </span>
      {canClose && (
        // Chrome-style right-side X: always visible on the active tab, hover-revealed
        // elsewhere. Hidden via opacity (not display) so it stays keyboard-focusable;
        // pointer events stay off until hover/focus so an invisible X never swallows clicks.
        <div
          role="button"
          tabIndex={0}
          aria-label={t('tab.close')}
          onClick={(e) => {
            e.stopPropagation()
            if (e.detail > 0) closeFromPointer(e)
            else onClose()
          }}
          onDoubleClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.stopPropagation()
              onClose()
            }
          }}
          className={cn(
            // Width collapses with the opacity so a hidden X frees its space for the
            // title instead of reserving a blank slot at the tab's right edge.
            'nodrag ml-auto flex h-[18px] shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-sm transition-all duration-150 hover:bg-foreground/10',
            // A closing tab keeps its X visible (Chrome-style) — hover no longer
            // matches once pointer events are off, and the handover cleared isActive.
            isActive || isClosing
              ? 'w-[18px] opacity-100'
              : 'pointer-events-none w-0 opacity-0 focus-visible:pointer-events-auto focus-visible:w-[18px] focus-visible:opacity-100 group-hover:pointer-events-auto group-hover:w-[18px] group-hover:opacity-100'
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
  /** "Close other tabs" — every other normal tab; pinned tabs are exempt. */
  closeOthers: boolean
  /** "Close tabs to the right" — normal tabs after this one in the strip. */
  closeToRight: boolean
}

/**
 * Single source of truth for what a tab can do, derived from its zone and the
 * tab counts. Normal tabs can always be closed/pinned/detached; if the last tab
 * closes, TabsProvider opens Launchpad as the empty-state fallback. Pinned tabs
 * can be closed via the context menu (no inline X), and the batch close actions
 * only ever clear the normal zone — pinned tabs are exempt as close *targets*,
 * matching browser convention. Reordering is per-zone. `normalIndex` is the
 * tab's position within the normal zone — required to offer "close tabs to the
 * right"; for a pinned tab every normal tab counts as being to its right.
 */
export function getTabCapabilities(
  tab: Pick<Tab, 'id' | 'isPinned'>,
  ctx: { pinnedCount: number; normalCount: number; canDetach: boolean; normalIndex?: number }
): TabCapabilities {
  const detach = ctx.canDetach
  if (tab.isPinned) {
    const hasSiblings = ctx.pinnedCount > 1
    return {
      menu: true,
      reorder: hasSiblings,
      togglePin: true,
      detach,
      close: true,
      closeOthers: ctx.normalCount > 0,
      closeToRight: ctx.normalCount > 0
    }
  }
  const hasSiblings = ctx.normalCount > 1
  return {
    menu: true,
    reorder: hasSiblings,
    togglePin: true,
    detach,
    close: true,
    closeOthers: hasSiblings,
    closeToRight: ctx.normalIndex !== undefined && ctx.normalIndex < ctx.normalCount - 1
  }
}

const TabRightClickMenu = ({
  isPinned,
  capabilities,
  onMoveToFirst,
  onTogglePin,
  onDetach,
  onClose,
  onCloseOthers,
  onCloseToRight,
  children
}: {
  isPinned: boolean
  capabilities: TabCapabilities
  onMoveToFirst: () => void
  onTogglePin: () => void
  onDetach: () => void
  onClose: () => void
  onCloseOthers: () => void
  onCloseToRight: () => void
  children: React.ReactNode
}) => {
  const { t } = useTranslation()
  const [menuOpen, setMenuOpen] = useState(false)

  const items = useMemo<CommandContextMenuExtraItem[]>(() => {
    const entries: Array<{ enabled: boolean; item: CommandContextMenuExtraItem }> = [
      {
        enabled: capabilities.reorder,
        item: {
          type: 'item',
          id: 'tab.move-to-first',
          label: t('tab.move_to_first'),
          onSelect: onMoveToFirst
        }
      },
      {
        enabled: capabilities.togglePin,
        item: {
          type: 'item',
          id: 'tab.pin',
          label: isPinned ? t('tab.unpin') : t('tab.pin'),
          onSelect: onTogglePin
        }
      },
      {
        enabled: capabilities.detach,
        item: {
          type: 'item',
          id: 'tab.open-in-new-window',
          label: t('tab.open_in_new_window'),
          onSelect: onDetach
        }
      },
      {
        enabled: capabilities.close,
        item: { type: 'separator' }
      },
      {
        enabled: capabilities.close,
        item: {
          type: 'item',
          id: 'tab.close',
          label: t('tab.close'),
          onSelect: onClose
        }
      },
      {
        enabled: capabilities.closeOthers,
        item: {
          type: 'item',
          id: 'tab.close-others',
          label: t('tab.close_others'),
          onSelect: onCloseOthers
        }
      },
      {
        enabled: capabilities.closeToRight,
        item: {
          type: 'item',
          id: 'tab.close-to-right',
          label: t('tab.close_to_right'),
          onSelect: onCloseToRight
        }
      }
    ]
    return entries.filter((entry) => entry.enabled).map((entry) => entry.item)
  }, [t, isPinned, capabilities, onMoveToFirst, onTogglePin, onDetach, onClose, onCloseOthers, onCloseToRight])

  if (!capabilities.menu || items.length === 0) {
    return <>{children}</>
  }

  return (
    <CommandContextMenu
      location="webcontents.context"
      extraItems={items}
      contentClassName="min-w-[130px]"
      onOpenChange={setMenuOpen}>
      {/* data-menu-open drives the tab's menu-open highlight. Unlike Radix's
          data-state, it is also set when the menu shows as a native OS popup. */}
      {isValidElement(children)
        ? cloneElement(children as ReactElement<{ 'data-menu-open'?: boolean }>, {
            'data-menu-open': menuOpen || undefined
          })
        : children}
    </CommandContextMenu>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export const AppShellTabBar = ({
  tabs,
  activeTabId,
  isFullscreen = false,
  setActiveTab,
  closeTab,
  closeTabs,
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
            // data-[menu-open=true] mirrors hover: TabRightClickMenu sets it while the
            // tab's right-click menu is open, in both cherry and native menu modes.
            hoverClass:
              'text-muted-foreground hover:bg-black/6 hover:text-sidebar-foreground hover:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.28)] dark:hover:bg-white/6 dark:hover:text-sidebar-foreground dark:hover:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.03)] data-[menu-open=true]:bg-black/6 data-[menu-open=true]:text-sidebar-foreground data-[menu-open=true]:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.28)] dark:data-[menu-open=true]:bg-white/6 dark:data-[menu-open=true]:text-sidebar-foreground dark:data-[menu-open=true]:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.03)]',
            closingClass:
              'bg-black/6 text-sidebar-foreground shadow-[inset_0_0_0_1px_rgba(255,255,255,0.28)] dark:bg-white/6 dark:text-sidebar-foreground dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.03)]'
          }
        : {
            activeClass: 'bg-black/8 text-sidebar-foreground dark:bg-sidebar-accent dark:text-sidebar-foreground',
            hoverClass:
              'text-muted-foreground hover:bg-white hover:text-sidebar-foreground dark:hover:bg-white/10 dark:hover:text-sidebar-foreground data-[menu-open=true]:bg-white data-[menu-open=true]:text-sidebar-foreground dark:data-[menu-open=true]:bg-white/10 dark:data-[menu-open=true]:text-sidebar-foreground',
            closingClass: 'bg-white text-sidebar-foreground dark:bg-white/10 dark:text-sidebar-foreground'
          },
    [isMacTransparentWindow]
  )

  // Chrome-style close-in-place: a pointer-initiated close freezes every normal
  // tab at the closed tab's width, so the next tab's X lands under the cursor for
  // repeated closing. Tabs re-flex once the mouse leaves the strip.
  const [frozenTabWidth, setFrozenTabWidth] = useState<number | null>(null)
  // Animated unfreeze: frozen width glides to its natural flexed value, then unfreezes.
  const [isThawing, setIsThawing] = useState(false)
  // Tabs currently playing their collapse animation (id → whether they were the
  // active tab when the close started); removal is deferred until the animation ends.
  const [closingTabIds, setClosingTabIds] = useState<ReadonlyMap<string, boolean>>(() => new Map())
  // Pointer closes are registered before the double-rAF animation starts. This
  // deduplicates click/double-click sequences and lets concurrent closes skip
  // every tab that is already on its way out.
  const pendingCloseIdsRef = useRef(new Set<string>())
  const closeTimersRef = useRef<number[]>([])
  const thawTimerRef = useRef<number | null>(null)
  const stripRef = useRef<HTMLDivElement | null>(null)
  const stripPointerInsideRef = useRef(false)
  const thawAfterCollapseRef = useRef(false)
  const handleStripMouseLeaveRef = useRef<() => void>(() => undefined)
  // The deferred close/handover callbacks (double-rAF + 200ms) must not act on
  // click-time closures: TabsProvider's closeTabs reads tabs/activeTabId
  // non-functionally, so a stale reference computes fallback/active decisions
  // against a world that no longer exists (e.g. two rapid closes skip the
  // launchpad fallback and leave a dangling active id).
  const closeTabRef = useRef(closeTab)
  closeTabRef.current = closeTab
  const setActiveTabRef = useRef(setActiveTab)
  setActiveTabRef.current = setActiveTab
  useEffect(
    () => () => {
      closeTimersRef.current.forEach((timer) => window.clearTimeout(timer))
      if (thawTimerRef.current != null) window.clearTimeout(thawTimerRef.current)
      pendingCloseIdsRef.current.clear()
    },
    []
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
  const visualTabsRef = useRef<Tab[]>([])
  visualTabsRef.current = [...pinnedTabs, ...normalTabs]
  const activeTabIdRef = useRef(activeTabId)
  activeTabIdRef.current = activeTabId
  const hasUnpinnedTabs = normalTabs.length > 0
  const normalReorderStartIndex = 0
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

  // Batch close actions only touch the normal zone — pinned tabs are exempt,
  // matching browser convention. The right-clicked tab is passed as the
  // preferred survivor so focus lands on it when the active tab gets closed.
  const handleCloseOthers = useCallback(
    (tabId: string) => {
      closeTabs(
        normalTabs.filter((t) => t.id !== tabId).map((t) => t.id),
        tabId
      )
    },
    [normalTabs, closeTabs]
  )

  const handleCloseToRight = useCallback(
    (tabId: string) => {
      // A pinned tab is not in normalTabs (index -1): the whole normal zone
      // sits to its right, so slice(0) closes every normal tab.
      const index = normalTabs.findIndex((t) => t.id === tabId)
      closeTabs(
        normalTabs.slice(index + 1).map((t) => t.id),
        tabId
      )
    },
    [normalTabs, closeTabs]
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
      if (!handleTabClick(tab.id)) return

      const revealSource = getResourceListRevealSourceFromUrl(tab.url)
      if (revealSource) {
        emitResourceListReveal({ source: revealSource, tabId: tab.id })
      }
    },
    [handleTabClick]
  )

  // ─── Action handlers ────────────────────────────────────────────────────────

  const handleOpenLaunchpad = () => {
    openTab('/app/launchpad', { title: t('title.launchpad'), forceNew: true })
  }

  // ─── Close-in-place freeze/thaw ─────────────────────────────────────────────

  /**
   * Width each normal tab would get once the strip un-freezes. Switching straight
   * back to `flex: 1 1 0%` cannot animate (grow-driven widths jump), so the thaw
   * glides the frozen px value to this target first, then swaps to flex.
   */
  const computeThawedTabWidth = () => {
    const strip = stripRef.current
    const pendingCloseIds = pendingCloseIdsRef.current
    const aliveTabs = normalTabs.filter((tab) => !pendingCloseIds.has(tab.id))
    const firstEl = aliveTabs[0] ? tabRefs.current.get(aliveTabs[0].id) : undefined
    if (!strip || !firstEl || aliveTabs.length === 0) return null
    // A scrolled overflowing strip breaks the viewport-rect math below (the first
    // tab sits behind the strip's left edge) — fall back to the instant unfreeze.
    if (strip.scrollLeft > 0) return null
    const gap = 4 // strip gap-1
    const launchpad = strip.querySelector<HTMLElement>('[data-launchpad-button]')
    const rightLimit =
      strip.getBoundingClientRect().right -
      4 /* pr-1 */ -
      (launchpad ? launchpad.offsetWidth + gap + 2 /* ml-0.5 */ : 0)
    // Tabs still collapsing left of the first alive tab shift its rect right by
    // their transient width; that space belongs to the post-close layout.
    const firstAliveIndex = normalTabs.findIndex((tab) => tab.id === aliveTabs[0].id)
    const closingBeforeFootprint = normalTabs
      .slice(0, firstAliveIndex)
      .filter((tab) => pendingCloseIds.has(tab.id))
      .reduce((sum, tab) => {
        const element = tabRefs.current.get(tab.id)
        if (!element) return sum
        const marginRight = Number.parseFloat(window.getComputedStyle(element).marginRight) || 0
        return sum + element.getBoundingClientRect().width + gap + marginRight
      }, 0)
    const available =
      rightLimit - (firstEl.getBoundingClientRect().left - closingBeforeFootprint) - (aliveTabs.length - 1) * gap
    if (available <= 0) return null
    // Keep the fraction: flexbox resolves fractional widths, and rounding here
    // would make the final frozen→flex swap visibly shift the strip.
    return Math.min(160, Math.max(56, available / aliveTabs.length))
  }

  const handleStripMouseLeave = () => {
    stripPointerInsideRef.current = false
    if ([...pendingCloseIdsRef.current].some((id) => !closingTabIds.has(id))) {
      thawAfterCollapseRef.current = true
      return
    }
    if (frozenTabWidth == null) return
    // A leave→re-enter→leave during an in-flight glide must not fall through to
    // the instant unfreeze (a mid-transition swap snaps the remaining distance),
    // and the previous glide's timer must not fire into the restarted one.
    if (thawTimerRef.current != null) {
      window.clearTimeout(thawTimerRef.current)
      thawTimerRef.current = null
    }
    const target = computeThawedTabWidth()
    if (target == null || (target === frozenTabWidth && !isThawing)) {
      setIsThawing(false)
      setFrozenTabWidth(null)
      return
    }
    setIsThawing(true)
    setFrozenTabWidth(target)
    // Buffer over the 200ms glide: swapping while the CSS transition is still
    // running would snap the remaining distance instantly.
    thawTimerRef.current = window.setTimeout(() => {
      thawTimerRef.current = null
      setIsThawing(false)
      // The px value now matches the flexed width, so the swap is invisible.
      setFrozenTabWidth(null)
    }, 280)
  }
  handleStripMouseLeaveRef.current = handleStripMouseLeave

  // Opening tabs while frozen (keyboard, launchpad `+` — the cursor never leaves
  // the strip) would render the newcomers at the stale frozen width; a growing
  // tab set unfreezes immediately instead, like Chrome's relayout-on-open.
  const prevNormalCountRef = useRef(normalTabs.length)
  useEffect(() => {
    if (normalTabs.length > prevNormalCountRef.current && frozenTabWidth != null) {
      if (thawTimerRef.current != null) {
        window.clearTimeout(thawTimerRef.current)
        thawTimerRef.current = null
      }
      setIsThawing(false)
      setFrozenTabWidth(null)
    }
    prevNormalCountRef.current = normalTabs.length
  }, [normalTabs.length, frozenTabWidth])

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <>
      <header
        ref={tabBarRef}
        className={cn(
          'relative flex h-11 w-full select-none items-center gap-1 [-webkit-app-region:drag]',
          isMacTransparentWindow ? 'bg-transparent' : 'bg-sidebar',
          rightPaddingClass,
          'pl-0'
        )}>
        {/* Tab buttons are no-drag; empty tabbar space remains available for moving the window. */}
        <div
          ref={stripRef}
          data-testid="app-shell-tab-strip"
          style={isMac && !isFullscreen ? { paddingLeft: MACOS_TAB_STRIP_TRAFFIC_LIGHT_RESERVE } : undefined}
          onMouseEnter={() => {
            stripPointerInsideRef.current = true
            thawAfterCollapseRef.current = false
          }}
          onMouseLeave={handleStripMouseLeave}
          className="flex flex-1 items-center gap-1 overflow-x-auto pr-1 [&::-webkit-scrollbar]:hidden">
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
                    onClose={() => closeTab(tab.id)}
                    onCloseOthers={() => handleCloseOthers(tab.id)}
                    onCloseToRight={() => handleCloseToRight(tab.id)}>
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
          {normalTabs.map((tab, index) => {
            const caps = getTabCapabilities(tab, { ...tabContext, normalIndex: index })
            return (
              <TabRightClickMenu
                key={tab.id}
                isPinned={false}
                capabilities={caps}
                onMoveToFirst={() => handleMoveToFirst(tab.id)}
                onTogglePin={() => handlePinToggle(tab.id)}
                onDetach={() => detachTab?.(tab.id)}
                onClose={() => closeTab(tab.id)}
                onCloseOthers={() => handleCloseOthers(tab.id)}
                onCloseToRight={() => handleCloseToRight(tab.id)}>
                <NormalTabButton
                  tab={tab}
                  isActive={tab.id === activeTabId}
                  onSelect={() => handleSelectTab(tab)}
                  onClose={(freezeWidth) => {
                    // Non-pointer closes (keyboard) remove immediately — the collapse
                    // animation and width freeze only make sense with a cursor parked
                    // on the strip.
                    if (!freezeWidth) {
                      closeTab(tab.id)
                      return
                    }
                    if (pendingCloseIdsRef.current.has(tab.id)) return
                    pendingCloseIdsRef.current.add(tab.id)
                    stripPointerInsideRef.current = true
                    if (thawTimerRef.current != null) {
                      window.clearTimeout(thawTimerRef.current)
                      thawTimerRef.current = null
                    }
                    setIsThawing(false)
                    setFrozenTabWidth(freezeWidth)
                    const wasActive = tab.id === activeTabIdRef.current
                    // Two-phase: let the freeze snap paint first, then start the
                    // collapse — otherwise the collapse transition starts from the
                    // flexed grow-based state and every sibling wobbles. The active
                    // handover happens in the SAME commit as the tone pinning: doing
                    // it earlier leaves the tab active-less but not yet pinned for a
                    // couple of frames, which flashes the hover tint.
                    requestAnimationFrame(() =>
                      requestAnimationFrame(() => {
                        const activeId = activeTabIdRef.current
                        const pendingCloseIds = pendingCloseIdsRef.current
                        if (pendingCloseIds.has(activeId)) {
                          const currentTabs = visualTabsRef.current
                          const activeIndex = currentTabs.findIndex((candidate) => candidate.id === activeId)
                          const rightTab = currentTabs
                            .slice(activeIndex + 1)
                            .find((candidate) => !pendingCloseIds.has(candidate.id))
                          const leftTab = [...currentTabs.slice(0, activeIndex)]
                            .reverse()
                            .find((candidate) => !pendingCloseIds.has(candidate.id))
                          const survivor = rightTab ?? leftTab
                          if (survivor) {
                            // Keep deferred callbacks in this frame consistent even
                            // before React propagates the new activeTabId prop.
                            activeTabIdRef.current = survivor.id
                            setActiveTabRef.current(survivor.id)
                          }
                        }
                        setClosingTabIds((prev) => (prev.has(tab.id) ? prev : new Map(prev).set(tab.id, wasActive)))
                        if (thawAfterCollapseRef.current && !stripPointerInsideRef.current) {
                          thawAfterCollapseRef.current = false
                          requestAnimationFrame(() => {
                            if (!stripPointerInsideRef.current) handleStripMouseLeaveRef.current()
                          })
                        }
                        closeTimersRef.current.push(
                          window.setTimeout(() => {
                            pendingCloseIdsRef.current.delete(tab.id)
                            setClosingTabIds((prev) => {
                              const nextMap = new Map(prev)
                              nextMap.delete(tab.id)
                              return nextMap
                            })
                            closeTabRef.current(tab.id)
                          }, 200)
                        )
                      })
                    )
                  }}
                  showClose={caps.close}
                  frozenWidth={frozenTabWidth}
                  isClosing={closingTabIds.has(tab.id)}
                  closingWasActive={closingTabIds.get(tab.id) ?? false}
                  isThawing={isThawing}
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
              data-launchpad-button
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
