import { isMac } from '@renderer/config/constant'
import useMacTransparentWindow from '@renderer/hooks/useMacTransparentWindow'
import { cn } from '@renderer/utils'
import { Search } from 'lucide-react'
import React, { useCallback, useEffect, useRef } from 'react'

import { getSidebarLayout, SIDEBAR_ICON_WIDTH, SIDEBAR_VERTICAL_CARD_WIDTH } from './constants'
import { DefaultLogo } from './primitives'
import { SidebarDocked } from './SidebarDocked'
import { SidebarFooter } from './SidebarFooter'
import { SidebarMenu } from './SidebarMenu'
import { SidebarTooltip } from './Tooltip'
import type { SidebarMenuItem, SidebarTab, SidebarUser } from './types'
import { useSidebarResize } from './useSidebarResize'

export interface SidebarProps {
  width: number
  setWidth: (width: number) => void
  activeItem: string
  items: SidebarMenuItem[]
  title?: string
  logo?: React.ReactNode
  activeTabId?: string
  dockedTabs?: SidebarTab[]
  user?: SidebarUser
  isFloating?: boolean
  searchLabel?: string
  extensionsLabel?: string
  actions?: React.ReactNode
  onItemClick: (id: string) => void
  onHoverChange?: (visible: boolean) => void
  onSearchClick?: () => void
  onExtensionsClick?: () => void
  onMiniAppTabClick?: (tabId: string) => void
  onStartSidebarDrag?: (e: React.MouseEvent, tabId: string) => void
  onCloseDockedTab?: (tabId: string) => void
  onDismiss?: () => void
}

export function Sidebar({
  width,
  setWidth,
  activeItem,
  items,
  title = '',
  logo,
  activeTabId,
  dockedTabs = [],
  user,
  isFloating = false,
  searchLabel = '',
  extensionsLabel = '',
  actions,
  onItemClick,
  onHoverChange,
  onSearchClick,
  onExtensionsClick,
  onMiniAppTabClick,
  onStartSidebarDrag,
  onCloseDockedTab,
  onDismiss
}: SidebarProps) {
  const isMacTransparentWindow = useMacTransparentWindow()
  const { sidebarRef, startResizing } = useSidebarResize(setWidth)
  const hoverTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)
  const layout = getSidebarLayout(width)
  const showFooter = Boolean(extensionsLabel || user || onExtensionsClick || actions)
  const showSearch = Boolean(onSearchClick)
  const logoNode = logo ?? <DefaultLogo title={title} />

  useEffect(() => {
    return () => {
      if (hoverTimeout.current) clearTimeout(hoverTimeout.current)
    }
  }, [])

  const handleDismiss = useCallback(() => {
    onDismiss?.()
  }, [onDismiss])

  const menuProps = { items, activeItem, activeTabId, onItemClick, onMiniAppTabClick }
  const dockedProps = { dockedTabs, activeTabId, onMiniAppTabClick, onStartSidebarDrag, onCloseDockedTab }
  const footerProps = { user, actions, extensionsLabel, onExtensionsClick }

  // --- Floating sidebar ---
  if (isFloating) {
    return (
      <div className="fixed inset-0 z-40" onClick={handleDismiss}>
        <div
          className={cn(
            'slide-in-from-left-2 fixed top-0 bottom-0 left-0 flex w-[174px] animate-in select-none flex-col rounded-r-[4px] rounded-br-[16px] bg-sidebar/70 shadow-2xl backdrop-blur-2xl backdrop-saturate-150 duration-200 [-webkit-app-region:drag]',
            isMac && 'pt-[env(titlebar-area-height)]'
          )}
          onClick={(event) => event.stopPropagation()}
          onMouseLeave={() => {
            if (hoverTimeout.current) clearTimeout(hoverTimeout.current)
            hoverTimeout.current = setTimeout(handleDismiss, 300)
          }}
          onMouseEnter={() => {
            if (hoverTimeout.current) clearTimeout(hoverTimeout.current)
          }}>
          <div className="flex h-14 flex-shrink-0 items-center gap-2.5 px-4 [-webkit-app-region:drag]">
            {logoNode}
            <span className="truncate text-sidebar-foreground text-sm">{title}</span>
          </div>

          {showSearch && (
            <div className="px-3 py-2">
              <div
                onClick={() => {
                  onSearchClick?.()
                  handleDismiss()
                }}
                className="flex cursor-pointer items-center gap-2 rounded-md bg-sidebar-accent/50 px-2.5 py-1.5 text-muted-foreground text-xs transition-colors [-webkit-app-region:no-drag] hover:bg-accent">
                <Search size={13} />
                <span>{searchLabel}</span>
              </div>
            </div>
          )}

          <div className="flex-1 overflow-y-auto py-1 [&::-webkit-scrollbar]:hidden">
            <SidebarMenu layout="full" {...menuProps} />
            <SidebarDocked layout="full" {...dockedProps} />
          </div>

          {showFooter && (
            <div className="flex-shrink-0">
              <SidebarFooter layout="full" {...footerProps} />
            </div>
          )}
        </div>
      </div>
    )
  }

  // --- Hidden sidebar (hover zone + resize handle) ---
  if (layout === 'hidden') {
    return (
      <div ref={sidebarRef} className="relative h-full w-2 flex-shrink-0">
        <div
          className="absolute top-0 bottom-0 left-0 z-50 w-[16px]"
          onMouseEnter={() => {
            if (hoverTimeout.current) clearTimeout(hoverTimeout.current)
            hoverTimeout.current = setTimeout(() => onHoverChange?.(true), 200)
          }}
          onMouseLeave={() => {
            if (hoverTimeout.current) clearTimeout(hoverTimeout.current)
          }}>
          <div
            onMouseDown={(event) => {
              onHoverChange?.(false)
              startResizing(event)
            }}
            className="group/handle h-full w-full cursor-col-resize">
            <div className="ml-[2px] h-full w-[2px] rounded-full bg-primary/30 opacity-0 transition-opacity group-hover/handle:opacity-100" />
          </div>
        </div>
      </div>
    )
  }

  // --- Visible sidebar (icon / vertical-card / full) ---
  const actualWidth =
    layout === 'icon' ? SIDEBAR_ICON_WIDTH : layout === 'vertical-card' ? SIDEBAR_VERTICAL_CARD_WIDTH : width

  return (
    <div
      ref={sidebarRef}
      style={{ width: actualWidth }}
      className={cn(
        'group/sidebar relative z-20 flex h-full flex-shrink-0 select-none flex-col [-webkit-app-region:drag]',
        isMacTransparentWindow ? 'bg-transparent' : 'bg-sidebar'
      )}>
      {/* Header */}
      <div
        className={`flex flex-shrink-0 items-center [-webkit-app-region:drag] ${layout === 'full' ? 'h-14 gap-2.5 px-4' : 'h-14 justify-center'}`}>
        {logoNode}
        {layout === 'full' && <span className="truncate text-sidebar-foreground text-sm">{title}</span>}
      </div>

      {/* Search */}
      {showSearch &&
        (layout === 'full' ? (
          <div className="px-3 py-2">
            <div
              onClick={onSearchClick}
              className="flex cursor-pointer items-center gap-2 rounded-md bg-sidebar-accent px-2.5 py-1.5 text-muted-foreground text-xs transition-colors [-webkit-app-region:no-drag] hover:bg-accent">
              <Search size={13} />
              <span>{searchLabel}</span>
            </div>
          </div>
        ) : (
          <div className="flex justify-center py-1.5 [-webkit-app-region:no-drag]">
            <SidebarTooltip content={searchLabel}>
              <button
                type="button"
                onClick={onSearchClick}
                className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground">
                <Search size={16} strokeWidth={1.6} />
              </button>
            </SidebarTooltip>
          </div>
        ))}

      {/* Content */}
      <div className="flex-1 overflow-y-auto py-1 [&::-webkit-scrollbar]:hidden">
        <SidebarMenu layout={layout} {...menuProps} />
        <SidebarDocked layout={layout} {...dockedProps} />
      </div>

      {/* Footer */}
      {showFooter && (
        <div className="flex-shrink-0">
          <SidebarFooter layout={layout} {...footerProps} />
        </div>
      )}

      {/* Resize handle */}
      <div
        onMouseDown={startResizing}
        className="group/handle absolute top-0 right-0 bottom-0 z-50 w-[3px] cursor-col-resize">
        <div className="h-full w-full bg-primary/20 opacity-0 transition-opacity group-hover/handle:opacity-100" />
      </div>
    </div>
  )
}
