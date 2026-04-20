import useMacTransparentWindow from '@renderer/hooks/useMacTransparentWindow'
import { cn } from '@renderer/utils'
import { Plus, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { LeafPane, PaneTab } from '../../hooks/usePanes'
import { usePanes } from '../../hooks/usePanes'
import { PaneTabContextMenu } from './PaneTabContextMenu'
import { getTabIcon } from './tabIcons'

// Show X overlay on the icon (Chrome-style) when the tab becomes narrow.
const NARROW_TAB_THRESHOLD = 64

interface TabToneProps {
  activeClass: string
  hoverClass: string
}

interface PaneTabBarProps {
  pane: LeafPane
  /** Whether the parent leaf is the active pane (influences styling). */
  isActivePane: boolean
  /** Render shell actions (settings, theme, window controls) — only on root leaf + main window. */
  renderShellActions?: () => React.ReactNode
  /** Right padding class from useShellTabBarLayout — only applied when hosting shell actions. */
  rightPaddingClass?: string
  /** Hide the [+] button (e.g., detached window). */
  hideAddButton?: boolean
}

interface ContextMenuState {
  tabId: string
  x: number
  y: number
}

/**
 * Per-leaf tab bar.
 *
 * Replaces the legacy `AppShellTabBar` which served one global tab list.
 * Each leaf pane gets its own bar; splits produce independent bars.
 *
 * Phase 2 scope:
 *   - tab reorder within the same pane (pointer drag)
 *   - right-click context menu (pin/close/split/unsplit/moveToFirst)
 *   - add new tab ([+] button)
 *
 * Cross-pane drag and edge-split are deferred to Phase 3.
 */
export function PaneTabBar({
  pane,
  isActivePane,
  renderShellActions,
  rightPaddingClass = '',
  hideAddButton = false
}: PaneTabBarProps) {
  const { t } = useTranslation()
  const isMacTransparentWindow = useMacTransparentWindow()
  const { setActiveTab, closeTab, reorderTabsInPane, openTabInPane } = usePanes()

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

  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const contextMenuTab = contextMenu ? pane.tabs.find((t) => t.id === contextMenu.tabId) : undefined

  const handleContextMenu = useCallback((e: React.MouseEvent, tabId: string) => {
    e.preventDefault()
    setContextMenu({ tabId, x: e.clientX, y: e.clientY })
  }, [])

  const handleMoveToFirst = useCallback(
    (tabId: string) => {
      const idx = pane.tabs.findIndex((t) => t.id === tabId)
      if (idx > 0) reorderTabsInPane(pane.paneId, idx, 0)
    },
    [pane.paneId, pane.tabs, reorderTabsInPane]
  )

  const handleAddTab = useCallback(() => {
    openTabInPane(pane.paneId, '/', { forceNew: true })
  }, [openTabInPane, pane.paneId])

  return (
    <>
      <header
        className={cn(
          'relative flex h-11 w-full shrink-0 select-none items-center gap-1 pl-3 [-webkit-app-region:drag]',
          isActivePane ? 'bg-sidebar-accent/20' : 'bg-sidebar',
          rightPaddingClass
        )}>
        <div className="flex flex-1 items-center gap-1 overflow-x-auto px-1 [&::-webkit-scrollbar]:hidden">
          {pane.tabs.map((tab) => (
            <TabButton
              key={tab.id}
              tab={tab}
              isActive={tab.id === pane.activeTabId}
              onSelect={() => setActiveTab(pane.paneId, tab.id)}
              onClose={() => closeTab(pane.paneId, tab.id)}
              onContextMenu={(e) => handleContextMenu(e, tab.id)}
              tone={tabTone}
            />
          ))}

          {!hideAddButton && (
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

        {renderShellActions?.()}
      </header>

      {contextMenu && contextMenuTab && (
        <PaneTabContextMenu
          paneId={pane.paneId}
          tabId={contextMenu.tabId}
          x={contextMenu.x}
          y={contextMenu.y}
          isPinned={!!contextMenuTab.isPinned}
          onMoveToFirst={() => handleMoveToFirst(contextMenu.tabId)}
          onDismiss={() => setContextMenu(null)}
        />
      )}
    </>
  )
}

interface TabButtonProps {
  tab: PaneTab
  isActive: boolean
  onSelect: () => void
  onClose: () => void
  onContextMenu: (e: React.MouseEvent) => void
  tone: TabToneProps
}

function TabButton({ tab, isActive, onSelect, onClose, onContextMenu, tone }: TabButtonProps) {
  const Icon = getTabIcon(tab)
  const btnRef = useRef<HTMLButtonElement | null>(null)
  const [isNarrow, setIsNarrow] = useState(false)

  useEffect(() => {
    const el = btnRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setIsNarrow(entry.contentRect.width < NARROW_TAB_THRESHOLD)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const showRightClose = !isNarrow
  const showIconOverlayClose = isNarrow

  return (
    <button
      ref={btnRef}
      data-tab-id={tab.id}
      type="button"
      onClick={onSelect}
      onContextMenu={onContextMenu}
      className={cn(
        'group relative flex h-[30px] min-w-[40px] max-w-[160px] flex-1 items-center gap-1.5 rounded-[10px] transition-all duration-150 [-webkit-app-region:no-drag]',
        showRightClose ? 'pr-1 pl-2' : 'px-2',
        'cursor-default',
        isActive ? tone.activeClass : tone.hoverClass
      )}>
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
